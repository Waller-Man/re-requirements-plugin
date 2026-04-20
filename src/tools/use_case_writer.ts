import { z } from "zod";
import { chatOnce } from "../llmClient.js";
import { config } from "../config.js";

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

// -------------------------
// 1) 生成简单用例描述
// -------------------------

export const GenerateSimpleUseCasesInputSchema = z.object({
  softwareIntro: z.string().min(1, "softwareIntro 不能为空"),
  dataEntities: z.union([z.string(), z.array(z.string())]),
  useCases: z.union([z.string(), z.array(z.string())]),
});

export type GenerateSimpleUseCasesInput = z.infer<
  typeof GenerateSimpleUseCasesInputSchema
>;

export const GenerateSimpleUseCasesOutputSchema = z.object({
  simpleUseCaseText: z.string(),
  useCaseList: z.array(z.string()),
});

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

  const dataEntities = normalizeList(parsedInput.dataEntities);
  const useCaseList = normalizeList(parsedInput.useCases);

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

  return GenerateSimpleUseCasesOutputSchema.parse({
    simpleUseCaseText: simpleUseCaseText.trim(),
    useCaseList,
  });
}

// -------------------------
// 2) 追加新用例描述
// -------------------------

export const GenerateNewUseCasesInputSchema = z.object({
  softwareIntro: z.string().min(1, "softwareIntro 不能为空"),
  existingSimpleUseCaseText: z.string().min(1, "existingSimpleUseCaseText 不能为空"),
  newUseCases: z.union([z.string(), z.array(z.string())]),
});

export type GenerateNewUseCasesInput = z.infer<
  typeof GenerateNewUseCasesInputSchema
>;

export const GenerateNewUseCasesOutputSchema = z.object({
  appendedSimpleUseCaseText: z.string(),
  newUseCaseText: z.string(),
  newUseCaseList: z.array(z.string()),
});

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

  let appendedSimpleUseCaseText = parsedInput.existingSimpleUseCaseText.trim();
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

  return GenerateNewUseCasesOutputSchema.parse({
    appendedSimpleUseCaseText: appendedSimpleUseCaseText.trim(),
    newUseCaseText: lastNewUseCaseText,
    newUseCaseList,
  });
}

// -------------------------
// 3) 生成功能需求
// -------------------------

export const GenerateFunctionalRequirementsInputSchema = z.object({
  softwareIntro: z.string().min(1, "softwareIntro 不能为空"),
  erModel: z.string().min(1, "erModel 不能为空"),
  simpleUseCaseText: z.string().min(1, "simpleUseCaseText 不能为空"),
});

export type GenerateFunctionalRequirementsInput = z.infer<
  typeof GenerateFunctionalRequirementsInputSchema
>;

export const GenerateFunctionalRequirementsOutputSchema = z.object({
  functionalRequirementsText: z.string(),
});

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

  const prompt = buildFunctionalRequirementsPrompt({
    softwareIntro: parsedInput.softwareIntro,
    erModel: parsedInput.erModel,
    simpleUseCaseText: parsedInput.simpleUseCaseText,
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

  return GenerateFunctionalRequirementsOutputSchema.parse({
    functionalRequirementsText: response.trim(),
  });
}

// -------------------------
// 4) 生成用例图 PlantUML 代码
// -------------------------

export const GenerateUseCaseDiagramCodeInputSchema = z.object({
  useCases: z.union([z.string(), z.array(z.string())]),
});

export type GenerateUseCaseDiagramCodeInput = z.infer<
  typeof GenerateUseCaseDiagramCodeInputSchema
>;

export const GenerateUseCaseDiagramCodeOutputSchema = z.object({
  useCaseDiagramCode: z.string(),
  useCaseList: z.array(z.string()),
});

export type GenerateUseCaseDiagramCodeOutput = z.infer<
  typeof GenerateUseCaseDiagramCodeOutputSchema
>;

// 构造“用例图代码生成”的 prompt
function buildUseCaseDiagramCodePrompt(useCases: string[]): string {
  return `
You are responsible for generating PlantUML use case diagram code.

Use Case Model:
${useCases.join(", ")}

Instructions:
1. Generate a complete PlantUML use case diagram.
2. Use clear actor and use case relationships.
3. Output only valid PlantUML code.
4. Do not output explanations or comments outside the code.

Example:
@startuml
left to right direction
actor Customer
actor Administrator

rectangle System {
  Customer -- (Browse Books)
  Customer -- (Place Order)
  Administrator -- (Manage Orders)
}
@enduml

Please answer in English.
`.trim();
}

export async function generateUseCaseDiagramCode(
  input: GenerateUseCaseDiagramCodeInput
): Promise<GenerateUseCaseDiagramCodeOutput> {
  const parsedInput = GenerateUseCaseDiagramCodeInputSchema.parse(input);
  const useCaseList = normalizeList(parsedInput.useCases);

  const prompt = buildUseCaseDiagramCodePrompt(useCaseList);

  const response = await chatOnce(
    [
      {
        role: "system",
        content: "You generate PlantUML use case diagram code.",
      },
      { role: "user", content: prompt },
    ],
    config.LLM_MODEL
  );

  return GenerateUseCaseDiagramCodeOutputSchema.parse({
    useCaseDiagramCode: response.trim(),
    useCaseList,
  });
}