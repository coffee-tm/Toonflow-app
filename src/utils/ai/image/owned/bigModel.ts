import type { ImageConfig, AIConfig } from "../type";
import axios from "axios";

/**
 * 智普BigModel图片接口（GLM-4V）
 * 贴合原项目入参/出参规范
 * @param input 原项目ImageConfig类型
 * @param config 原项目AIConfig类型
 * @returns 图片URL | base64 | 文本结果base64
 */
export default async (input: ImageConfig, config: AIConfig) => {
  const { model, apiKey, baseURL } = config;
  const bigModelBaseUrl = baseURL || "https://open.bigmodel.cn/api/paas/v4";

  // 校验智普多模态模型
  if (!model || !["glm-4v", "glm-4v-plus"].includes(model)) {
    throw new Error("智普接口仅支持glm-4v/glm-4v-plus模型");
  }

  // 处理图片输入（原项目imageBase64数组）
  let imageContent = "";
  if (input.imageBase64 && input.imageBase64.length > 0) {
    // 智普要求base64去掉data:image前缀
    imageContent = input.imageBase64[0].split(",")[1] || input.imageBase64[0];
  } else if (input.imageUrl) {
    throw new Error("智普接口暂不支持imageUrl，仅支持imageBase64");
  } else {
    throw new Error("智普接口：未传入有效图片（imageBase64）");
  }

  // 构建智普多模态请求（适配原项目prompt参数）
  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: input.prompt || "分析这张图片的内容" },
        { 
          type: "image_url", 
          image_url: { url: `data:image/jpeg;base64,${imageContent}` } 
        },
      ],
    },
  ];

  // 调用智普接口（原项目axios风格）
  const response = await axios.post(
    `${bigModelBaseUrl}/chat/completions`,
    {
      model,
      messages,
      temperature: input.temperature || 0.7,
      top_p: input.top_p || 0.9,
      max_tokens: input.max_tokens || 1024,
    },
    {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    }
  );

  // 智普返回结果适配原项目规范（返回base64格式文本）
  const resultText = response.data.choices[0].message.content;
  return `data:text/plain;base64,${Buffer.from(resultText).toString("base64")}`;
};
