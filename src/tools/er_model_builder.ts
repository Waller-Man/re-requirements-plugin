import { z } from "zod";
import { chatOnce } from "../llmClient.js";
import { config } from "../config.js";

// -------------------------
// 通用小工具
// -------------------------

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

// -------------------------
// 1) 生成初始 ER 模型
// -------------------------

export const GenerateErModelInputSchema = z.object({
  softwareIntro: z.string().min(1, "softwareIntro 不能为空"),
  dataEntities: z.union([z.string(), z.array(z.string())]),
  useCases: z.union([z.string(), z.array(z.string())]),
});

export type GenerateErModelInput = z.infer<typeof GenerateErModelInputSchema>;

export const GenerateErModelOutputSchema = z.object({
  erModelText: z.string(),
  dataEntities: z.array(z.string()),
  useCases: z.array(z.string()),
});

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

  const dataEntities = normalizeList(parsedInput.dataEntities);
  const useCases = normalizeList(parsedInput.useCases);

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

  return GenerateErModelOutputSchema.parse({
    erModelText: response.trim(),
    dataEntities,
    useCases,
  });
}

// -------------------------
// 2) 检查 / 修正 ER 模型
// -------------------------

export const CheckErModelInputSchema = z.object({
  softwareIntro: z.string().min(1, "softwareIntro 不能为空"),
  dataEntities: z.union([z.string(), z.array(z.string())]),
  useCases: z.union([z.string(), z.array(z.string())]),
  erModelText: z.string().min(1, "erModelText 不能为空"),
});

export type CheckErModelInput = z.infer<typeof CheckErModelInputSchema>;

export const CheckErModelOutputSchema = z.object({
  checkedErModelText: z.string(),
});

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

  const dataEntities = normalizeList(parsedInput.dataEntities);
  const useCases = normalizeList(parsedInput.useCases);

  const prompt = buildCheckErModelPrompt({
    softwareIntro: parsedInput.softwareIntro,
    dataEntities,
    useCases,
    erModelText: parsedInput.erModelText,
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

  return CheckErModelOutputSchema.parse({
    checkedErModelText: response.trim(),
  });
}

// -------------------------
// 3) 根据新增用例补全 ER 模型
// -------------------------

export const CompleteErModelInputSchema = z.object({
  oldErModelText: z.string().min(1, "oldErModelText 不能为空"),
  newUseCaseText: z.string().min(1, "newUseCaseText 不能为空"),
});

export type CompleteErModelInput = z.infer<typeof CompleteErModelInputSchema>;

export const CompleteErModelOutputSchema = z.object({
  completedErModelText: z.string(),
});

export type CompleteErModelOutput = z.infer<typeof CompleteErModelOutputSchema>;

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

  const prompt = buildCompleteErModelPrompt({
    oldErModelText: parsedInput.oldErModelText,
    newUseCaseText: parsedInput.newUseCaseText,
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

  return CompleteErModelOutputSchema.parse({
    completedErModelText: response.trim(),
  });
}

// -------------------------
// 4) 生成 ER 图 PlantUML 代码
// -------------------------

export const GenerateErCodeInputSchema = z.object({
  erModelText: z.string().min(1, "erModelText 不能为空"),
});

export type GenerateErCodeInput = z.infer<typeof GenerateErCodeInputSchema>;

export const GenerateErCodeOutputSchema = z.object({
  erCode: z.string(),
});

export type GenerateErCodeOutput = z.infer<typeof GenerateErCodeOutputSchema>;

// 构造“生成 ER 图 PlantUML 代码”的 prompt
function buildGenerateErCodePrompt(erModelText: string): string {
  return `
You are a tool that generates PlantUML E-R diagram code from a conceptual E-R model.

Conceptual E-R Model:
${erModelText}

Instructions:
1. Generate valid PlantUML E-R diagram code.
2. Use entity definitions rather than class definitions.
3. Include all important entities in the ER model.
4. Include meaningful relationship names and cardinalities.
5. Do not include methods or operations.
6. Do not annotate primary keys or foreign keys.
7. Return only valid PlantUML code.

Example:
@startuml
entity User
entity Order
User "1" --> "0..*" Order : places
@enduml

Please answer in English.
`.trim();
}

export async function generateErCode(
  input: GenerateErCodeInput
): Promise<GenerateErCodeOutput> {
  const parsedInput = GenerateErCodeInputSchema.parse(input);

  const prompt = buildGenerateErCodePrompt(parsedInput.erModelText);

  const response = await chatOnce(
    [
      {
        role: "system",
        content: "You generate valid PlantUML ER diagram code.",
      },
      { role: "user", content: prompt },
    ],
    config.LLM_MODEL
  );

  return GenerateErCodeOutputSchema.parse({
    erCode: response.trim(),
  });
}