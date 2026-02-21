import "../type";
import axios from "axios";
import u from "@/utils";

/**
 * ModelScope 魔塔图像生成接口（原生API格式）
 * 适用于特定的ModelScope模型
 * @param input ImageConfig 类型
 * @param config AIConfig 类型
 * @returns 图片URL 或 base64
 */
export default async (input: ImageConfig, config: AIConfig): Promise<string> => {
  // 参数校验
  if (!config.model) throw new Error("缺少Model名称");
  if (!config.apiKey) throw new Error("缺少API Key");
  if (!input.prompt) throw new Error("缺少提示词，prompt为必填项");

  // 清理API Key和baseURL（注意：原生格式使用不同的baseURL）
  const apiKey = config.apiKey.replace(/^Bearer\s+/i, "").trim();
  const baseURL = (config.baseURL || "https://api-inference.modelscope.cn/api/v1").replace(/\/+$/, "");

  // 构建原生格式请求体
  const requestData: any = {
    input: {
      prompt: input.prompt,
    },
    parameters: {
      // 可以添加其他参数如 size, seed 等
      ...(input.size && { size: input.size }),
      ...(input.seed !== undefined && { seed: input.seed }),
    },
  };

  // 处理图片输入（图生图）
  if (input.imageBase64 && input.imageBase64.length > 0) {
    // 原生格式通常需要去掉data URI前缀
    requestData.input.image = input.imageBase64[0].replace(/^data:image\/[a-z]+;base64,/i, "");
  } else if (input.imageUrl) {
    requestData.input.image_url = input.imageUrl;
  }

  try {
    // 调用ModelScope原生API
    const { data } = await axios.post(
      `${baseURL}/models/${config.model}/inference`,
      requestData,
      {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 120000,
      }
    );

    // 原生格式返回结构可能不同，需要适配
    // 常见返回格式: { output: { image_url: string } } 或 { output: { image_base64: string } }
    
    if (data.output?.image_url) {
      const imageUrl = data.output.image_url;
      
      if (input.resType === "b64") {
        const res = await axios.get(imageUrl, { responseType: "arraybuffer" });
        const base64 = Buffer.from(res.data).toString("base64");
        const mimeType = res.headers["content-type"] || "image/png";
        return `data:${mimeType};base64,${base64}`;
      }
      return imageUrl;
    }
    
    if (data.output?.image_base64) {
      const base64 = data.output.image_base64;
      // 确保有data URI前缀
      if (base64.startsWith("data:image")) {
        return base64;
      }
      return `data:image/png;base64,${base64}`;
    }
    
    if (data.output?.text) {
      // 文本类模型（如图像理解），按原项目规范返回
      return `data:text/plain;base64,${Buffer.from(data.output.text).toString("base64")}`;
    }

    console.error("ModelScope返回数据:", data);
    throw new Error("ModelScope接口返回格式不支持或未获取到图片");

  } catch (error) {
    const msg = u.error(error).message || "ModelScope图像生成失败";
    throw new Error(msg);
  }
};
