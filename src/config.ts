import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  LLM_API_KEY: z.string().min(1, "LLM_API_KEY 未配置"),
  LLM_BASE_URL: z.string().url("LLM_BASE_URL 不是合法 URL"),
  LLM_MODEL: z.string().min(1).default("ecnu-plus"),
  PLANTUML_JAR: z.string().min(1).default("./assets/plantuml/plantuml-1.2025.1.jar"),
  TEMP_DIR: z.string().min(1).default("./temp"),
  OUTPUT_DIR: z.string().min(1).default("./temp"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("环境变量配置错误：");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;