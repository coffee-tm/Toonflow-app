import type { ImageConfig, AIConfig } from "../type";
import axios from "axios";

/**
 * 魔塔ModelScope图片接口（贴合原项目入参/出参规范）
 * @param input 原项目ImageConfig类型
 * @param config 原项目AIConfig类型
 * @returns 图片URL | base64
 */
export default async (input: ImageConfig, config: AIConfig) => {
  const { model, apiKey, baseURL } = config;
  const modelScopeBaseUrl = baseURL || "https://inference.modelscope.cn/api/v1";

  // 构建魔塔请求参数（适配原项目ImageConfig）
  const requestData: any = {
    input: {},
    parameters: {
      // 复用原项目传入的额外参数
      ...input.extraParams,
    },
  };

  // 处理图片输入（原项目支持imageBase64数组）
  if (input.imageBase64 && input.imageBase64.length > 0) {
    // 魔塔接口默认取第一张图片
    requestData.input.image = input.imageBase64[0];
  } else if (input.imageUrl) {
    requestData.input.image = input.imageUrl;
  } else {
    throw new Error("魔塔接口：未传入有效图片（imageBase64/imageUrl）");
  }

  // 调用魔塔推理接口（原项目axios风格）
  const response = await axios.post(
    `${modelScopeBaseUrl}/models/${model}/inference`,
    requestData,
    {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    }
  );

  // 魔塔接口返回结果适配（按原项目规范返回图片URL/base64）
  const result = response.data;
  // 不同魔塔模型返回格式不同，兼容两种场景：
  // 场景1：直接返回图片URL
  if (result.output?.image_url) {
    return result.output.image_url;
  }
  // 场景2：返回base64
  if (result.output?.image_base64) {
    return result.output.image_base64;
  }
  // 场景3：返回文本结果（如图片分析），适配原项目返回格式
  if (result.output?.text) {
    // 若为文本类模型，返回特殊标识（贴合原项目逻辑）
    return `data:text/plain;base64,${Buffer.from(result.output.text).toString("base64")}`;
  }

  throw new Error("魔塔接口返回格式不支持");
};
