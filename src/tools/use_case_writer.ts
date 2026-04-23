import { z } from "zod";
import { chatOnce } from "../llmClient.js";
import { config } from "../config.js";
import {
  readArtifactJson,
  readArtifactText,
  saveArtifactAndBuildResult,
} from "../artifact_io.js";

// -------------------------
// 通用小工具
// -------------------------

// 兼容英文逗号、中文逗号、顿号
function splitCommaLike(text: string): string[] {
  return text
    .split(/[，、,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

// 将输入统一转成字符串数组
function normalizeList(input: string | string[]): string[] {
  if (Array.isArray(input)) {
    return input.map((item) => item.trim()).filter(Boolean);
  }
  return splitCommaLike(input);
}

// 所有 tool 统一使用的轻量返回结构
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

// generateSimpleUseCases 写入文件后的结构
const SimpleUseCasesArtifactSchema = z.object({
  simpleUseCaseText: z.string(),
  useCaseList: z.array(z.string()),
});

// generateNewUseCases 写入文件后的结构
const NewUseCasesArtifactSchema = z.object({
  appendedSimpleUseCaseText: z.string(),
  newUseCaseText: z.string(),
  newUseCaseList: z.array(z.string()),
});

// 生成功能需求写入文件后的结构
const FunctionalRequirementsArtifactSchema = z.object({
  functionalRequirementsText: z.string(),
});

// 方便兼容“简单用例初版”和“追加新用例版”
const ExistingUseCaseArtifactSchema = z.union([
  z.object({
    simpleUseCaseText: z.string(),
  }),
  z.object({
    appendedSimpleUseCaseText: z.string(),
  }),
]);

// 如果后面 er_model_builder 也改成保存 json，这里可以直接读 erModelText
const ErModelJsonArtifactSchema = z.object({
  erModelText: z.string(),
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

// 读取已有用例文本：既兼容 json，也兼容纯文本
async function loadExistingUseCaseText(filePath: string): Promise<string> {
  const jsonData = await tryReadJsonFile(filePath);

  if (jsonData !== null) {
    const parsed = ExistingUseCaseArtifactSchema.safeParse(jsonData);
    if (parsed.success) {
      if ("simpleUseCaseText" in parsed.data) {
        return parsed.data.simpleUseCaseText.trim();
      }
      return parsed.data.appendedSimpleUseCaseText.trim();
    }
  }

  // 兜底：如果不是 json，就把整个文件当纯文本
  return (await readArtifactText(filePath)).trim();
}

// 读取 ER 模型文本：优先兼容 json，其次兼容纯文本
async function loadErModelText(filePath: string): Promise<string> {
  const jsonData = await tryReadJsonFile(filePath);

  if (jsonData !== null) {
    const parsed = ErModelJsonArtifactSchema.safeParse(jsonData);
    if (parsed.success) {
      return parsed.data.erModelText.trim();
    }
  }

  return (await readArtifactText(filePath)).trim();
}

// -------------------------
// 1) 生成简单用例描述
// -------------------------

// 现在不再直接接 dataEntities/useCases，而是接上一步 requirement_scoper 的结果路径
export const GenerateSimpleUseCasesInputSchema = z.object({
  softwareIntro: z.string().min(1, "softwareIntro 不能为空"),
  scoperResultPath: z.string().min(1, "scoperResultPath 不能为空"),
});

export type GenerateSimpleUseCasesInput = z.infer<
  typeof GenerateSimpleUseCasesInputSchema
>;

export const GenerateSimpleUseCasesOutputSchema = PathBasedToolOutputSchema;

export type GenerateSimpleUseCasesOutput = z.infer<
  typeof GenerateSimpleUseCasesOutputSchema
>;

// 构造单个简单用例描述的 prompt
function buildSingleSimpleUseCasePrompt(params: {
  softwareIntro: string;
  dataEntities: string[];
  useCase: string;
  previousUseCaseText: string;
}): string {
  const { softwareIntro, dataEntities, useCase, previousUseCaseText } = params;

  return `
You are a senior system analyst.

Task:
Generate a complete use case description for the given use case.

System Description:
${softwareIntro}

Data Entities:
${dataEntities.join(", ")}

Current Use Case:
${useCase}

Previously Generated Use Case Descriptions:
${previousUseCaseText || "None"}

Requirements:
1. Keep the style and format consistent with previously generated use cases.
2. Generate only one complete use case description for the current use case.
3. Focus on core business flow only. Do not make the description too verbose.
4. The description must include:
   - Use Case Name
   - Use Case ID
   - Actors
   - Preconditions
   - Postconditions
   - Main Flow
   - Alternative Flow
5. Do not output explanations outside the use case content.

Output Format:
Use Case Name:
Use Case ID: UC-XX
Actors:
Preconditions:
Postconditions:
Main Flow:
1.
2.
...
Alternative Flow:
1.
2.
...

Please answer in English.
`.trim();
}

export async function generateSimpleUseCases(
  input: GenerateSimpleUseCasesInput
): Promise<GenerateSimpleUseCasesOutput> {
  const parsedInput = GenerateSimpleUseCasesInputSchema.parse(input);

  // 读取 requirement_scoper 的输出文件
  const scoperArtifact = RequirementScoperArtifactSchema.parse(
    await readArtifactJson(parsedInput.scoperResultPath)
  );

  const dataEntities = scoperArtifact.dataEntities;
  const useCaseList = scoperArtifact.useCases;

  let simpleUseCaseText = "";

  for (const useCase of useCaseList) {
    const prompt = buildSingleSimpleUseCasePrompt({
      softwareIntro: parsedInput.softwareIntro,
      dataEntities,
      useCase,
      previousUseCaseText: simpleUseCaseText.trim(),
    });

    const response = await chatOnce(
      [
        { role: "system", content: "You are a senior system analyst." },
        { role: "user", content: prompt },
      ],
      config.LLM_MODEL
    );

    const formatted = response.trim();
    simpleUseCaseText += `\n\n${formatted}`;
  }

  const artifact = SimpleUseCasesArtifactSchema.parse({
    simpleUseCaseText: simpleUseCaseText.trim(),
    useCaseList,
  });

  return GenerateSimpleUseCasesOutputSchema.parse(
    await saveArtifactAndBuildResult({
      stage: "use_case_writer_generate_simple_use_cases",
      name: "simple_use_cases",
      data: artifact,
      extension: "json",
      summary: `Simple use cases generated for ${useCaseList.length} use cases.`,
    })
  );
}

// -------------------------
// 2) 追加新用例描述
// -------------------------

export const GenerateNewUseCasesInputSchema = z.object({
  softwareIntro: z.string().min(1, "softwareIntro 不能为空"),
  existingSimpleUseCasePath: z
    .string()
    .min(1, "existingSimpleUseCasePath 不能为空"),
  newUseCases: z.union([z.string(), z.array(z.string())]),
});

export type GenerateNewUseCasesInput = z.infer<
  typeof GenerateNewUseCasesInputSchema
>;

export const GenerateNewUseCasesOutputSchema = PathBasedToolOutputSchema;

export type GenerateNewUseCasesOutput = z.infer<
  typeof GenerateNewUseCasesOutputSchema
>;

// 构造“新增用例补写”的 prompt
function buildNewUseCasePrompt(params: {
  softwareIntro: string;
  existingSimpleUseCaseText: string;
  newUseCase: string;
}): string {
  const { softwareIntro, existingSimpleUseCaseText, newUseCase } = params;

  return `
You are a senior system analyst.

Task:
Continue the existing use case model by adding one new complete use case description.

System Description:
${softwareIntro}

Existing Use Case Descriptions:
${existingSimpleUseCaseText}

New Use Case To Add:
${newUseCase}

Requirements:
1. Keep the style and format fully consistent with the existing use case descriptions.
2. Generate only the newly added use case.
3. Do not repeat old content.
4. The new use case must include:
   - Use Case Name
   - Use Case ID
   - Actors
   - Preconditions
   - Postconditions
   - Main Flow
   - Alternative Flow

Output Format:
Use Case Name:
Use Case ID: UC-XX
Actors:
Preconditions:
Postconditions:
Main Flow:
1.
2.
...
Alternative Flow:
1.
2.
...

Please answer in English.
`.trim();
}

export async function generateNewUseCases(
  input: GenerateNewUseCasesInput
): Promise<GenerateNewUseCasesOutput> {
  const parsedInput = GenerateNewUseCasesInputSchema.parse(input);

  const newUseCaseList = normalizeList(parsedInput.newUseCases);

  // 这里不再直接接正文，而是从 path 中读取已有用例文本
  let appendedSimpleUseCaseText = await loadExistingUseCaseText(
    parsedInput.existingSimpleUseCasePath
  );

  let lastNewUseCaseText = "";

  for (const newUseCase of newUseCaseList) {
    const prompt = buildNewUseCasePrompt({
      softwareIntro: parsedInput.softwareIntro,
      existingSimpleUseCaseText: appendedSimpleUseCaseText,
      newUseCase,
    });

    const response = await chatOnce(
      [
        { role: "system", content: "You are a senior system analyst." },
        { role: "user", content: prompt },
      ],
      config.LLM_MODEL
    );

    lastNewUseCaseText = response.trim();
    appendedSimpleUseCaseText += `\n\n${lastNewUseCaseText}`;
  }

  const artifact = NewUseCasesArtifactSchema.parse({
    appendedSimpleUseCaseText: appendedSimpleUseCaseText.trim(),
    newUseCaseText: lastNewUseCaseText,
    newUseCaseList,
  });

  return GenerateNewUseCasesOutputSchema.parse(
    await saveArtifactAndBuildResult({
      stage: "use_case_writer_generate_new_use_cases",
      name: "new_use_cases",
      data: artifact,
      extension: "json",
      summary: `New use cases appended. Added ${newUseCaseList.length} use cases.`,
    })
  );
}

// -------------------------
// 3) 生成功能需求
// -------------------------

export const GenerateFunctionalRequirementsInputSchema = z.object({
  softwareIntro: z.string().min(1, "softwareIntro 不能为空"),
  erModelPath: z.string().min(1, "erModelPath 不能为空"),
  simpleUseCasePath: z.string().min(1, "simpleUseCasePath 不能为空"),
});

export type GenerateFunctionalRequirementsInput = z.infer<
  typeof GenerateFunctionalRequirementsInputSchema
>;

export const GenerateFunctionalRequirementsOutputSchema =
  PathBasedToolOutputSchema;

export type GenerateFunctionalRequirementsOutput = z.infer<
  typeof GenerateFunctionalRequirementsOutputSchema
>;

// 构造“功能需求生成”的 prompt
function buildFunctionalRequirementsPrompt(params: {
  softwareIntro: string;
  erModel: string;
  simpleUseCaseText: string;
}): string {
  const { softwareIntro, erModel, simpleUseCaseText } = params;

  return `
You are responsible for writing Chapter 1 of the Software Requirements Specification: Functional Requirements.

System Description:
${softwareIntro}

Data Model:
${erModel}

Use Case Description:
${simpleUseCaseText}

Instructions:
1. Extract the core functional scope from the use cases and the data model.
2. Define each function clearly.
3. Content must align with the use cases and data model. Do not invent functions.
4. Keep the output structured and readable.
5. Ensure the set of functional requirements is reasonably complete.
6. Each use case should correspond to at least one functional requirement.

Output Requirements:
1. Each function should have:
   - Section title
   - Function ID
   - Description
2. Do not output explanations outside the functional requirements content.

Example Format:
1.1 Data Import Function
Function ID: FR-01
Description: Users can upload Excel files containing contract data.

1.2 Data Cleaning Function
Function ID: FR-02
Description: The system validates and cleans imported data.

Please answer in English.
`.trim();
}

export async function generateFunctionalRequirements(
  input: GenerateFunctionalRequirementsInput
): Promise<GenerateFunctionalRequirementsOutput> {
  const parsedInput = GenerateFunctionalRequirementsInputSchema.parse(input);

  // ER 模型和用例描述都从 path 读取
  const erModel = await loadErModelText(parsedInput.erModelPath);
  const simpleUseCaseText = await loadExistingUseCaseText(
    parsedInput.simpleUseCasePath
  );

  const prompt = buildFunctionalRequirementsPrompt({
    softwareIntro: parsedInput.softwareIntro,
    erModel,
    simpleUseCaseText,
  });

  const response = await chatOnce(
    [
      {
        role: "system",
        content:
          "You are responsible for writing software functional requirements.",
      },
      { role: "user", content: prompt },
    ],
    config.LLM_MODEL
  );

  const artifact = FunctionalRequirementsArtifactSchema.parse({
    functionalRequirementsText: response.trim(),
  });

  return GenerateFunctionalRequirementsOutputSchema.parse(
    await saveArtifactAndBuildResult({
      stage: "use_case_writer_generate_functional_requirements",
      name: "functional_requirements",
      data: artifact,
      extension: "json",
      summary: "Functional requirements generated and saved.",
    })
  );
}