import { z } from "zod";
import { chatOnce } from "../llmClient.js";
import { config } from "../config.js";
import {
  readArtifactJson,
  readArtifactText,
  saveArtifactAndBuildResult,
} from "../artifact_io.js";

// -------------------------
// 通用 schema / 小工具
// -------------------------

// 统一的轻量返回结构：不再把大正文直接返回给模型
const PathBasedToolOutputSchema = z.object({
  status: z.enum(["success", "error"]),
  summary: z.string(),
  outputPath: z.string().optional(),
  outputType: z.string().optional(),
});

type PathBasedToolOutput = z.infer<typeof PathBasedToolOutputSchema>;

// requirement_scoper 写入文件后的结构
const RequirementScoperArtifactSchema = z.object({
  dataEntitiesText: z.string(),
  useCasesText: z.string(),
  dataEntities: z.array(z.string()),
  useCases: z.array(z.string()),
});

// ER 模型统一落盘结构
// 这里统一使用 erModelText 这个字段名，方便后续其他 tool 读取
const ErModelArtifactSchema = z.object({
  erModelText: z.string(),
});

// generate_new_use_cases 写入文件后的结构
const NewUseCasesArtifactSchema = z.object({
  appendedSimpleUseCaseText: z.string(),
  newUseCaseText: z.string(),
  newUseCaseList: z.array(z.string()),
});

