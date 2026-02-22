import "../type";
import axios from "axios";
import FormData from "form-data";
import { pollTask } from "@/utils/ai/utils";
import u from "@/utils";

/**
 * 通用OpenAI兼容接口 + 智谱AI + 魔塔ModelScope 视频生成
 */
export default async (input: VideoConfig, config: AIConfig) => {
  if (!config.apiKey) throw new Error("缺少API Key");
  if (!config.model) throw new Error("缺少Model名称");

  const model = config.model;
  const apiKey = config.apiKey.replace(/^Bearer\s+/i, "").trim();
  const baseURL = config.baseURL ? config.baseURL.trim() : "";

  // ==================== 智谱AI (CogVideoX) ====================
  if (model.toLowerCase().includes("cogvideo")) {
    return await generateZhipuVideo(input, { ...config, apiKey, baseURL });
  }

  // ==================== 魔塔ModelScope (视频生成) ====================
  if (model.includes("/") || model.toLowerCase().includes("modelscope")) {
    return await generateModelScopeVideo(input, { ...config, apiKey, baseURL });
  }

  // ==================== 标准OpenAI兼容接口（原有逻辑） ====================
  if (!baseURL) throw new Error("缺少baseURL");
  
  const [requestUrl, queryUrl] = baseURL.split("|");
  const authorization = `Bearer ${config.apiKey}`;

  const formData = new FormData();
  formData.append("model", config.model);
  formData.append("prompt", input.prompt);
  formData.append("seconds", String(input.duration));

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
 */
async function generateZhipuVideo(input: VideoConfig, config: AIConfig) {
  const apiKey = config.apiKey;
  const baseURL = (config.baseURL || "https://open.bigmodel.cn/api/paas/v4").replace(/\/+$/, "");

  console.log("%c 智谱视频请求", "background:#33a5ff", { model: config.model, baseURL });

  const body: Record<string, any> = {
    model: config.model,
    prompt: input.prompt,
  };

  if (input.duration) {
    body.duration = input.duration;
  }
  
  if (input.aspectRatio) {
    const ratioMap: Record<string, string> = {
      "16:9": "1920x1080",
      "9:16": "1080x1920",
      "1:1": "1080x1080",
    };
    body.size = ratioMap[input.aspectRatio] || "1920x1080";
  }

  if (input.imageBase64 && input.imageBase64.length > 0) {
    const cleanBase64 = input.imageBase64[0].replace(/^data:image\/[a-z]+;base64,/i, "");
    body.image = cleanBase64;
  }

  try {
    console.log("%c 智谱视频请求体", "background:#33a5ff", body);
    
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

    console.log("%c 智谱视频提交返回", "background:#4fff4B", data);

    if (!data.id) {
      throw new Error("智谱视频生成任务提交失败: " + JSON.stringify(data));
    }

    const taskId = data.id;

    return await pollTask(async () => {
      try {
        const { data: queryData } = await axios.get(
          `${baseURL}/videos/${taskId}`,
          {
            headers: {
              "Authorization": `Bearer ${apiKey}`,
            },
            timeout: 30000,
          }
        );

        console.log("%c 智谱视频查询返回", "background:#4fff4B", queryData);

        const status = queryData.status;

        if (status === "SUCCESS" || status === "succeed") {
          const videoUrl = queryData.video_result?.url || queryData.url;
          if (!videoUrl) {
            return { completed: false, error: "任务成功但未返回视频链接" };
          }
          return { completed: true, url: videoUrl };
        }

        if (status === "FAILED" || status === "failed") {
          return { completed: false, error: `任务失败: ${queryData.error || queryData.errorMessage || "未知错误"}` };
        }

        if (status === "PROCESSING" || status === "PENDING" || status === "RUNNING") {
          return { completed: false };
        }

        return { completed: false, error: `未知状态: ${status}` };
      } catch (pollError: any) {
        console.error("%c 智谱视频轮询错误", "background:#ff3333", pollError.response?.data || pollError.message);
        return { completed: false, error: `查询任务失败: ${pollError.message}` };
      }
    });

  } catch (error: any) {
    console.error("%c 智谱视频错误", "background:#ff3333", error.response?.data || error.message);
    const msg = u.error(error).message || "智谱视频生成失败";
    throw new Error(msg);
  }
}

/**
 * 魔塔ModelScope 视频生成
 */
async function generateModelScopeVideo(input: VideoConfig, config: AIConfig) {
  const apiKey = config.apiKey;
  const baseURL = (config.baseURL || "https://api-inference.modelscope.cn/v1").replace(/\/+$/, "");

  console.log("%c ModelScope视频请求", "background:#33a5ff", { model: config.model, baseURL });

  const body: Record<string, any> = {
    model: config.model,
    prompt: input.prompt,
  };

  if (input.duration) {
    body.duration = input.duration;
  }

  if (input.aspectRatio) {
    body.aspect_ratio = input.aspectRatio;
  }

  if (input.imageBase64 && input.imageBase64.length > 0) {
    const cleanBase64 = input.imageBase64[0].replace(/^data:image\/[a-z]+;base64,/i, "");
    body.image = cleanBase64;
  }

  try {
    console.log("%c ModelScope视频请求体", "background:#33a5ff", body);
    
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

    console.log("%c ModelScope视频提交返回", "background:#4fff4B", data);

    if (data.video_url || data.url) {
      return { completed: true, url: data.video_url || data.url };
    }

    const taskId = data.id || data.task_id || data.output?.task_id;
    
    if (!taskId) {
      throw new Error("ModelScope视频生成失败，未获取到任务ID: " + JSON.stringify(data));
    }

    return await pollTask(async () => {
      try {
        const { data: queryData } = await axios.get(
          `${baseURL}/tasks/${taskId}`,
          {
            headers: {
              "Authorization": `Bearer ${apiKey}`,
            },
            timeout: 30000,
          }
        );

        console.log("%c ModelScope视频查询返回", "background:#4fff4B", queryData);

        const status = queryData.status || queryData.output?.status;

        if (status === "SUCCEEDED" || status === "SUCCESS" || status === "succeed") {
          const videoUrl = queryData.video_url || queryData.output?.video_url || queryData.results?.[0]?.url;
          if (!videoUrl) {
            return { completed: false, error: "任务成功但未返回视频链接" };
          }
          return { completed: true, url: videoUrl };
        }

        if (status === "FAILED" || status === "failed") {
          return { completed: false, error: `任务失败: ${queryData.error || queryData.message || "未知错误"}` };
        }

        if (status === "RUNNING" || status === "PENDING" || status === "QUEUED" || status === "PROCESSING") {
          return { completed: false };
        }

        return { completed: false, error: `未知状态: ${status}` };
      } catch (pollError: any) {
        console.error("%c ModelScope视频轮询错误", "background:#ff3333", pollError.response?.data || pollError.message);
        return { completed: false, error: `查询任务失败: ${pollError.message}` };
      }
    });

  } catch (error: any) {
    console.error("%c ModelScope视频错误", "background:#ff3333", error.response?.data || error.message);
    const msg = u.error(error).message || "ModelScope视频生成失败";
    throw new Error(msg);
  }
}
