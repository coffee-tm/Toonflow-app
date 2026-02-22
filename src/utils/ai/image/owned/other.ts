import "../type";
import { generateImage, generateText, ModelMessage } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import axios from "axios";
import u from "@/utils";

/**
 * 通用OpenAI兼容接口 + 智谱AI + 魔塔ModelScope 图像生成
 */
export default async (input: ImageConfig, config: AIConfig): Promise<string> => {
  if (!config.model) throw new Error("缺少Model名称");
  if (!config.apiKey) throw new Error("缺少API Key");

  const model = config.model;
  const apiKey = config.apiKey.replace(/^Bearer\s+/i, "").trim();
  
  // 清理baseURL，去除首尾空格
  const baseURL = config.baseURL ? config.baseURL.trim() : "";

  // ==================== 智谱AI (CogView) - 不区分大小写 ====================
  if (model.toLowerCase().includes("cogview") || model.toLowerCase().includes("glm-image")) {
    return await generateZhipuImage(input, { ...config, apiKey, baseURL });
  }

  // ==================== 魔塔ModelScope (图像生成) ====================
  // ModelScope模型ID通常包含斜杠，如：Tongyi-MAI/Z-Image-Turbo
  if (model.includes("/") || model.toLowerCase().includes("modelscope") || model.toLowerCase().includes("z-image")) {
    return await generateModelScopeImage(input, { ...config, apiKey, baseURL });
  }

  // ==================== 标准OpenAI兼容接口（原有逻辑） ====================
  if (!baseURL) throw new Error("缺少baseUrl");

  const otherProvider = createOpenAICompatible({
    name: "xixixi",
    baseURL: baseURL,
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  // 根据 size 配置映射到具体尺寸
  const sizeMap: Record<string, string> = {
    "1K": "1024x1024",
    "2K": "2048x2048",
    "4K": "4096x4096",
  };
  
  // 构建完整的提示词
  const fullPrompt = input.systemPrompt ? `${input.systemPrompt}\n\n${input.prompt}` : input.prompt;

  if (model.includes("gemini") || model.includes("nano")) {
    let promptData;
    if (input.imageBase64 && input.imageBase64.length) {
      promptData = [{ role: "system", content: fullPrompt + `请直接输出图片` }];
      (promptData as ModelMessage[]).push({
        role: "user",
        content: input.imageBase64.map((i) => ({
          type: "image",
          image: i,
        })),
      });
    } else {
      promptData = fullPrompt + `\n请直接输出图片`;
    }

    const result = await generateText({
      model: otherProvider.languageModel(model),
      prompt: promptData as string | ModelMessage[],
      providerOptions: {
        google: {
          imageConfig: {
            ...(config.model == "gemini-2.5-flash-image"
              ? { aspectRatio: input.aspectRatio }
              : { aspectRatio: input.aspectRatio, imageSize: input.size }),
          },
          responseModalities: ["IMAGE"],
        },
      },
    });

    if (result.files && result.files.length) {
      let imageBase64;
      for (const item of result.files) {
        imageBase64 = `data:${item.mediaType};base64,${item.base64}`;
      }
      return imageBase64!;
    } else {
      if (!result.text) {
        console.error(JSON.stringify(result.response, null, 2));
        throw new Error("图片生成失败");
      }
      const mdMatch = result.text.match(/^!\[.*?\]\((.+?)\)$/);
      if (mdMatch) {
        const imgInfo = mdMatch[1];
        const base64InMd = imgInfo.match(/data:image\/[a-z]+;base64,(.+)/);
        if (base64InMd) {
          return imgInfo;
        } else {
          return await urlToBase64(imgInfo);
        }
      }
      const base64Match = result.text.match(/base64,([A-Za-z0-9+/=]+)/);

      if (base64Match) {
        return "data:image/jpeg;base64," + base64Match[1];
      }
      if (/^https?:\/\/.*\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(result.text)) {
        return await urlToBase64(result.text);
      }
      return result.text;
    }
  } else {
    const { image } = await generateImage({
      model: otherProvider.imageModel(model),
      prompt:
        input.imageBase64 && input.imageBase64.length
          ? { text: fullPrompt + `请直接输出图片`, images: input.imageBase64 }
          : fullPrompt + `请直接输出图片`,
      aspectRatio: input.aspectRatio as "1:1" | "3:4" | "4:3" | "9:16" | "16:9",
      size: sizeMap[input.size] ?? "1024x1024",
    });

    return image.base64;
  }
};

/**
 * 智谱AI CogView 图像生成
 */
async function generateZhipuImage(input: ImageConfig, config: AIConfig): Promise<string> {
  const apiKey = config.apiKey;
  const baseURL = (config.baseURL || "https://open.bigmodel.cn/api/paas/v4").replace(/\/+$/, "");
  
  console.log("%c 智谱AI请求", "background:#33a5ff", { model: config.model, baseURL });
  
  const body: Record<string, any> = {
    model: config.model,
    prompt: input.prompt,
  };

  if (input.size) {
    body.size = input.size;
  }
  
  if (input.quality) {
    body.quality = input.quality;
  }

  if (input.imageBase64 && input.imageBase64.length > 0) {
    const cleanBase64 = input.imageBase64[0].replace(/^data:image\/[a-z]+;base64,/i, "");
    body.image = cleanBase64;
  }

  try {
    const { data } = await axios.post(
      `${baseURL}/images/generations`,
      body,
      {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 120000,
      }
    );

    console.log("%c 智谱AI返回", "background:#4fff4B", data);

    if (!data.data || !data.data[0]?.url) {
      throw new Error("智谱API返回格式错误: " + JSON.stringify(data));
    }

    const imageUrl = data.data[0].url;
    
    if (input.resType === "b64") {
      const res = await axios.get(imageUrl, { responseType: "arraybuffer" });
      const base64 = Buffer.from(res.data).toString("base64");
      const mimeType = res.headers["content-type"] || "image/png";
      return `data:${mimeType};base64,${base64}`;
    }
    
    return imageUrl;
    
  } catch (error: any) {
    console.error("%c 智谱AI错误", "background:#ff3333", error.response?.data || error.message);
    const msg = u.error(error).message || "智谱图像生成失败";
    throw new Error(msg);
  }
}

/**
 * 魔塔ModelScope 图像生成 - 使用OpenAI兼容格式
 */
async function generateModelScopeImage(input: ImageConfig, config: AIConfig): Promise<string> {
  const apiKey = config.apiKey;
  const baseURL = (config.baseURL || "https://api-inference.modelscope.cn/v1").replace(/\/+$/, "");
  
  console.log("%c ModelScope请求", "background:#33a5ff", { model: config.model, baseURL });

  const body: Record<string, any> = {
    model: config.model,
    prompt: input.prompt,
    n: 1,
  };

  if (input.size) {
    body.size = input.size;
  }
  
  if (input.seed !== undefined) {
    body.seed = input.seed;
  }

  if (input.imageBase64 && input.imageBase64.length > 0) {
    const cleanBase64 = input.imageBase64[0].replace(/^data:image\/[a-z]+;base64,/i, "");
    body.image = cleanBase64;
  }

  try {
    const { data } = await axios.post(
      `${baseURL}/images/generations`,
      body,
      {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 120000,
      }
    );

    console.log("%c ModelScope返回", "background:#4fff4B", data);

    if (!data.images || !data.images[0]?.url) {
      throw new Error("ModelScope API返回格式错误: " + JSON.stringify(data));
    }

    const imageUrl = data.images[0].url;
    
    if (input.resType === "b64") {
      const res = await axios.get(imageUrl, { responseType: "arraybuffer" });
      const base64 = Buffer.from(res.data).toString("base64");
      const mimeType = res.headers["content-type"] || "image/png";
      return `data:${mimeType};base64,${base64}`;
    }
    
    return imageUrl;
    
  } catch (error: any) {
    console.error("%c ModelScope错误", "background:#ff3333", error.response?.data || error.message);
    const msg = u.error(error).message || "ModelScope图像生成失败";
    throw new Error(msg);
  }
}

async function urlToBase64(url: string): Promise<string> {
  const res = await axios.get(url, { responseType: "arraybuffer" });
  const base64 = Buffer.from(res.data).toString("base64");
  const mimeType = res.headers["content-type"] || "image/png";
  return `data:${mimeType};base64,${base64}`;
}
