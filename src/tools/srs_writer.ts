import { z } from "zod";
import { chatOnce } from "../llmClient.js";
import { config } from "../config.js";

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

// =========================
// 1) 生成引言
// =========================

export const GenerateIntroductionInputSchema = z.object({
  softwareIntro: z.string().min(1, "softwareIntro 不能为空"),
  dataEntities: z.union([z.string(), z.array(z.string())]),
  useCases: z.union([z.string(), z.array(z.string())]),
  erModelText: z.string().min(1, "erModelText 不能为空"),
  simpleUseCaseText: z.string().min(1, "simpleUseCaseText 不能为空"),
});

export type GenerateIntroductionInput = z.infer<
  typeof GenerateIntroductionInputSchema
>;

export const GenerateIntroductionOutputSchema = z.object({
  introductionText: z.string(),
});

export type GenerateIntroductionOutput = z.infer<
  typeof GenerateIntroductionOutputSchema
>;

// 构造“引言”提示词
function buildIntroductionPrompt(params: {
  softwareIntro: string;
  dataEntities: string[];
  useCases: string[];
  erModelText: string;
  simpleUseCaseText: string;
}): string {
  const {
    softwareIntro,
    dataEntities,
    useCases,
    erModelText,
    simpleUseCaseText,
  } = params;

  return `
You are responsible for writing Chapter 1 (Introduction) of a Software Requirements Specification.

Software Introduction:
${softwareIntro}

Data Entities:
${dataEntities.join(", ")}

Use Cases:
${useCases.join(", ")}

E-R Model:
${erModelText}

Use Case Model:
${simpleUseCaseText}

Instructions:
1. Understand the software introduction, use case model, and data model carefully.
2. Explain the project background clearly.
3. Define the business objectives of the system.
4. Define the scope of the system clearly.
5. Provide relevant definitions, abbreviations, and acronyms, especially those appearing in the use case model and data model.
6. List valid and appropriate reference standards.

Rules:
1. Focus on business needs and high-level system requirements rather than implementation details.
2. Keep the project objective and scope clear.
3. Follow the style of an IEEE-830-like SRS introduction.
4. The reference standards must be real and reasonable.
5. Use clear sectioned output.

Output Format:
1.1 Background
1.2 Business Objectives
1.3 Scope
1.4 Definitions, Abbreviations, and Acronyms
1.5 Reference Standards

Please answer in English.
`.trim();
}

export async function generateIntroduction(
  input: GenerateIntroductionInput
): Promise<GenerateIntroductionOutput> {
  const parsedInput = GenerateIntroductionInputSchema.parse(input);

  const dataEntities = normalizeList(parsedInput.dataEntities);
  const useCases = normalizeList(parsedInput.useCases);

  const prompt = buildIntroductionPrompt({
    softwareIntro: parsedInput.softwareIntro,
    dataEntities,
    useCases,
    erModelText: parsedInput.erModelText,
    simpleUseCaseText: parsedInput.simpleUseCaseText,
  });

  const response = await chatOnce(
    [
      {
        role: "system",
        content: "You write SRS introduction sections.",
      },
      { role: "user", content: prompt },
    ],
    config.LLM_MODEL
  );

  return GenerateIntroductionOutputSchema.parse({
    introductionText: response.trim(),
  });
}

// =========================
// 2) 生成总体概述
// =========================

export const GenerateOverallDescriptionInputSchema = z.object({
  softwareIntro: z.string().min(1, "softwareIntro 不能为空"),
  dataEntities: z.union([z.string(), z.array(z.string())]),
  useCases: z.union([z.string(), z.array(z.string())]),
  erModelText: z.string().min(1, "erModelText 不能为空"),
  simpleUseCaseText: z.string().min(1, "simpleUseCaseText 不能为空"),
});

export type GenerateOverallDescriptionInput = z.infer<
  typeof GenerateOverallDescriptionInputSchema
>;

export const GenerateOverallDescriptionOutputSchema = z.object({
  overallDescriptionText: z.string(),
});

