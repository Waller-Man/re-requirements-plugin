import axios from "axios";
import { config } from "./config.js";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

export async function chatOnce(messages: ChatMessage[], model?: string): Promise<string> {
  const response = await axios.post<ChatCompletionResponse>(
    config.LLM_BASE_URL,
    {
      messages,
      model: model ?? config.LLM_MODEL,
      //reasoning_effort: "minimal",   //豆包 test
      stream: false,
    },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.LLM_API_KEY}`,
      },
      timeout: 360000,
    }
  );

  const content = response.data?.choices?.[0]?.message?.content?.trim();

  if (!content) {
    throw new Error("模型返回中没有有效 content");
  }

  return content;
}