// 尝试把文件按 JSON 读取；如果不是 JSON，则返回 null
async function tryReadJsonFile(filePath: string): Promise<unknown | null> {
  const raw = await readArtifactText(filePath);

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// 读取 ER 模型文本：优先兼容 json，其次兼容纯文本
async function loadErModelText(filePath: string): Promise<string> {
  const jsonData = await tryReadJsonFile(filePath);

  if (jsonData !== null) {
    const parsed = ErModelArtifactSchema.safeParse(jsonData);
    if (parsed.success) {
      return parsed.data.erModelText.trim();
    }
  }

  // 兜底：如果不是 json，就直接把整个文件当文本
  return (await readArtifactText(filePath)).trim();
}

// 读取“新增用例文本”：优先从 json 中取 newUseCaseText
async function loadNewUseCaseText(filePath: string): Promise<string> {
  const jsonData = await tryReadJsonFile(filePath);

  if (jsonData !== null) {
    const parsed = NewUseCasesArtifactSchema.safeParse(jsonData);
    if (parsed.success) {
      return parsed.data.newUseCaseText.trim();
    }
  }

  // 兜底：如果不是 json，就直接把整个文件当文本
  return (await readArtifactText(filePath)).trim();
}

// -------------------------
// 1) 生成初始 ER 模型
// -------------------------

// 现在不再直接接 dataEntities/useCases，而是接 requirement_scoper 的结果路径
export const GenerateErModelInputSchema = z.object({
  softwareIntro: z.string().min(1, "softwareIntro 不能为空"),
  scoperResultPath: z.string().min(1, "scoperResultPath 不能为空"),
});

export type GenerateErModelInput = z.infer<typeof GenerateErModelInputSchema>;

export const GenerateErModelOutputSchema = PathBasedToolOutputSchema;

export type GenerateErModelOutput = z.infer<typeof GenerateErModelOutputSchema>;

// 构造“生成初始 ER 模型”的 prompt
function buildGenerateErModelPrompt(params: {
  softwareIntro: string;
  dataEntities: string[];
  useCases: string[];
}): string {
  const { softwareIntro, dataEntities, useCases } = params;

  return `
You are responsible for data model design and validation in a requirements team.

Task:
Build a complete E-R model based on the following information.

System Introduction:
${softwareIntro}

Data Entities:
${dataEntities.join(", ")}

Use Cases:
${useCases.join(", ")}

Instructions:
1. Identify relationships among the given entities using business common sense.
2. Infer only necessary missing entities that are strongly implied by the business scenario.
3. Ensure the final model is connected and business-relevant.
4. Include entities, important attributes, and relationships.
5. Avoid unnecessary expansion of system scope.
6. Keep the model reasonably concise.

Rules:
1. Cover all important extracted entities.
2. If new entities are added, they must be grounded in the use cases.
3. Relationships must be meaningful and business-driven.
4. Avoid isolated entities where possible.
5. Do not include explanations outside the final ER model content.

Output Format Example:
E-R Model:
Entities and Attributes:
1. Student: StudentID, Name, Age, Class
2. Book: BookID, Title, Author, SubjectID, Status
3. Admin: AdminID, Name, Role

Relationships:
- Student "1" --> "0..*" BorrowRecord : borrows
- Admin "1" --> "0..*" Book : manages
- Book "1" --> "1" Subject : belongs to

Please answer in English.
`.trim();
}

export async function generateErModel(
  input: GenerateErModelInput
): Promise<GenerateErModelOutput> {
  const parsedInput = GenerateErModelInputSchema.parse(input);

  // 从第一步 scoper 的输出文件中读取实体和用例
  const scoperArtifact = RequirementScoperArtifactSchema.parse(
    await readArtifactJson(parsedInput.scoperResultPath)
  );

  const dataEntities = scoperArtifact.dataEntities;
  const useCases = scoperArtifact.useCases;

  const prompt = buildGenerateErModelPrompt({
    softwareIntro: parsedInput.softwareIntro,
    dataEntities,
    useCases,
  });

  const response = await chatOnce(
    [
      {
        role: "system",
        content: "You are responsible for ER model generation.",
      },
      { role: "user", content: prompt },
    ],
    config.LLM_MODEL
  );

  // 统一把 ER 模型正文写成 erModelText，便于后续通用读取
  const artifact = ErModelArtifactSchema.parse({
    erModelText: response.trim(),
  });

  return GenerateErModelOutputSchema.parse(
    await saveArtifactAndBuildResult({
      stage: "er_model_builder_generate_er_model",
      name: "er_model",
      data: artifact,
      extension: "json",
      summary: `Initial ER model generated based on ${dataEntities.length} data entities and ${useCases.length} use cases.`,
    })
  );
}

// -------------------------
// 2) 检查 / 修正 ER 模型
// -------------------------

export const CheckErModelInputSchema = z.object({
  softwareIntro: z.string().min(1, "softwareIntro 不能为空"),
  scoperResultPath: z.string().min(1, "scoperResultPath 不能为空"),
  erModelPath: z.string().min(1, "erModelPath 不能为空"),
});

export type CheckErModelInput = z.infer<typeof CheckErModelInputSchema>;

export const CheckErModelOutputSchema = PathBasedToolOutputSchema;

export type CheckErModelOutput = z.infer<typeof CheckErModelOutputSchema>;

// 构造“检查 / 修正 ER 模型”的 prompt
function buildCheckErModelPrompt(params: {
  softwareIntro: string;
  dataEntities: string[];
  useCases: string[];
  erModelText: string;
}): string {
  const { softwareIntro, dataEntities, useCases, erModelText } = params;

  return `
You are responsible for validating and improving an existing E-R model.

System Introduction:
${softwareIntro}

Data Entities:
${dataEntities.join(", ")}

Use Cases:
${useCases.join(", ")}

Current ER Model:
${erModelText}

Validation Goals:
1. Check whether any important entities are missing.
2. Check whether any important relationships are missing.
3. Check whether there are isolated or weakly justified entities.
4. Improve consistency of naming and business logic.
5. Remove unnecessary redundancy if needed.

Rules:
1. Keep the final model complete, consistent, and business-grounded.
2. Do not invent entities that are not supported by the system description or use cases.
3. Preserve useful existing content when possible.
4. Return only the improved ER model content.

Please answer in English.
`.trim();
}

export async function checkErModel(
  input: CheckErModelInput
): Promise<CheckErModelOutput> {
  const parsedInput = CheckErModelInputSchema.parse(input);

  // 一份从 scoper 结果里取，一份从已有 erModel 文件里取
  const scoperArtifact = RequirementScoperArtifactSchema.parse(
    await readArtifactJson(parsedInput.scoperResultPath)
  );
  const erModelText = await loadErModelText(parsedInput.erModelPath);

  const prompt = buildCheckErModelPrompt({
    softwareIntro: parsedInput.softwareIntro,
    dataEntities: scoperArtifact.dataEntities,
    useCases: scoperArtifact.useCases,
    erModelText,
  });

  const response = await chatOnce(
    [
      {
        role: "system",
        content: "You validate and improve ER models.",
      },
      { role: "user", content: prompt },
    ],
    config.LLM_MODEL
  );

  const artifact = ErModelArtifactSchema.parse({
    erModelText: response.trim(),
  });

  return CheckErModelOutputSchema.parse(
    await saveArtifactAndBuildResult({
      stage: "er_model_builder_check_er_model",
      name: "checked_er_model",
      data: artifact,
      extension: "json",
      summary: "ER model checked and improved successfully.",
    })
  );
}

// -------------------------
// 3) 根据新增用例补全 ER 模型
// -------------------------

export const CompleteErModelInputSchema = z.object({
  oldErModelPath: z.string().min(1, "oldErModelPath 不能为空"),
  newUseCasePath: z.string().min(1, "newUseCasePath 不能为空"),
});

export type CompleteErModelInput = z.infer<typeof CompleteErModelInputSchema>;

export const CompleteErModelOutputSchema = PathBasedToolOutputSchema;

export type CompleteErModelOutput = z.infer<
  typeof CompleteErModelOutputSchema
>;

// 构造“根据新增用例补全 ER 模型”的 prompt
function buildCompleteErModelPrompt(params: {
  oldErModelText: string;
  newUseCaseText: string;
}): string {
  const { oldErModelText, newUseCaseText } = params;

  return `
You are responsible for completing and correcting an E-R model based on newly added use case information.

Old E-R Model:
${oldErModelText}

New Use Case Description:
${newUseCaseText}

Instructions:
1. Identify any new data entities introduced or clearly implied by the new use case description.
2. Add only justified new entities.
3. Add or update relationships between:
   - new entities and old entities
   - new entities and other new entities
4. Remove or avoid isolated entities.
5. Keep the model coherent, connected, and grounded in the use case text.
6. Return the fully updated ER model, not just a diff.

Rules:
1. Do not invent unsupported entities.
2. Ensure all important data interactions in the new use case are reflected.
3. Keep naming clear and consistent.
4. Return only the updated ER model content.

Please answer in English.
`.trim();
}

export async function completeErModel(
  input: CompleteErModelInput
): Promise<CompleteErModelOutput> {
  const parsedInput = CompleteErModelInputSchema.parse(input);

  // 两边都从 path 读取，避免把大正文传给模型
  const oldErModelText = await loadErModelText(parsedInput.oldErModelPath);
  const newUseCaseText = await loadNewUseCaseText(parsedInput.newUseCasePath);

  const prompt = buildCompleteErModelPrompt({
    oldErModelText,
    newUseCaseText,
  });

  const response = await chatOnce(
    [
      {
        role: "system",
        content: "You complete ER models based on newly added use cases.",
      },
      { role: "user", content: prompt },
    ],
    config.LLM_MODEL
  );

  const artifact = ErModelArtifactSchema.parse({
    erModelText: response.trim(),
  });

  return CompleteErModelOutputSchema.parse(
    await saveArtifactAndBuildResult({
      stage: "er_model_builder_complete_er_model",
      name: "completed_er_model",
      data: artifact,
      extension: "json",
      summary: "ER model completed based on newly added use cases.",
    })
  );
}