export type GenerateOverallDescriptionOutput = z.infer<
  typeof GenerateOverallDescriptionOutputSchema
>;

// 构造“总体概述”提示词
function buildOverallDescriptionPrompt(params: {
  softwareIntro: string;
  dataEntities: string[];
  useCases: string[];
  erModelText: string;
  simpleUseCaseText: string;
}): string {
  const {
    softwareIntro,
    dataEntities,
    useCases,
    erModelText,
    simpleUseCaseText,
  } = params;

  return `
You are responsible for writing Chapter 2 (Overall Description) of a Software Requirements Specification.

Software Introduction:
${softwareIntro}

Data Entities:
${dataEntities.join(", ")}

Use Cases:
${useCases.join(", ")}

Use Case Model:
${simpleUseCaseText}

E-R Model:
${erModelText}

Instructions:
1. Clarify the problem the system solves and identify the target users.
2. Summarize the main functional modules and explain their relationships.
3. Analyze market pain points and comparable products carefully.
4. Highlight the competitive advantages of this product.
5. Identify business risks, opportunities, design constraints, assumptions, and dependencies.

Rules:
1. Follow an IEEE-830-like SRS structure.
2. Keep the analysis concrete and business-oriented.
3. Do not invent unsupported market data.
4. Design constraints should be realistic and relevant.
5. Risks and opportunities should be specific rather than vague.

Output Format:
2.1 Product Perspective
2.2 Product Functions
2.3 User Characteristics
2.4 Competitive Analysis
2.5 Business Risks and Opportunities
2.6 Design Constraints
2.7 Assumptions and Dependencies

Please answer in English.
`.trim();
}

export async function generateOverallDescription(
  input: GenerateOverallDescriptionInput
): Promise<GenerateOverallDescriptionOutput> {
  const parsedInput = GenerateOverallDescriptionInputSchema.parse(input);

  const dataEntities = normalizeList(parsedInput.dataEntities);
  const useCases = normalizeList(parsedInput.useCases);

  const prompt = buildOverallDescriptionPrompt({
    softwareIntro: parsedInput.softwareIntro,
    dataEntities,
    useCases,
    erModelText: parsedInput.erModelText,
    simpleUseCaseText: parsedInput.simpleUseCaseText,
  });

  const response = await chatOnce(
    [
      {
        role: "system",
        content: "You write SRS overall description sections.",
      },
      { role: "user", content: prompt },
    ],
    config.LLM_MODEL
  );

  return GenerateOverallDescriptionOutputSchema.parse({
    overallDescriptionText: response.trim(),
  });
}

// =========================
// 3) 生成外部接口需求
// =========================

export const GenerateExternalInterfaceInputSchema = z.object({
  softwareIntro: z.string().min(1, "softwareIntro 不能为空"),
  functionalRequirementsText: z.string().min(1, "functionalRequirementsText 不能为空"),
});

export type GenerateExternalInterfaceInput = z.infer<
  typeof GenerateExternalInterfaceInputSchema
>;

export const GenerateExternalInterfaceOutputSchema = z.object({
  externalInterfaceText: z.string(),
});

export type GenerateExternalInterfaceOutput = z.infer<
  typeof GenerateExternalInterfaceOutputSchema
>;

// 构造“外部接口需求”提示词
function buildExternalInterfacePrompt(params: {
  softwareIntro: string;
  functionalRequirementsText: string;
}): string {
  const { softwareIntro, functionalRequirementsText } = params;

  return `
You are responsible for writing the External Interface Requirements section of a Software Requirements Specification.

System Introduction:
${softwareIntro}

Functional Requirements:
${functionalRequirementsText}

Instructions:
1. Analyze inputs, outputs, and references to external data sources in the functional requirements.
2. Identify external interfaces such as user interfaces, hardware interfaces, software interfaces, and communication interfaces.
3. Define each interface clearly.
4. Cross-check that all external data sources mentioned in the functional requirements are covered here.

Rules:
1. Keep terminology consistent with the rest of the document.
2. Ensure every mentioned external source is clearly defined.
3. Describe interaction methods clearly.
4. Use understandable and implementation-friendly language.

Output Format:
3.1 User Interface
3.2 Hardware Interface
3.3 Software Interface
3.4 Communication Interface

Please answer in English.
`.trim();
}

