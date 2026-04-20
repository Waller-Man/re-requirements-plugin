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

// 输入 schema：对应原始 reviewer 的五类输入
export const ReviewRequirementModelInputSchema = z.object({
  softwareIntro: z.string().min(1, "softwareIntro 不能为空"),
  dataEntities: z.union([z.string(), z.array(z.string())]),
  useCases: z.union([z.string(), z.array(z.string())]),
  erModelText: z.string().min(1, "erModelText 不能为空"),
  fullUseCaseText: z.string().min(1, "fullUseCaseText 不能为空"),
});

export type ReviewRequirementModelInput = z.infer<
  typeof ReviewRequirementModelInputSchema
>;

// 输出 schema：先保留原始评审文本
export const ReviewRequirementModelOutputSchema = z.object({
  reviewText: z.string(),
});

export type ReviewRequirementModelOutput = z.infer<
  typeof ReviewRequirementModelOutputSchema
>;

// 构造综合评审 prompt
function buildReviewPrompt(params: {
  softwareIntro: string;
  dataEntities: string[];
  useCases: string[];
  erModelText: string;
  fullUseCaseText: string;
}): string {
  const {
    softwareIntro,
    dataEntities,
    useCases,
    erModelText,
    fullUseCaseText,
  } = params;

  return `
You are responsible for reviewing a requirements model in a requirements engineering team.

System Introduction:
${softwareIntro}

Data Entities:
${dataEntities.join(", ")}

Use Cases:
${useCases.join(", ")}

E-R Model:
${erModelText}

Full Use Case Model:
${fullUseCaseText}

Task:
Evaluate the current requirements model from the following three perspectives:

1. Boss Test
   - Evaluate whether the use case model clearly reflects core business value.
   - Check whether senior management can quickly understand the main benefits, key workflows, and business risks.
   - Point out whether the model supports the main business goals effectively.

2. EBP Test
   - Evaluate whether the model follows good engineering practice and enterprise standards.
   - Check maintainability, extensibility, usability, compliance awareness, and operational clarity.
   - Point out any risks related to ambiguity, inconsistency, or weak business-operational alignment.

3. Scale Test
   - Evaluate whether the model can still work under larger business scale.
   - Consider growth in users, data volume, transaction complexity, and operational pressure.
   - Point out scalability risks or missing support for larger scenarios.

Rules:
1. For each of the three tests, clearly state:
   - Result: Pass or Fail
   - Reason
   - Improvement Suggestions
2. The review must be rigorous, concrete, and grounded in the provided content.
3. Do not invent system features that are not supported by the inputs.
4. At the end, provide an Overall Conclusion section.
5. Keep the review well-structured and easy to read.

Output Format:
Boss Test
Result: Pass/Fail
Reason:
Improvement Suggestions:

EBP Test
Result: Pass/Fail
Reason:
Improvement Suggestions:

Scale Test
Result: Pass/Fail
Reason:
Improvement Suggestions:

Overall Conclusion:
...

Please answer in English.
`.trim();
}

// 第五个 tool：综合评审需求模型
export async function reviewRequirementModel(
  input: ReviewRequirementModelInput
): Promise<ReviewRequirementModelOutput> {
  const parsedInput = ReviewRequirementModelInputSchema.parse(input);

  const dataEntities = normalizeList(parsedInput.dataEntities);
  const useCases = normalizeList(parsedInput.useCases);

  const prompt = buildReviewPrompt({
    softwareIntro: parsedInput.softwareIntro,
    dataEntities,
    useCases,
    erModelText: parsedInput.erModelText,
    fullUseCaseText: parsedInput.fullUseCaseText,
  });

  const response = await chatOnce(
    [
      {
        role: "system",
        content: "You are a rigorous requirements model reviewer.",
      },
      { role: "user", content: prompt },
    ],
    config.LLM_MODEL
  );

  return ReviewRequirementModelOutputSchema.parse({
    reviewText: response.trim(),
  });
}