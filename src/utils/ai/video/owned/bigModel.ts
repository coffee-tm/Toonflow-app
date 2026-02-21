import type { VideoConfig, AIConfig } from "../type";
import axios from "axios";
// 复用图片模块的智普接口（分析抽帧后的图片）
import bigModelImage from "../../image/owned/bigModel";

/**
 * 智普BigModel视频接口（抽帧+GLM-4V分析，贴合原项目规范）
 * @param input 原项目VideoConfig类型
 * @param config 原项目AIConfig类型
 * @returns 视频分析汇总结果base64
 */
export default async (input: VideoConfig, config: AIConfig) => {
  const { model, apiKey, baseURL } = config;
  const bigModelBaseUrl = baseURL || "https://open.bigmodel.cn/api/paas/v4";

  // 校验参数
  if (!apiKey) throw new Error("智普视频接口：未配置apiKey");
  if (!["glm-4v", "glm-4v-plus"].includes(model || "")) {
    throw new Error("智普视频接口仅支持glm-4v/glm-4v-plus模型");
  }
  if (!input.videoFile && !input.frameBase64List) {
    throw new Error("智普视频接口：需传入videoFile（抽帧）或frameBase64List（已抽帧）");
  }

  // 步骤1：视频抽帧（复用原项目抽帧逻辑）
  let frameBase64List: string[] = [];
  if (input.videoFile) {
    // 调用原项目抽帧接口（POST /api/utils/extract-video-frames）
    const frameResponse = await axios.post(
      "/api/utils/extract-video-frames", // 原项目抽帧接口
      {
        videoFile: input.videoFile,
        frameCount: input.frameCount || 5, // 抽5帧
        frameInterval: 2, // 每2秒抽一帧
      },
      {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 60000,
      }
    );
    frameBase64List = frameResponse.data.frames;
  } else {
    frameBase64List = input.frameBase64List!;
  }

  if (frameBase64List.length === 0) {
    throw new Error("智普视频接口：视频抽帧失败，无有效帧");
  }

  // 步骤2：批量调用智普图片接口分析每帧
  const frameResults: string[] = [];
  for (const frameBase64 of frameBase64List) {
    // 调用图片模块的智普接口
    const frameResult = await bigModelImage(
      {
        imageBase64: [frameBase64],
        prompt: input.prompt || "分析这一帧视频画面的内容，包括人物、场景、动作",
        temperature: input.temperature || 0.7,
        top_p: input.top_p || 0.9,
        max_tokens: input.max_tokens || 1024,
      },
      { model, apiKey, baseURL }
    );
    // 解析帧分析结果（去掉base64前缀）
    const frameText = Buffer.from(frameResult.split(",")[1], "base64").toString();
    frameResults.push(frameText);
  }

  // 步骤3：汇总帧分析结果（贴合原项目返回格式）
  const summary = `视频共抽取${frameResults.length}帧，各帧分析结果：\n${frameResults.join("\n---\n")}`;
  // 转base64返回（符合原项目resType="b64"规范）
  return `data:text/plain;base64,${Buffer.from(summary).toString("base64")}`;
};
