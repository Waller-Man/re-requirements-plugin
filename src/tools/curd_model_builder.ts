import { z } from "zod";
import { chatOnce } from "../llmClient.js";
import { config } from "../config.js";
import {
  readArtifactJson,
  readArtifactText,
  saveArtifactAndBuildResult,
} from "../artifact_io.js";

// -------------------------
// 通用类型与工具函数
// -------------------------

// 单条 CURD 三元组
export const CurdTripleSchema = z.object({
  entity: z.string().min(1),
  useCase: z.string().min(1),
  operation: z.enum(["C", "U", "R", "D"]),
});

export type CurdTriple = z.infer<typeof CurdTripleSchema>;

// 统一的轻量返回结构：避免把大结果直接返回给模型
const PathBasedToolOutputSchema = z.object({
  status: z.enum(["success", "error"]),
  summary: z.string(),
  outputPath: z.string().optional(),
  outputType: z.string().optional(),
});

type PathBasedToolOutput = z.infer<typeof PathBasedToolOutputSchema>;

// requirement_scoper 的输出文件结构
const RequirementScoperArtifactSchema = z.object({
  dataEntitiesText: z.string(),
  useCasesText: z.string(),
  dataEntities: z.array(z.string()),
  useCases: z.array(z.string()),
});

// 简单用例 / 追加用例 两种产物都兼容
const UseCaseDescriptionArtifactSchema = z.union([
  z.object({
    simpleUseCaseText: z.string(),
    useCaseList: z.array(z.string()).optional(),
  }),
  z.object({
    appendedSimpleUseCaseText: z.string(),
    newUseCaseText: z.string(),
    newUseCaseList: z.array(z.string()),
  }),
]);

// ER 模型统一产物
const ErModelArtifactSchema = z.object({
  erModelText: z.string(),
});

// CURD 三元组产物
const CurdTriplesArtifactSchema = z.object({
  curdTriplesText: z.string(),
  curdTriples: z.array(CurdTripleSchema),
});

// CURD 检查结果产物
const CheckCurdCompletenessArtifactSchema = z.object({
  missingReportText: z.string(),
  isComplete: z.boolean(),
  suggestedUseCases: z.array(z.string()),
});

// 矩阵产物
const CurdMatrixArtifactSchema = z.object({
  entities: z.array(z.string()),
  useCases: z.array(z.string()),
  matrixTable: z.array(z.record(z.string(), z.string())),
});