export async function generateExternalInterface(
  input: GenerateExternalInterfaceInput
): Promise<GenerateExternalInterfaceOutput> {
  const parsedInput = GenerateExternalInterfaceInputSchema.parse(input);

  const prompt = buildExternalInterfacePrompt({
    softwareIntro: parsedInput.softwareIntro,
    functionalRequirementsText: parsedInput.functionalRequirementsText,
  });

  const response = await chatOnce(
    [
      {
        role: "system",
        content: "You write SRS external interface sections.",
      },
      { role: "user", content: prompt },
    ],
    config.LLM_MODEL
  );

  return GenerateExternalInterfaceOutputSchema.parse({
    externalInterfaceText: response.trim(),
  });
}

// =========================
// 4) 生成非功能需求
// =========================

export const GenerateNonfunctionalRequirementInputSchema = z.object({
  softwareIntro: z.string().min(1, "softwareIntro 不能为空"),
  overallDescriptionText: z.string().min(1, "overallDescriptionText 不能为空"),
  simpleUseCaseText: z.string().min(1, "simpleUseCaseText 不能为空"),
});

export type GenerateNonfunctionalRequirementInput = z.infer<
  typeof GenerateNonfunctionalRequirementInputSchema
>;

export const GenerateNonfunctionalRequirementOutputSchema = z.object({
  nonfunctionalRequirementText: z.string(),
});

export type GenerateNonfunctionalRequirementOutput = z.infer<
  typeof GenerateNonfunctionalRequirementOutputSchema
>;

// 构造“非功能需求”提示词
function buildNonfunctionalRequirementPrompt(params: {
  softwareIntro: string;
  overallDescriptionText: string;
  simpleUseCaseText: string;
}): string {
  const { softwareIntro, overallDescriptionText, simpleUseCaseText } = params;

  return `
You are responsible for writing the Nonfunctional Requirements section of a Software Requirements Specification.

System Introduction:
${softwareIntro}

Overall Description:
${overallDescriptionText}

Use Case Model:
${simpleUseCaseText}

Instructions:
1. Analyze the application scenario and domain background of the software.
2. Read the use case model carefully and identify nonfunctional implications from the core functions.
3. Ensure consistency between nonfunctional requirements and the system goals.
4. Define concrete nonfunctional requirements.

Rules:
1. Use measurable indicators whenever possible, such as response time, concurrency, availability, and recovery time.
2. Keep nonfunctional requirements aligned with the functional scope.
3. Make the requirements realistic and implementable.
4. Avoid unnecessary low-level technical detail.
5. Keep the text clear and easy to understand.

Output Format:
5.1 Performance Requirements
5.2 Security Requirements
5.3 Other Quality Requirements

Please answer in English.
`.trim();
}

export async function generateNonfunctionalRequirement(
  input: GenerateNonfunctionalRequirementInput
): Promise<GenerateNonfunctionalRequirementOutput> {
  const parsedInput =
    GenerateNonfunctionalRequirementInputSchema.parse(input);

  const prompt = buildNonfunctionalRequirementPrompt({
    softwareIntro: parsedInput.softwareIntro,
    overallDescriptionText: parsedInput.overallDescriptionText,
    simpleUseCaseText: parsedInput.simpleUseCaseText,
  });

  const response = await chatOnce(
    [
      {
        role: "system",
        content: "You write SRS nonfunctional requirement sections.",
      },
      { role: "user", content: prompt },
    ],
    config.LLM_MODEL
  );

  return GenerateNonfunctionalRequirementOutputSchema.parse({
    nonfunctionalRequirementText: response.trim(),
  });
}