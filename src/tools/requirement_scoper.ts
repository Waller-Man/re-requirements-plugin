import { z } from "zod";
import { chatOnce } from "../llmClient.js";
import { config } from "../config.js";
import { saveArtifactAndBuildResult } from "../artifact_io.js";

// 输入 schema：当前 tool 只需要一段软件需求描述
export const RequirementScoperInputSchema = z.object({
  softwareIntro: z.string().min(1, "softwareIntro 不能为空"),
});

export type RequirementScoperInput = z.infer<typeof RequirementScoperInputSchema>;

// 轻量输出 schema：不再把大结果直接返回给模型
export const RequirementScoperOutputSchema = z.object({
  status: z.enum(["success", "error"]),
  summary: z.string(),
  outputPath: z.string().optional(),
  outputType: z.string().optional(),
});

export type RequirementScoperOutput = z.infer<typeof RequirementScoperOutputSchema>;

// 真正写入文件的完整内容结构
export const RequirementScoperArtifactSchema = z.object({
  dataEntitiesText: z.string(),
  useCasesText: z.string(),
  dataEntities: z.array(z.string()),
  useCases: z.array(z.string()),
});

export type RequirementScoperArtifact = z.infer<
  typeof RequirementScoperArtifactSchema
>;

// 兼容中英文逗号、顿号的简单拆分函数
function splitCommaLike(text: string): string[] {
  return text
    .split(/[，、,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

// 构造“抽取数据实体”的 prompt
function buildEntityPrompt(softwareIntro: string): string {
  return `
You are a requirements engineering expert.

Task:
Identify the most core data entities from the following software description.

Software Description:
${softwareIntro}

Definition:
Data entities are objects, concepts, or records with independent existence and specific attributes in a software system. They are usually stored, managed, or operated on by the system.

Instructions:
1. Deeply analyze the software description and extract only the most core data entities.
2. Focus on important nouns that represent business objects or managed records.
3. Prefer entities that are central to the main business flow.
4. For information systems, consider whether an Administrator entity is needed.
5. Keep the initial entity list concise.
6. The number of entities should be less than 4.
7. Do not include explanations, reasoning, numbering, or extra text.

Output Format:
Return only the final entity names, separated by commas.

Example:
Project, Task, Team Member, Administrator

Please answer in English.
`.trim();
}

// 构造“生成初始用例”的 prompt
function buildUseCasePrompt(softwareIntro: string, entities: string[]): string {
  return `
You are a requirements engineering expert.

Task:
Generate the most relevant initial use cases based on the software description and the given data entities.

Software Description:
${softwareIntro}

Data Entities:
${entities.join(", ")}

Instructions:
1. Generate business use cases that match the role and lifecycle of each entity.
2. Use cases may involve create, read, update, delete, manage, search, view, register, submit, or other business-appropriate actions.
3. Do not mechanically generate CRUD for every entity. Keep only the most meaningful business use cases.
4. Make sure the use cases reflect realistic business scenarios.
5. Keep the total number of use cases no more than 8.
6. Do not include explanations, reasoning, numbering, or extra text.

Output Format:
Return only the final use case names, separated by commas.

Example:
Manage Project, Create Task, View Progress, Update Team Member, Delete Task

Please answer in English.
`.trim();
}

// 第一个 tool：输入需求文本，输出文件路径而不是大正文
export async function requirementScoper(
  input: RequirementScoperInput
): Promise<RequirementScoperOutput> {
  const parsedInput = RequirementScoperInputSchema.parse(input);

  // 第一步：抽取数据实体
  const dataEntitiesText = await chatOnce(
    [
      { role: "system", content: "You are a requirements engineering expert." },
      { role: "user", content: buildEntityPrompt(parsedInput.softwareIntro) },
    ],
    config.LLM_MODEL
  );

  const dataEntities = splitCommaLike(dataEntitiesText);

  // 第二步：基于实体生成初始用例
  const useCasesText = await chatOnce(
    [
      { role: "system", content: "You are a requirements engineering expert." },
      {
        role: "user",
        content: buildUseCasePrompt(parsedInput.softwareIntro, dataEntities),
      },
    ],
    config.LLM_MODEL
  );

  const useCases = splitCommaLike(useCasesText);

  // 这里才是真正的大结果，写到文件里供后续 tool 读取
  const artifact: RequirementScoperArtifact =
    RequirementScoperArtifactSchema.parse({
      dataEntitiesText,
      useCasesText,
      dataEntities,
      useCases,
    });

  // 返回轻量结果，避免把大对象直接塞回模型上下文
  return RequirementScoperOutputSchema.parse(
    await saveArtifactAndBuildResult({
      stage: "requirement_scoper",
      name: "requirement_scoper_result",
      data: artifact,
      extension: "json",
      summary: `Requirement scoping completed. Extracted ${dataEntities.length} data entities and ${useCases.length} use cases.`,
    })
  );
}