// 兼容字符串和数组输入
function normalizeList(input: string | string[]): string[] {
  if (Array.isArray(input)) {
    return input.map((item) => item.trim()).filter(Boolean);
  }

  return input
    .split(/[，、,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

// 将三元组数组转成统一排序后的文本，便于传给模型
function stringifyCurdTriples(triples: CurdTriple[]): string {
  return JSON.stringify(triples, null, 2);
}

// 尝试解析模型返回的 CURD 三元组
// 优先支持 JSON；如果模型返回了接近 Python tuple list 的格式，也做一次兼容转换
function parseCurdTriples(rawText: string): CurdTriple[] {
  const text = rawText.trim();

  // 先尝试直接按 JSON 数组解析
  try {
    const parsed = JSON.parse(text);

    if (Array.isArray(parsed)) {
      const mapped = parsed.map((item) => {
        if (Array.isArray(item) && item.length === 3) {
          return {
            entity: String(item[0]).trim(),
            useCase: String(item[1]).trim(),
            operation: String(item[2]).trim(),
          };
        }

        if (
          item &&
          typeof item === "object" &&
          "entity" in item &&
          "useCase" in item &&
          "operation" in item
        ) {
          return {
            entity: String(item.entity).trim(),
            useCase: String(item.useCase).trim(),
            operation: String(item.operation).trim(),
          };
        }

        throw new Error("JSON item format is invalid.");
      });

      return z.array(CurdTripleSchema).parse(mapped);
    }
  } catch {
    // 忽略，继续尝试兼容 Python tuple list
  }

  // 再尝试把 Python 风格的三元组列表粗略转换成 JSON
  try {
    const normalized = text
      .replace(/\(/g, "[")
      .replace(/\)/g, "]")
      .replace(/'/g, '"');

    const parsed = JSON.parse(normalized);

    if (Array.isArray(parsed)) {
      const mapped = parsed.map((item) => {
        if (Array.isArray(item) && item.length === 3) {
          return {
            entity: String(item[0]).trim(),
            useCase: String(item[1]).trim(),
            operation: String(item[2]).trim(),
          };
        }
        throw new Error("Tuple-like item format is invalid.");
      });

      return z.array(CurdTripleSchema).parse(mapped);
    }
  } catch {
    // 继续往下报错
  }

  throw new Error("无法解析 CURD 三元组。请检查模型输出格式。");
}

// 尝试把文件按 JSON 读取；如果不是 JSON，则返回 null
async function tryReadJsonFile(filePath: string): Promise<unknown | null> {
  const raw = await readArtifactText(filePath);

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// 读取用例描述文本：兼容 simpleUseCaseText / appendedSimpleUseCaseText
async function loadUseCaseDescriptionText(filePath: string): Promise<string> {
  const jsonData = await tryReadJsonFile(filePath);

  if (jsonData !== null) {
    const parsed = UseCaseDescriptionArtifactSchema.safeParse(jsonData);
    if (parsed.success) {
      if ("simpleUseCaseText" in parsed.data) {
        return parsed.data.simpleUseCaseText.trim();
      }
      return parsed.data.appendedSimpleUseCaseText.trim();
    }
  }

  // 兜底：当纯文本处理
  return (await readArtifactText(filePath)).trim();
}

// 读取新增用例文本：优先读取 newUseCaseText
async function loadNewUseCaseText(filePath: string): Promise<string> {
  const jsonData = await tryReadJsonFile(filePath);

  if (jsonData !== null) {
    const parsed = UseCaseDescriptionArtifactSchema.safeParse(jsonData);
    if (parsed.success && "newUseCaseText" in parsed.data) {
      return parsed.data.newUseCaseText.trim();
    }
  }

  return (await readArtifactText(filePath)).trim();
}

// 读取 ER 模型文本
async function loadErModelText(filePath: string): Promise<string> {
  const jsonData = await tryReadJsonFile(filePath);

  if (jsonData !== null) {
    const parsed = ErModelArtifactSchema.safeParse(jsonData);
    if (parsed.success) {
      return parsed.data.erModelText.trim();
    }
  }

  return (await readArtifactText(filePath)).trim();
}

// 读取 CURD 三元组
async function loadCurdTriples(filePath: string): Promise<CurdTriple[]> {
  const jsonData = await tryReadJsonFile(filePath);

  if (jsonData !== null) {
    const parsed = CurdTriplesArtifactSchema.safeParse(jsonData);
    if (parsed.success) {
      return parsed.data.curdTriples;
    }
  }

  // 如果不是结构化产物，则尝试把整个文本当作 CURD 输出解析
  const rawText = await readArtifactText(filePath);
  return parseCurdTriples(rawText);
}

// 读取缺失检查结果
async function loadMissingReport(filePath: string): Promise<{
  missingReportText: string;
  isComplete: boolean;
  suggestedUseCases: string[];
}> {
  const jsonData = await tryReadJsonFile(filePath);

  if (jsonData !== null) {
    const parsed = CheckCurdCompletenessArtifactSchema.safeParse(jsonData);
    if (parsed.success) {
      return parsed.data;
    }
  }

  const rawText = (await readArtifactText(filePath)).trim();
  const isComplete = rawText === "The model is complete.";
  const suggestedUseCases = isComplete ? [] : normalizeList(rawText);

  return {
    missingReportText: rawText,
    isComplete,
    suggestedUseCases,
  };
}

// -------------------------
// 1) 生成 CURD 三元组
// -------------------------

// 现在不再直接接 dataEntities / useCases / useCaseDescriptionText
// 改为从前面步骤生成的文件里读取
export const GenerateCurdTriplesInputSchema = z.object({
  scoperResultPath: z.string().min(1, "scoperResultPath 不能为空"),
  useCaseDescriptionPath: z.string().min(1, "useCaseDescriptionPath 不能为空"),
});

export type GenerateCurdTriplesInput = z.infer<
  typeof GenerateCurdTriplesInputSchema
>;

export const GenerateCurdTriplesOutputSchema = PathBasedToolOutputSchema;

export type GenerateCurdTriplesOutput = z.infer<
  typeof GenerateCurdTriplesOutputSchema
>;

// 构造“生成 CURD 三元组”的 prompt
function buildGenerateCurdTriplesPrompt(params: {
  dataEntities: string[];
  useCases: string[];
  useCaseDescriptionText: string;
}): string {
  const { dataEntities, useCases, useCaseDescriptionText } = params;

  return `
You are responsible for building a CURD model for a requirements engineering workflow.

Data Entities:
${dataEntities.join(", ")}

Use Cases:
${useCases.join(", ")}

Use Case Descriptions:
${useCaseDescriptionText}

Task:
Generate structured CURD triples in the form:
[["Entity", "UseCase", "Operation"]]

Definitions:
- C = Create
- U = Update
- R = Read
- D = Delete

Rules:
1. A use case may correspond to multiple CURD operations for the same entity.
2. If a use case manages an entity, it usually implies C, R, U, and D.
3. If a use case is not related to an entity, do not generate a triple.
4. Only generate triples grounded in the use case descriptions.
5. Return only a valid JSON array.
6. Do not include explanations or markdown.

Example:
[
  ["Project", "Manage Project", "C"],
  ["Project", "Manage Project", "R"],
  ["Project", "Manage Project", "U"],
  ["Project", "Manage Project", "D"],
  ["Task", "View Task", "R"]
]

Please answer in English.
`.trim();
}

export async function generateCurdTriples(
  input: GenerateCurdTriplesInput
): Promise<GenerateCurdTriplesOutput> {
  const parsedInput = GenerateCurdTriplesInputSchema.parse(input);

  const scoperArtifact = RequirementScoperArtifactSchema.parse(
    await readArtifactJson(parsedInput.scoperResultPath)
  );
  const useCaseDescriptionText = await loadUseCaseDescriptionText(
    parsedInput.useCaseDescriptionPath
  );

  const prompt = buildGenerateCurdTriplesPrompt({
    dataEntities: scoperArtifact.dataEntities,
    useCases: scoperArtifact.useCases,
    useCaseDescriptionText,
  });

  const response = await chatOnce(
    [
      {
        role: "system",
        content: "You build CURD triples for a requirements model.",
      },
      { role: "user", content: prompt },
    ],
    config.LLM_MODEL
  );

  const curdTriples = parseCurdTriples(response);

  const artifact = CurdTriplesArtifactSchema.parse({
    curdTriplesText: response.trim(),
    curdTriples,
  });

  return GenerateCurdTriplesOutputSchema.parse(
    await saveArtifactAndBuildResult({
      stage: "curd_model_builder_generate_curd_triples",
      name: "curd_triples",
      data: artifact,
      extension: "json",
      summary: `CURD triples generated successfully. Total triples: ${curdTriples.length}.`,
    })
  );
}

// -------------------------
// 2) 将 CURD 三元组转成矩阵
// -------------------------

export const ConvertCurdTriplesToMatrixInputSchema = z.object({
  curdTriplesPath: z.string().min(1, "curdTriplesPath 不能为空"),
});

export type ConvertCurdTriplesToMatrixInput = z.infer<
  typeof ConvertCurdTriplesToMatrixInputSchema
>;

export const ConvertCurdTriplesToMatrixOutputSchema = PathBasedToolOutputSchema;

export type ConvertCurdTriplesToMatrixOutput = z.infer<
  typeof ConvertCurdTriplesToMatrixOutputSchema
>;

export async function convertCurdTriplesToMatrix(
  input: ConvertCurdTriplesToMatrixInput
): Promise<ConvertCurdTriplesToMatrixOutput> {
  const parsedInput = ConvertCurdTriplesToMatrixInputSchema.parse(input);
  const triples = await loadCurdTriples(parsedInput.curdTriplesPath);

  const matrix = new Map<string, Map<string, Set<"C" | "U" | "R" | "D">>>();

  for (const triple of triples) {
    if (!matrix.has(triple.useCase)) {
      matrix.set(triple.useCase, new Map());
    }

    const entityMap = matrix.get(triple.useCase)!;

    if (!entityMap.has(triple.entity)) {
      entityMap.set(triple.entity, new Set());
    }

    entityMap.get(triple.entity)!.add(triple.operation);
  }

  const useCases = Array.from(matrix.keys()).sort();
  const entities = Array.from(new Set(triples.map((item) => item.entity))).sort();

  const matrixTable: Array<Record<string, string>> = useCases.map((useCase) => {
    const row: Record<string, string> = {
      "Use Case": useCase,
    };

    for (const entity of entities) {
      const ops = matrix.get(useCase)?.get(entity);
      row[entity] = ops ? Array.from(ops).sort().join(",") : "";
    }

    return row;
  });

  const artifact = CurdMatrixArtifactSchema.parse({
    entities,
    useCases,
    matrixTable,
  });

  return ConvertCurdTriplesToMatrixOutputSchema.parse(
    await saveArtifactAndBuildResult({
      stage: "curd_model_builder_convert_curd_triples_to_matrix",
      name: "curd_matrix",
      data: artifact,
      extension: "json",
      summary: `CURD matrix generated successfully. ${useCases.length} use cases and ${entities.length} entities included.`,
    })
  );
}

// -------------------------
// 3) 检查 CURD 缺失
// -------------------------

export const CheckCurdCompletenessInputSchema = z.object({
  erModelPath: z.string().min(1, "erModelPath 不能为空"),
  scoperResultPath: z.string().min(1, "scoperResultPath 不能为空"),
  curdTriplesPath: z.string().min(1, "curdTriplesPath 不能为空"),
});

export type CheckCurdCompletenessInput = z.infer<
  typeof CheckCurdCompletenessInputSchema
>;

export const CheckCurdCompletenessOutputSchema = PathBasedToolOutputSchema;

export type CheckCurdCompletenessOutput = z.infer<
  typeof CheckCurdCompletenessOutputSchema
>;

// 构造“检查 CURD 缺失”的 prompt
function buildCheckCurdCompletenessPrompt(params: {
  erModelText: string;
  useCases: string[];
  curdTriples: CurdTriple[];
}): string {
  const { erModelText, useCases, curdTriples } = params;

  return `
You are responsible for requirement checking based on a CURD model.

E-R Model:
${erModelText}

System Use Cases:
${useCases.join(", ")}

Current CURD Triples:
${stringifyCurdTriples(curdTriples)}

Task:
Detect whether there are obviously missing CURD-related use cases or important interaction gaps.

Instructions:
1. Focus on internal entities only.
2. Do not expand system scope unnecessarily.
3. A management use case may imply C, R, U, and D.
4. Some record-like entities may reasonably require only R.
5. If the model is complete, return exactly:
The model is complete.
6. If the model is not complete, return only the missing or suggested use case names, separated by commas.
7. Do not output explanations.

Important Constraint:
If the total number of use cases is less than 20, do not return "The model is complete."

Example Complete Output:
The model is complete.

Example Incomplete Output:
Manage Asset Type, View Approval

Please answer in English.
`.trim();
}

export async function checkCurdCompleteness(
  input: CheckCurdCompletenessInput
): Promise<CheckCurdCompletenessOutput> {
  const parsedInput = CheckCurdCompletenessInputSchema.parse(input);

  const erModelText = await loadErModelText(parsedInput.erModelPath);
  const scoperArtifact = RequirementScoperArtifactSchema.parse(
    await readArtifactJson(parsedInput.scoperResultPath)
  );
  const curdTriples = await loadCurdTriples(parsedInput.curdTriplesPath);

  const prompt = buildCheckCurdCompletenessPrompt({
    erModelText,
    useCases: scoperArtifact.useCases,
    curdTriples,
  });

  const response = await chatOnce(
    [
      {
        role: "system",
        content: "You check missing CURD interactions in a requirements model.",
      },
      { role: "user", content: prompt },
    ],
    config.LLM_MODEL
  );

  const missingReportText = response.trim();
  const isComplete = missingReportText === "The model is complete.";
  const suggestedUseCases = isComplete ? [] : normalizeList(missingReportText);

  const artifact = CheckCurdCompletenessArtifactSchema.parse({
    missingReportText,
    isComplete,
    suggestedUseCases,
  });

  return CheckCurdCompletenessOutputSchema.parse(
    await saveArtifactAndBuildResult({
      stage: "curd_model_builder_check_curd_completeness",
      name: "curd_completeness_check",
      data: artifact,
      extension: "json",
      summary: isComplete
        ? "CURD model is complete."
        : `CURD model is incomplete. Suggested use cases: ${suggestedUseCases.length}.`,
    })
  );
}

// -------------------------
// 4) 补全 CURD 三元组
// -------------------------

export const CompleteCurdTriplesInputSchema = z.object({
  erModelPath: z.string().min(1, "erModelPath 不能为空"),
  newUseCasePath: z.string().min(1, "newUseCasePath 不能为空"),
  previousCurdTriplesPath: z.string().min(1, "previousCurdTriplesPath 不能为空"),
  missingReportPath: z.string().min(1, "missingReportPath 不能为空"),
});

export type CompleteCurdTriplesInput = z.infer<
  typeof CompleteCurdTriplesInputSchema
>;

export const CompleteCurdTriplesOutputSchema = PathBasedToolOutputSchema;

export type CompleteCurdTriplesOutput = z.infer<
  typeof CompleteCurdTriplesOutputSchema
>;

// 构造“补全 CURD 三元组”的 prompt
function buildCompleteCurdTriplesPrompt(params: {
  erModelText: string;
  newUseCaseDescriptionText: string;
  previousCurdTriples: CurdTriple[];
  missingReportText: string;
}): string {
  const {
    erModelText,
    newUseCaseDescriptionText,
    previousCurdTriples,
    missingReportText,
  } = params;

  return `
You are responsible for completing the system's CURD model based on updated use case information.

Input:
(a) E-R Model:
${erModelText}

(b) New Use Case Descriptions:
${newUseCaseDescriptionText}

(c) Previous CURD Triples:
${stringifyCurdTriples(previousCurdTriples)}

(d) Missing Report:
${missingReportText}

Task Instructions:
1. Read the missing report carefully.
2. Analyze the updated use case descriptions and identify new CURD interactions.
3. Compare them with the previous CURD triples.
4. Generate only the newly missing CURD triples.
5. Do not repeat existing triples.

Output Format:
Return only a valid JSON array:
[
  ["Entity", "UseCase", "Operation"]
]

Rules:
1. Only include grounded interactions supported by the use case descriptions.
2. Keep naming consistent with previous entities and use cases.
3. Do not invent unsupported operations.
4. Do not include explanations or markdown.

Please answer in English.
`.trim();
}

export async function completeCurdTriples(
  input: CompleteCurdTriplesInput
): Promise<CompleteCurdTriplesOutput> {
  const parsedInput = CompleteCurdTriplesInputSchema.parse(input);

  const erModelText = await loadErModelText(parsedInput.erModelPath);
  const newUseCaseDescriptionText = await loadNewUseCaseText(
    parsedInput.newUseCasePath
  );
  const previousCurdTriples = await loadCurdTriples(
    parsedInput.previousCurdTriplesPath
  );
  const missingReport = await loadMissingReport(parsedInput.missingReportPath);

  const prompt = buildCompleteCurdTriplesPrompt({
    erModelText,
    newUseCaseDescriptionText,
    previousCurdTriples,
    missingReportText: missingReport.missingReportText,
  });

  const response = await chatOnce(
    [
      {
        role: "system",
        content: "You complete missing CURD triples for a requirements model.",
      },
      { role: "user", content: prompt },
    ],
    config.LLM_MODEL
  );

  const newCurdTriples = parseCurdTriples(response);

  // 去重合并，避免重复三元组
  const mergedMap = new Map<string, CurdTriple>();

  for (const triple of [...previousCurdTriples, ...newCurdTriples]) {
    const key = `${triple.entity}|||${triple.useCase}|||${triple.operation}`;
    mergedMap.set(key, triple);
  }

  const mergedCurdTriples = Array.from(mergedMap.values());

  const artifact = CurdTriplesArtifactSchema.extend({
    newCurdTriples: z.array(CurdTripleSchema),
    mergedCurdTriples: z.array(CurdTripleSchema),
    newCurdTriplesText: z.string(),
  }).parse({
    curdTriplesText: stringifyCurdTriples(mergedCurdTriples),
    curdTriples: mergedCurdTriples,
    newCurdTriplesText: response.trim(),
    newCurdTriples,
    mergedCurdTriples,
  });

  return CompleteCurdTriplesOutputSchema.parse(
    await saveArtifactAndBuildResult({
      stage: "curd_model_builder_complete_curd_triples",
      name: "completed_curd_triples",
      data: artifact,
      extension: "json",
      summary: `CURD triples completed successfully. Added ${newCurdTriples.length} new triples.`,
    })
  );
}