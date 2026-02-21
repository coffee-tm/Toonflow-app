import type { VideoConfig, AIConfig } from "../type";
import axios from "axios";
import { pollTask } from "@/utils/ai/utils"; // 复用原项目轮询工具

/**
 * 魔塔ModelScope视频接口（贴合原项目入参/出参规范）
 * @param input 原项目VideoConfig类型
 * @param config 原项目AIConfig类型
 * @returns 视频分析结果URL/base64 | 文本结果base64
 */
export default async (input: VideoConfig, config: AIConfig) => {
  const { model, apiKey, baseURL } = config;
  const modelScopeBaseUrl = baseURL || "https://inference.modelscope.cn/api/v1";

  // 校验必填参数
  if (!apiKey) throw new Error("魔塔视频接口：未配置apiKey");
  if (!model) throw new Error("魔塔视频接口：未指定模型ID");

  let response: any;
  const headers = { "Authorization": `Bearer ${apiKey}` };

  // 场景1：传视频文件（FormData）
  if (input.videoFile) {
    const formData = new FormData();
    formData.append("video", input.videoFile);
    // 追加额外参数
    if (input.extraParams) {
      Object.entries(input.extraParams).forEach(([key, val]) => {
        formData.append(key, String(val));
      });
    }

    response = await axios.post(
      `${modelScopeBaseUrl}/models/${model}/inference`,
      formData,
      { headers, timeout: 60000 } // 视频请求超时更长
    );
  }
  // 场景2：传视频URL（JSON）
  else if (input.videoUrl) {
    response = await axios.post(
      `${modelScopeBaseUrl}/models/${model}/inference`,
      {
        input: { video: input.videoUrl },
        parameters: input.extraParams || {},
      },
      { headers, timeout: 60000 }
    );
  } else {
    throw new Error("魔塔视频接口：未传入有效视频（videoFile/videoUrl）");
  }

  // 处理异步任务（复用原项目pollTask）
  if (response.data.task_id) {
    const taskResult = await pollTask({
      taskId: response.data.task_id,
      pollUrl: `${modelScopeBaseUrl}/tasks/${response.data.task_id}`,
      headers,
      timeout: 120000, // 视频处理轮询超时2分钟
      interval: 3000,
    });
    response.data = taskResult;
  }

  // 适配原项目返回格式
  // 视频分析结果（文本）：转base64
  if (response.data.output?.text) {
    return `data:text/plain;base64,${Buffer.from(response.data.output.text).toString("base64")}`;
  }
  // 视频处理后生成的视频URL：直接返回
  if (response.data.output?.video_url) {
    return response.data.output.video_url;
  }
  // 默认返回原始结果base64
  return `data:text/plain;base64,${Buffer.from(JSON.stringify(response.data.output)).toString("base64")}`;
};
