import "../type";
import axios from "axios";
import sharp from "sharp";
import FormData from "form-data";
import { pollTask, validateVideoConfig } from "@/utils/ai/utils";
import { createOpenAI } from "@ai-sdk/openai";
import u from "@/utils";

/**
 * 通用OpenAI兼容接口 + 智谱AI + 魔塔ModelScope 视频生成
 * 支持：
 * - 标准OpenAI兼容接口（原有功能）
 * - 智谱AI CogVideoX-Flash（视频生成）
 * - 魔塔ModelScope（视频生成）
 */
export default async (input: VideoConfig, config: AIConfig) => {
  if (!config.apiKey) throw new Error("缺少API Key");

  const model = config.model || "";

  // ==================== 智谱AI (CogVideoX) ====================
  if (model.includes("cogvideo") || model.includes("CogVideo")) {
    return await generateZhipuVideo(input, config);
  }

  // ==================== 魔塔ModelScope (视频生成) ====================
  if (model.includes("video") && (model.includes("modelscope") || model.includes("/") || config.baseURL?.includes("modelscope"))) {
    return await generateModelScopeVideo(input, config);
  }

  // ==================== 标准OpenAI兼容接口（原有逻辑） ====================
  if (!config.baseURL) throw new Error("缺少baseURL");

  const [requestUrl, queryUrl] = config.baseURL.split("|");
  const authorization = `Bearer ${config.apiKey}`;

  const formData = new FormData();
  formData.append("model", config.model);
  formData.append("prompt", input.prompt);
  formData.append("seconds", String(input.duration));

  // 根据 aspectRatio 设置 size
  const sizeMap: Record<string, string> = {
    "16:9": "1920x1080",
    "9:16": "1080x1920",
  };
  formData.append("size", sizeMap[input.aspectRatio] || "1920x1080");

  if (input.imageBase64 && input.imageBase64.length) {
    const base64Data = input.imageBase64[0]!.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");
    formData.append("input_reference", buffer, { filename: "image.jpg", contentType: "image/jpeg" });
  }

  const { data } = await axios.post(requestUrl, formData, {
    headers: { 
      "Content-Type": "application/json", 
      Authorization: authorization, 
      ...formData.getHeaders() 
    },
  });

  if (data.status === "FAILED") throw new Error(`任务提交失败: ${data.errorMessage || "未知错误"}`);
  
  const taskId = data.id;
  return await pollTask(async () => {
    const { data } = await axios.get(`${queryUrl.replace("{id}", taskId)}`, {
      headers: { Authorization: authorization },
    });

    if (data.status === "SUCCESS") {
      return data.results?.length ? { completed: true, url: data.results[0].url } : { completed: false, error: "任务成功但未返回视频链接" };
    }
    if (data.status === "FAILED") return { completed: false, error: `任务失败: ${data.errorMessage || "未知错误"}` };
    if (data.status === "QUEUED" || data.status === "RUNNING") return { completed: false };
    return { completed: false, error: `未知状态: ${data.status}` };
  });
};

/**
 * 智谱AI CogVideoX 视频生成
 * API文档: https://docs.bigmodel.cn/cn/guide/models/free/cogvideox-flash
 * 支持 CogVideoX-Flash 等模型
 */
