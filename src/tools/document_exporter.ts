import { z } from "zod";
import path from "node:path";
import fs from "node:fs/promises";
import { config } from "../config.js";

// -------------------------
// 通用小工具
// -------------------------

function normalizeList(input: string | string[]): string[] {
  if (Array.isArray(input)) {
    return input.map((item) => item.trim()).filter(Boolean);
  }

  return input
    .split(/[，、,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getTimestamp(): string {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

function safeFileName(name: string): string {
  return name
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_");
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

function buildBulletList(items: string[]): string {
  if (items.length === 0) {
    return "N/A";
  }

  return items.map((item) => `- ${item}`).join("\n");
}

function buildMarkdownDocument(params: {
  title: string;
  softwareIntro?: string;
  dataEntities?: string[];
  useCases?: string[];
  mainHeading: string;
  mainContent: string;
}): string {
  const {
    title,
    softwareIntro,
    dataEntities,
    useCases,
    mainHeading,
    mainContent,
  } = params;

  const lines: string[] = [];

  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`Generated At: ${new Date().toISOString()}`);
  lines.push("");

  if (softwareIntro?.trim()) {
    lines.push("## Software Introduction");
    lines.push("");
    lines.push(softwareIntro.trim());
    lines.push("");
  }

  if (dataEntities && dataEntities.length > 0) {
    lines.push("## Data Entities");
    lines.push("");
    lines.push(buildBulletList(dataEntities));
    lines.push("");
  }

  if (useCases && useCases.length > 0) {
    lines.push("## Use Cases");
    lines.push("");
    lines.push(buildBulletList(useCases));
    lines.push("");
  }

  lines.push(`## ${mainHeading}`);
  lines.push("");
  lines.push(mainContent.trim());
  lines.push("");

  return lines.join("\n").trim() + "\n";
}

// -------------------------
// 输入 / 输出 Schema
// -------------------------

export const ExportRequirementsDocumentsInputSchema = z.object({
  projectName: z.string().min(1, "projectName 不能为空"),

  erModelText: z.string().min(1, "erModelText 不能为空"),

  updatedUseCaseText: z.string().min(1, "updatedUseCaseText 不能为空"),

  functionalRequirementsText: z
    .string()
    .min(1, "functionalRequirementsText 不能为空"),

  softwareIntro: z.string().optional(),

  dataEntities: z.union([z.string(), z.array(z.string())]).optional(),

  useCases: z.union([z.string(), z.array(z.string())]).optional(),

  artifactPrefix: z.string().optional(),

  outputDir: z.string().optional(),
});

export type ExportRequirementsDocumentsInput = z.infer<
  typeof ExportRequirementsDocumentsInputSchema
>;

export const ExportRequirementsDocumentsOutputSchema = z.object({
  outputDir: z.string(),

  erModelDocPath: z.string(),

  updatedUseCaseDocPath: z.string(),

  functionalRequirementsDocPath: z.string(),

  erModelMarkdown: z.string(),

  updatedUseCaseMarkdown: z.string(),

  functionalRequirementsMarkdown: z.string(),
});

export type ExportRequirementsDocumentsOutput = z.infer<
  typeof ExportRequirementsDocumentsOutputSchema
>;

// -------------------------
// 主函数：一次导出三个文档
// -------------------------

export async function exportRequirementsDocuments(
  input: ExportRequirementsDocumentsInput
): Promise<ExportRequirementsDocumentsOutput> {
  const parsedInput = ExportRequirementsDocumentsInputSchema.parse(input);

  const outputDir = path.resolve(
    parsedInput.outputDir ?? config.OUTPUT_DIR ?? "./temp"
  );
  await ensureDir(outputDir);

  const timestamp = getTimestamp();
  const basePrefix = safeFileName(
    parsedInput.artifactPrefix?.trim() ||
      `${parsedInput.projectName}_${timestamp}`
  );

  const dataEntities = parsedInput.dataEntities
    ? normalizeList(parsedInput.dataEntities)
    : [];

  const useCases = parsedInput.useCases
    ? normalizeList(parsedInput.useCases)
    : [];

  const erModelMarkdown = buildMarkdownDocument({
    title: `${parsedInput.projectName} - ER Model Document`,
    softwareIntro: parsedInput.softwareIntro,
    dataEntities,
    useCases,
    mainHeading: "ER Model",
    mainContent: parsedInput.erModelText,
  });

  const updatedUseCaseMarkdown = buildMarkdownDocument({
    title: `${parsedInput.projectName} - Updated Use Case Model Document`,
    softwareIntro: parsedInput.softwareIntro,
    dataEntities,
    useCases,
    mainHeading: "Updated Use Case Model",
    mainContent: parsedInput.updatedUseCaseText,
  });

  const functionalRequirementsMarkdown = buildMarkdownDocument({
    title: `${parsedInput.projectName} - Functional Requirements Document`,
    softwareIntro: parsedInput.softwareIntro,
    dataEntities,
    useCases,
    mainHeading: "Functional Requirements",
    mainContent: parsedInput.functionalRequirementsText,
  });

  const erModelDocPath = path.join(outputDir, `${basePrefix}_er_model.md`);

  const updatedUseCaseDocPath = path.join(
    outputDir,
    `${basePrefix}_updated_use_case_model.md`
  );

  const functionalRequirementsDocPath = path.join(
    outputDir,
    `${basePrefix}_functional_requirements.md`
  );

  await Promise.all([
    fs.writeFile(erModelDocPath, erModelMarkdown, "utf-8"),
    fs.writeFile(updatedUseCaseDocPath, updatedUseCaseMarkdown, "utf-8"),
    fs.writeFile(
      functionalRequirementsDocPath,
      functionalRequirementsMarkdown,
      "utf-8"
    ),
  ]);

  return ExportRequirementsDocumentsOutputSchema.parse({
    outputDir,
    erModelDocPath,
    updatedUseCaseDocPath,
    functionalRequirementsDocPath,
    erModelMarkdown,
    updatedUseCaseMarkdown,
    functionalRequirementsMarkdown,
  });
}