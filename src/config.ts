import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  LLM_API_KEY: z.string().min(1, "LLM_API_KEY 不能为空"),
  LLM_BASE_URL: z.string().min(1, "LLM_BASE_URL 不能为空"),
  LLM_MODEL: z.string().default("ecnu-plus"),
  PLANTUML_JAR: z.string().default("./assets/plantuml/plantuml-1.2025.1.jar"),
  TEMP_DIR: z.string().default("./temp"),
  OUTPUT_DIR: z.string().default("./temp"),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error("环境变量校验失败：");
  console.error(result.error.flatten().fieldErrors);
  throw new Error("Invalid environment variables");
}

export const config = result.data;
export type AppConfig = typeof config;