async function generateZhipuVideo(input: VideoConfig, config: AIConfig) {
  const apiKey = config.apiKey.replace(/^Bearer\s+/i, "").trim();
  const baseURL = (config.baseURL || "https://open.bigmodel.cn/api/paas/v4").replace(/\/+$/, "");

  // 构建请求体
  const body: Record<string, any> = {
    model: config.model,
    prompt: input.prompt,
  };

  // 添加可选参数
  if (input.duration) {
    body.duration = input.duration; // 视频时长（秒）
  }
  
  // 尺寸设置
  if (input.aspectRatio) {
    const ratioMap: Record<string, string> = {
      "16:9": "1920x1080",
      "9:16": "1080x1920",
      "1:1": "1080x1080",
    };
    body.size = ratioMap[input.aspectRatio] || "1920x1080";
  }

  // 图生视频：如果提供了参考图片
  if (input.imageBase64 && input.imageBase64.length > 0) {
    // 智谱CogVideoX支持image参数
    const cleanBase64 = input.imageBase64[0].replace(/^data:image\/[a-z]+;base64,/i, "");
    body.image = cleanBase64;
  }

  try {
    // 提交生成任务
    const { data } = await axios.post(
      `${baseURL}/videos/generations`,
      body,
      {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 60000,
      }
    );

    // 智谱返回: { id: string, model: string, request_id: string }
    if (!data.id) {
      console.error("智谱API返回:", data);
      throw new Error("智谱视频生成任务提交失败，未获取到任务ID");
    }

    const taskId = data.id;

    // 轮询查询任务状态
    return await pollTask(async () => {
      const { data: queryData } = await axios.get(
        `${baseURL}/videos/${taskId}`,
        {
          headers: {
            "Authorization": `Bearer ${apiKey}`,
          },
          timeout: 30000,
        }
      );

      // 智谱返回格式: { id, model, status: "PROCESSING" | "SUCCESS" | "FAILED", video_result?: { url: string } }
      const status = queryData.status;

      if (status === "SUCCESS") {
        const videoUrl = queryData.video_result?.url;
        if (!videoUrl) {
          return { completed: false, error: "任务成功但未返回视频链接" };
        }
        return { completed: true, url: videoUrl };
      }

      if (status === "FAILED") {
        return { completed: false, error: `任务失败: ${queryData.error || "未知错误"}` };
      }

      if (status === "PROCESSING" || status === "PENDING") {
        return { completed: false };
      }

      return { completed: false, error: `未知状态: ${status}` };
    });

  } catch (error) {
    const msg = u.error(error).message || "智谱视频生成失败";
    throw new Error(msg);
  }
}

/**
 * 魔塔ModelScope 视频生成
 * API文档: https://www.modelscope.cn/docs/model-service/API-Inference/intro
 * 使用原生API格式或OpenAI兼容格式
 */
async function generateModelScopeVideo(input: VideoConfig, config: AIConfig) {
  const apiKey = config.apiKey.replace(/^Bearer\s+/i, "").trim();
  
  // ModelScope视频生成通常使用原生API
  const baseURL = (config.baseURL || "https://api-inference.modelscope.cn/api/v1").replace(/\/+$/, "");

  // 构建请求体（原生格式）
  const body: Record<string, any> = {
    input: {
      prompt: input.prompt,
    },
    parameters: {},
  };

  // 添加参数
  if (input.duration) {
    body.parameters.duration = input.duration;
  }

  if (input.aspectRatio) {
    body.parameters.aspect_ratio = input.aspectRatio;
  }

  // 图生视频
  if (input.imageBase64 && input.imageBase64.length > 0) {
    const cleanBase64 = input.imageBase64[0].replace(/^data:image\/[a-z]+;base64,/i, "");
    body.input.image = cleanBase64;
  }

  try {
    // 提交任务
    const { data } = await axios.post(
      `${baseURL}/models/${config.model}/inference`,
      body,
      {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 60000,
      }
    );

    // ModelScope返回格式可能因模型而异，这里处理常见的异步任务格式
    // 有些模型直接返回结果，有些返回任务ID需要轮询
    const taskId = data.output?.task_id || data.task_id || data.id;

    if (!taskId) {
      // 如果直接返回了结果
      if (data.output?.video_url || data.video_url) {
        const videoUrl = data.output?.video_url || data.video_url;
        return { completed: true, url: videoUrl };
      }
      console.error("ModelScope返回:", data);
      throw new Error("ModelScope视频生成失败，未获取到任务ID或结果");
    }

    // 轮询查询任务状态
    return await pollTask(async () => {
      const { data: queryData } = await axios.get(
        `${baseURL}/tasks/${taskId}`,
        {
          headers: {
            "Authorization": `Bearer ${apiKey}`,
          },
          timeout: 30000,
        }
      );

      const status = queryData.status || queryData.output?.status;

      if (status === "SUCCEEDED" || status === "SUCCESS") {
        const videoUrl = queryData.output?.video_url || queryData.video_url || queryData.results?.[0]?.url;
        if (!videoUrl) {
          return { completed: false, error: "任务成功但未返回视频链接" };
        }
        return { completed: true, url: videoUrl };
      }

      if (status === "FAILED") {
        return { completed: false, error: `任务失败: ${queryData.error || queryData.message || "未知错误"}` };
      }

      if (status === "RUNNING" || status === "PENDING" || status === "QUEUED") {
        return { completed: false };
      }

      return { completed: false, error: `未知状态: ${status}` };
    });

  } catch (error) {
    const msg = u.error(error).message || "ModelScope视频生成失败";
    throw new Error(msg);
  }
}
