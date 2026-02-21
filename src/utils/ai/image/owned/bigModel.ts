import "../type";
import axios from "axios";
import u from "@/utils";

/**
 * 智谱AI BigModel 图像生成接口 (CogView系列)
 * 支持模型: cogview-3-flash, cogview-4, cogview-4-250304, GLM-Image
 * @param input ImageConfig 类型
 * @param config AIConfig 类型
 * @returns 图片URL 或 base64
 */
export default async (input: ImageConfig, config: AIConfig): Promise<string> => {
  // 参数校验
  if (!config.model) throw new Error("缺少Model名称");
  if (!config.apiKey) throw new Error("缺少API Key");
  if (!input.prompt) throw new Error("缺少提示词，prompt为必填项");

  // 清理API Key
  const apiKey = config.apiKey.replace(/^Bearer\s+/i, "").trim();
  
  // 设置baseURL（注意：去掉末尾空格！）
  const baseURL = (config.baseURL || "https://open.bigmodel.cn/api/paas/v4").replace(/\/+$/, "");
  
  // 支持智谱所有图像生成模型
  const supportedModels = [
    "cogview-3-flash",
    "cogview-4", 
    "cogview-4-250304",
    "GLM-Image"
  ];
  
  if (!supportedModels.includes(config.model)) {
    throw new Error(`不支持的模型: ${config.model}，请使用: ${supportedModels.join(", ")}`);
  }

  // 构建请求体
  const body: Record<string, any> = {
    model: config.model,
    prompt: input.prompt,
    // 智谱可选参数
    ...(input.size && { size: input.size }),
  };

  // 如果有参考图片（图生图），智谱CogView支持image参数（base64）
  if (input.imageBase64 && input.imageBase64.length > 0) {
    // 智谱要求去掉data:image前缀
    const cleanBase64 = input.imageBase64[0].replace(/^data:image\/[a-z]+;base64,/i, "");
    body.image = cleanBase64;
  }

  try {
    // 调用智谱图像生成API
    const { data } = await axios.post(
      `${baseURL}/images/generations`,
      body,
      {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 60000, // 图像生成可能需要较长时间
      }
    );

    // 智谱返回格式: { created: number, data: [{ url: string }] }
    if (!data.data || !data.data[0]?.url) {
      throw new Error("智谱API返回格式错误，未获取到图片URL");
    }

    const imageUrl = data.data[0].url;
    
    // 如果要求返回base64格式，需要下载转换
    if (input.resType === "b64") {
      const res = await axios.get(imageUrl, { responseType: "arraybuffer" });
      const base64 = Buffer.from(res.data).toString("base64");
      const mimeType = res.headers["content-type"] || "image/png";
      return `data:${mimeType};base64,${base64}`;
    }
    
    // 默认返回URL
    return imageUrl;
    
  } catch (error) {
    const msg = u.error(error).message || "智谱图像生成失败";
    throw new Error(msg);
  }
};
