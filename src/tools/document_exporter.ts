import { z } from "zod";
import path from "node:path";
import fs from "node:fs/promises";
import { config } from "../config.js";
import {
  readArtifactText,
  saveArtifactAndBuildResult,
} from "../artifact_io.js";

// -------------------------
// 通用小工具
// -------------------------

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

// 尝试把文件按 JSON 读取；如果不是 JSON，则返回 null
async function tryReadJsonFile(filePath: string): Promise<unknown | null> {
  const raw = await readArtifactText(filePath);

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// -------------------------
// 各类产物 schema
// -------------------------

const PathBasedToolOutputSchema = z.object({
  status: z.enum(["success", "error"]),
  summary: z.string(),
  outputPath: z.string().optional(),
  outputType: z.string().optional(),
});

const RequirementScoperArtifactSchema = z.object({
  dataEntitiesText: z.string(),
  useCasesText: z.string(),
  dataEntities: z.array(z.string()),
  useCases: z.array(z.string()),
});

const ErModelArtifactSchema = z.object({
  erModelText: z.string(),
});

const UpdatedUseCaseArtifactSchema = z.union([
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

const FunctionalRequirementsArtifactSchema = z.object({
  functionalRequirementsText: z.string(),
});

// -------------------------
// 读取不同 path 中的正文
// -------------------------

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

async function loadUpdatedUseCaseText(filePath: string): Promise<string> {
  const jsonData = await tryReadJsonFile(filePath);

  if (jsonData !== null) {
    const parsed = UpdatedUseCaseArtifactSchema.safeParse(jsonData);
    if (parsed.success) {
      if ("simpleUseCaseText" in parsed.data) {
        return parsed.data.simpleUseCaseText.trim();
      }
      return parsed.data.appendedSimpleUseCaseText.trim();
    }
  }

  return (await readArtifactText(filePath)).trim();
}

async function loadFunctionalRequirementsText(filePath: string): Promise<string> {
  const jsonData = await tryReadJsonFile(filePath);

  if (jsonData !== null) {
    const parsed = FunctionalRequirementsArtifactSchema.safeParse(jsonData);
    if (parsed.success) {
      return parsed.data.functionalRequirementsText.trim();
    }
  }

  return (await readArtifactText(filePath)).trim();
}

async function loadScoperMeta(
  filePath?: string
): Promise<{ dataEntities: string[]; useCases: string[] }> {
  if (!filePath) {
    return { dataEntities: [], useCases: [] };
  }

  const jsonData = await tryReadJsonFile(filePath);

  if (jsonData !== null) {
    const parsed = RequirementScoperArtifactSchema.safeParse(jsonData);
    if (parsed.success) {
      return {
        dataEntities: parsed.data.dataEntities,
        useCases: parsed.data.useCases,
      };
    }
  }

  return { dataEntities: [], useCases: [] };
}

// -------------------------
// 输入 / 输出 Schema
// -------------------------

export const ExportRequirementsDocumentsInputSchema = z.object({
  projectName: z.string().min(1, "projectName 不能为空"),

  erModelPath: z.string().min(1, "erModelPath 不能为空"),

  updatedUseCasePath: z.string().min(1, "updatedUseCasePath 不能为空"),

  functionalRequirementsPath: z
    .string()
    .min(1, "functionalRequirementsPath 不能为空"),

  softwareIntro: z.string().optional(),

  // 可选：用于补充文档头部的实体与用例列表
  scoperResultPath: z.string().optional(),

  artifactPrefix: z.string().optional(),

  outputDir: z.string().optional(),
});

export type ExportRequirementsDocumentsInput = z.infer<
  typeof ExportRequirementsDocumentsInputSchema
>;

export const ExportRequirementsDocumentsOutputSchema = PathBasedToolOutputSchema;

export type ExportRequirementsDocumentsOutput = z.infer<
  typeof ExportRequirementsDocumentsOutputSchema
>;

// 导出结果真正写入文件的结构
export const ExportRequirementsDocumentsArtifactSchema = z.object({
  outputDir: z.string(),
  erModelDocPath: z.string(),
  updatedUseCaseDocPath: z.string(),
  functionalRequirementsDocPath: z.string(),
});

export type ExportRequirementsDocumentsArtifact = z.infer<
  typeof ExportRequirementsDocumentsArtifactSchema
>;

// -------------------------
// 主函数：一次导出三个文档
// -------------------------

export async function exportRequirementsDocuments(
  input: ExportRequirementsDocumentsInput
): Promise<ExportRequirementsDocumentsOutput> {
  const parsedInput = ExportRequirementsDocumentsInputSchema.parse(input);

  const outputDir = path.resolve(
    parsedInput.outputDir ?? config.OUTPUT_DIR ?? "./temp/output"
  );
  await ensureDir(outputDir);

  const timestamp = getTimestamp();
  const basePrefix = safeFileName(
    parsedInput.artifactPrefix?.trim() ||
      `${parsedInput.projectName}_${timestamp}`
  );

  // 从各自 path 中读取正文
  const erModelText = await loadErModelText(parsedInput.erModelPath);
  const updatedUseCaseText = await loadUpdatedUseCaseText(
    parsedInput.updatedUseCasePath
  );
  const functionalRequirementsText = await loadFunctionalRequirementsText(
    parsedInput.functionalRequirementsPath
  );

  // 如果提供了 scoperResultPath，则自动补充实体和用例列表
  const { dataEntities, useCases } = await loadScoperMeta(
    parsedInput.scoperResultPath
  );

  const erModelMarkdown = buildMarkdownDocument({
    title: `${parsedInput.projectName} - ER Model Document`,
    softwareIntro: parsedInput.softwareIntro,
    dataEntities,
    useCases,
    mainHeading: "ER Model",
    mainContent: erModelText,
  });

  const updatedUseCaseMarkdown = buildMarkdownDocument({
    title: `${parsedInput.projectName} - Updated Use Case Model Document`,
    softwareIntro: parsedInput.softwareIntro,
    dataEntities,
    useCases,
    mainHeading: "Updated Use Case Model",
    mainContent: updatedUseCaseText,
  });

  const functionalRequirementsMarkdown = buildMarkdownDocument({
    title: `${parsedInput.projectName} - Functional Requirements Document`,
    softwareIntro: parsedInput.softwareIntro,
    dataEntities,
    useCases,
    mainHeading: "Functional Requirements",
    mainContent: functionalRequirementsText,
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

  // 真正导出三个最终文档
  await Promise.all([
    fs.writeFile(erModelDocPath, erModelMarkdown, "utf-8"),
    fs.writeFile(updatedUseCaseDocPath, updatedUseCaseMarkdown, "utf-8"),
    fs.writeFile(
      functionalRequirementsDocPath,
      functionalRequirementsMarkdown,
      "utf-8"
    ),
  ]);

  // 再把导出结果路径写成一个小 json，后续模型只需要记这个路径
  const exportArtifact = ExportRequirementsDocumentsArtifactSchema.parse({
    outputDir,
    erModelDocPath,
    updatedUseCaseDocPath,
    functionalRequirementsDocPath,
  });

  return ExportRequirementsDocumentsOutputSchema.parse(
    await saveArtifactAndBuildResult({
      stage: "document_exporter_export_requirements_documents",
      name: "export_result",
      data: exportArtifact,
      extension: "json",
      useOutputDir: true,
      summary: "Requirements documents exported successfully.",
    })
  );
}