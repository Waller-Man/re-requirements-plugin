import { z } from "zod";
import { chatOnce } from "../llmClient.js";
import { config } from "../config.js";

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

// -------------------------
// 1) 生成 CURD 三元组
// -------------------------

export const GenerateCurdTriplesInputSchema = z.object({
  dataEntities: z.union([z.string(), z.array(z.string())]),
  useCases: z.union([z.string(), z.array(z.string())]),
  useCaseDescriptionText: z.string().min(1, "useCaseDescriptionText 不能为空"),
});

export type GenerateCurdTriplesInput = z.infer<
  typeof GenerateCurdTriplesInputSchema
>;

export const GenerateCurdTriplesOutputSchema = z.object({
  curdTriplesText: z.string(),
  curdTriples: z.array(CurdTripleSchema),
});

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

  const dataEntities = normalizeList(parsedInput.dataEntities);
  const useCases = normalizeList(parsedInput.useCases);

  const prompt = buildGenerateCurdTriplesPrompt({
    dataEntities,
    useCases,
    useCaseDescriptionText: parsedInput.useCaseDescriptionText,
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

  return GenerateCurdTriplesOutputSchema.parse({
    curdTriplesText: response.trim(),
    curdTriples,
  });
}

// -------------------------
// 2) 将 CURD 三元组转成矩阵
// -------------------------

export const ConvertCurdTriplesToMatrixInputSchema = z.object({
  curdTriples: z.array(CurdTripleSchema),
});

export type ConvertCurdTriplesToMatrixInput = z.infer<
  typeof ConvertCurdTriplesToMatrixInputSchema
>;

export const ConvertCurdTriplesToMatrixOutputSchema = z.object({
  entities: z.array(z.string()),
  useCases: z.array(z.string()),
  matrixTable: z.array(z.record(z.string(), z.string())),
});

export type ConvertCurdTriplesToMatrixOutput = z.infer<
  typeof ConvertCurdTriplesToMatrixOutputSchema
>;

export function convertCurdTriplesToMatrix(
  input: ConvertCurdTriplesToMatrixInput
): ConvertCurdTriplesToMatrixOutput {
  const parsedInput = ConvertCurdTriplesToMatrixInputSchema.parse(input);
  const triples = parsedInput.curdTriples;

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
  const entities = Array.from(
    new Set(triples.map((item) => item.entity))
  ).sort();

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

  return ConvertCurdTriplesToMatrixOutputSchema.parse({
    entities,
    useCases,
    matrixTable,
  });
}

// -------------------------
// 3) 检查 CURD 缺失
// -------------------------

export const CheckCurdCompletenessInputSchema = z.object({
  erModelText: z.string().min(1, "erModelText 不能为空"),
  useCases: z.union([z.string(), z.array(z.string())]),
  curdTriples: z.array(CurdTripleSchema),
});

export type CheckCurdCompletenessInput = z.infer<
  typeof CheckCurdCompletenessInputSchema
>;

export const CheckCurdCompletenessOutputSchema = z.object({
  missingReportText: z.string(),
  isComplete: z.boolean(),
  suggestedUseCases: z.array(z.string()),
});

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

  const useCases = normalizeList(parsedInput.useCases);

  const prompt = buildCheckCurdCompletenessPrompt({
    erModelText: parsedInput.erModelText,
    useCases,
    curdTriples: parsedInput.curdTriples,
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

  return CheckCurdCompletenessOutputSchema.parse({
    missingReportText,
    isComplete,
    suggestedUseCases,
  });
}

// -------------------------
// 4) 补全 CURD 三元组
// -------------------------

export const CompleteCurdTriplesInputSchema = z.object({
  erModelText: z.string().min(1, "erModelText 不能为空"),
  newUseCaseDescriptionText: z.string().min(1, "newUseCaseDescriptionText 不能为空"),
  previousCurdTriples: z.array(CurdTripleSchema),
  missingReportText: z.string().min(1, "missingReportText 不能为空"),
});

export type CompleteCurdTriplesInput = z.infer<
  typeof CompleteCurdTriplesInputSchema
>;

export const CompleteCurdTriplesOutputSchema = z.object({
  newCurdTriplesText: z.string(),
  newCurdTriples: z.array(CurdTripleSchema),
  mergedCurdTriples: z.array(CurdTripleSchema),
});

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

  const prompt = buildCompleteCurdTriplesPrompt({
    erModelText: parsedInput.erModelText,
    newUseCaseDescriptionText: parsedInput.newUseCaseDescriptionText,
    previousCurdTriples: parsedInput.previousCurdTriples,
    missingReportText: parsedInput.missingReportText,
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

  const mergedCurdTriples = [
    ...parsedInput.previousCurdTriples,
    ...newCurdTriples,
  ];

  return CompleteCurdTriplesOutputSchema.parse({
    newCurdTriplesText: response.trim(),
    newCurdTriples,
    mergedCurdTriples,
  });
}