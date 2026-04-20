import { z } from "zod";
import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { config } from "../config.js";

// =========================
// 通用工具函数
// =========================

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

// 生成时间戳，避免文件覆盖
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

// 将文件名清洗成更安全的形式
function safeFileName(name: string): string {
  return name
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_");
}

// 确保目录存在
async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

// 判断文件是否存在
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// 将绝对路径转成适合 markdown 的相对路径
function toMarkdownRelativePath(fromFile: string, targetFile: string): string {
  const fromDir = path.dirname(fromFile);
  const relative = path.relative(fromDir, targetFile);
  return relative.replace(/\\/g, "/");
}

// 使用 Node 原生 child_process 调用 PlantUML jar
async function runPlantUmlJar(pumlPath: string): Promise<void> {
  const jarPath = path.resolve(config.PLANTUML_JAR);

  await new Promise<void>((resolve, reject) => {
    const child = spawn("java", ["-jar", jarPath, pumlPath], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
  stdout += chunk.toString();
});

child.stderr.on("data", (chunk: Buffer) => {
  stderr += chunk.toString();
});

child.on("error", (error: Error) => {
  reject(
    new Error(
      `无法启动 PlantUML 渲染进程：${
        error instanceof Error ? error.message : String(error)
      }`
    )
  );
});

child.on("close", (code: number | null) => {
  if (code === 0) {
    resolve();
    return;
  }

  reject(
    new Error(
      [
        `PlantUML 渲染失败，退出码：${code ?? "unknown"}`,
        stdout.trim() ? `stdout:\n${stdout.trim()}` : "",
        stderr.trim() ? `stderr:\n${stderr.trim()}` : "",
      ]
        .filter(Boolean)
        .join("\n\n")
    )
  );
});

// =========================
// 1) PlantUML 图片渲染
// =========================

// PlantUML 渲染输入
export const RenderPlantUmlDiagramInputSchema = z.object({
  // 图类型，主要用于命名和区分
  diagramType: z.enum(["use_case", "er"]),

  // PlantUML 原始代码
  plantUmlCode: z.string().min(1, "plantUmlCode 不能为空"),

  // 可选：自定义产物名（不带扩展名）
  artifactName: z.string().optional(),

  // 可选：输出目录，不传则默认用 OUTPUT_DIR
  outputDir: z.string().optional(),
});

export type RenderPlantUmlDiagramInput = z.infer<
  typeof RenderPlantUmlDiagramInputSchema
>;

// PlantUML 渲染输出
export const RenderPlantUmlDiagramOutputSchema = z.object({
  diagramType: z.enum(["use_case", "er"]),
  pumlPath: z.string(),
  pngPath: z.string(),
});

export type RenderPlantUmlDiagramOutput = z.infer<
  typeof RenderPlantUmlDiagramOutputSchema
>;

// 通用 PlantUML 渲染函数
export async function renderPlantUmlDiagram(
  input: RenderPlantUmlDiagramInput
): Promise<RenderPlantUmlDiagramOutput> {
  const parsedInput = RenderPlantUmlDiagramInputSchema.parse(input);

  const outputDir = path.resolve(
    parsedInput.outputDir ?? config.OUTPUT_DIR ?? "./temp"
  );

  await ensureDir(outputDir);

  const baseName = safeFileName(
    parsedInput.artifactName ??
      `${parsedInput.diagramType}_diagram_${getTimestamp()}`
  );

  const pumlPath = path.join(outputDir, `${baseName}.puml`);
  const pngPath = path.join(outputDir, `${baseName}.png`);

  // 先把 PlantUML 代码写入 .puml 文件
  await fs.writeFile(pumlPath, parsedInput.plantUmlCode, "utf-8");

  // 调用本地 PlantUML jar 渲染 PNG
  await runPlantUmlJar(pumlPath);

  // 渲染后检查 PNG 是否存在
  const pngExists = await fileExists(pngPath);
  if (!pngExists) {
    throw new Error(`PlantUML 渲染完成，但未找到输出图片：${pngPath}`);
  }

  return RenderPlantUmlDiagramOutputSchema.parse({
    diagramType: parsedInput.diagramType,
    pumlPath,
    pngPath,
  });
}

// 渲染用例图
export const RenderUseCaseDiagramInputSchema = z.object({
  useCaseDiagramCode: z.string().min(1, "useCaseDiagramCode 不能为空"),
  artifactName: z.string().optional(),
  outputDir: z.string().optional(),
});

export type RenderUseCaseDiagramInput = z.infer<
  typeof RenderUseCaseDiagramInputSchema
>;

export async function renderUseCaseDiagram(
  input: RenderUseCaseDiagramInput
): Promise<RenderPlantUmlDiagramOutput> {
  const parsedInput = RenderUseCaseDiagramInputSchema.parse(input);

  return renderPlantUmlDiagram({
    diagramType: "use_case",
    plantUmlCode: parsedInput.useCaseDiagramCode,
    artifactName: parsedInput.artifactName,
    outputDir: parsedInput.outputDir,
  });
}

// 渲染 ER 图
export const RenderErDiagramInputSchema = z.object({
  erDiagramCode: z.string().min(1, "erDiagramCode 不能为空"),
  artifactName: z.string().optional(),
  outputDir: z.string().optional(),
});

export type RenderErDiagramInput = z.infer<typeof RenderErDiagramInputSchema>;

export async function renderErDiagram(
  input: RenderErDiagramInput
): Promise<RenderPlantUmlDiagramOutput> {
  const parsedInput = RenderErDiagramInputSchema.parse(input);

  return renderPlantUmlDiagram({
    diagramType: "er",
    plantUmlCode: parsedInput.erDiagramCode,
    artifactName: parsedInput.artifactName,
    outputDir: parsedInput.outputDir,
  });
}

// =========================
// 2) 通用 Markdown 导出
// =========================

// markdown 的一个章节
export const MarkdownSectionSchema = z.object({
  heading: z.string().min(1, "heading 不能为空"),
  content: z.string().min(1, "content 不能为空"),
  level: z.number().int().min(1).max(6).optional(),
});

export type MarkdownSection = z.infer<typeof MarkdownSectionSchema>;

// markdown 中嵌入的图片
export const MarkdownImageSchema = z.object({
  alt: z.string().min(1, "alt 不能为空"),
  imagePath: z.string().min(1, "imagePath 不能为空"),
});

export type MarkdownImage = z.infer<typeof MarkdownImageSchema>;

// 通用 markdown 导出输入
export const ExportMarkdownDocumentInputSchema = z.object({
  title: z.string().min(1, "title 不能为空"),
  artifactName: z.string().optional(),
  outputDir: z.string().optional(),
  sections: z.array(MarkdownSectionSchema).min(1, "sections 至少包含一个章节"),
  images: z.array(MarkdownImageSchema).optional(),
});

export type ExportMarkdownDocumentInput = z.infer<
  typeof ExportMarkdownDocumentInputSchema
>;

// 通用 markdown 导出输出
export const ExportMarkdownDocumentOutputSchema = z.object({
  markdownPath: z.string(),
  markdownText: z.string(),
});

export type ExportMarkdownDocumentOutput = z.infer<
  typeof ExportMarkdownDocumentOutputSchema
>;

// 通用 markdown 导出函数
export async function exportMarkdownDocument(
  input: ExportMarkdownDocumentInput
): Promise<ExportMarkdownDocumentOutput> {
  const parsedInput = ExportMarkdownDocumentInputSchema.parse(input);

  const outputDir = path.resolve(
    parsedInput.outputDir ?? config.OUTPUT_DIR ?? "./temp"
  );
  await ensureDir(outputDir);

  const baseName = safeFileName(
    parsedInput.artifactName ?? `document_${getTimestamp()}`
  );
  const markdownPath = path.join(outputDir, `${baseName}.md`);

  const lines: string[] = [];

  // 标题
  lines.push(`# ${parsedInput.title}`);
  lines.push("");

  // 图片
  if (parsedInput.images && parsedInput.images.length > 0) {
    for (const image of parsedInput.images) {
      const relativeImagePath = toMarkdownRelativePath(
        markdownPath,
        path.resolve(image.imagePath)
      );
      lines.push(`![${image.alt}](${relativeImagePath})`);
      lines.push("");
    }
  }

  // 章节
  for (const section of parsedInput.sections) {
    const level = section.level ?? 2;
    const headingPrefix = "#".repeat(level);

    lines.push(`${headingPrefix} ${section.heading}`);
    lines.push("");
    lines.push(section.content.trim());
    lines.push("");
  }

  const markdownText = lines.join("\n").trim() + "\n";

  await fs.writeFile(markdownPath, markdownText, "utf-8");

  return ExportMarkdownDocumentOutputSchema.parse({
    markdownPath,
    markdownText,
  });
}

// =========================
// 3) 项目结果一键导出为 Markdown
// =========================

// 项目导出输入
export const ExportProjectMarkdownInputSchema = z.object({
  title: z.string().min(1, "title 不能为空"),
  softwareIntro: z.string().min(1, "softwareIntro 不能为空"),

  dataEntities: z.union([z.string(), z.array(z.string())]),
  useCases: z.union([z.string(), z.array(z.string())]),

  simpleUseCaseText: z.string().optional(),
  erModelText: z.string().optional(),
  functionalRequirementsText: z.string().optional(),
  reviewText: z.string().optional(),

  introductionText: z.string().optional(),
  overallDescriptionText: z.string().optional(),
  externalInterfaceText: z.string().optional(),
  nonfunctionalRequirementText: z.string().optional(),

  useCaseDiagramPngPath: z.string().optional(),
  erDiagramPngPath: z.string().optional(),

  artifactName: z.string().optional(),
  outputDir: z.string().optional(),
});

export type ExportProjectMarkdownInput = z.infer<
  typeof ExportProjectMarkdownInputSchema
>;

// 项目导出输出
export const ExportProjectMarkdownOutputSchema = z.object({
  markdownPath: z.string(),
  markdownText: z.string(),
});

export type ExportProjectMarkdownOutput = z.infer<
  typeof ExportProjectMarkdownOutputSchema
>;

// 项目导出函数
export async function exportProjectMarkdown(
  input: ExportProjectMarkdownInput
): Promise<ExportProjectMarkdownOutput> {
  const parsedInput = ExportProjectMarkdownInputSchema.parse(input);

  const dataEntities = normalizeList(parsedInput.dataEntities);
  const useCases = normalizeList(parsedInput.useCases);

  const sections: MarkdownSection[] = [];

  // 基础信息
  sections.push({
    heading: "Software Introduction",
    content: parsedInput.softwareIntro,
    level: 2,
  });

  sections.push({
    heading: "Data Entities",
    content:
      dataEntities.length > 0
        ? dataEntities.map((item) => `- ${item}`).join("\n")
        : "N/A",
    level: 2,
  });

  sections.push({
    heading: "Use Cases",
    content:
      useCases.length > 0
        ? useCases.map((item) => `- ${item}`).join("\n")
        : "N/A",
    level: 2,
  });

  // 用例模型
  if (parsedInput.simpleUseCaseText?.trim()) {
    sections.push({
      heading: "Use Case Descriptions",
      content: parsedInput.simpleUseCaseText.trim(),
      level: 2,
    });
  }

  // ER 模型
  if (parsedInput.erModelText?.trim()) {
    sections.push({
      heading: "ER Model",
      content: parsedInput.erModelText.trim(),
      level: 2,
    });
  }

  // 功能需求
  if (parsedInput.functionalRequirementsText?.trim()) {
    sections.push({
      heading: "Functional Requirements",
      content: parsedInput.functionalRequirementsText.trim(),
      level: 2,
    });
  }

  // reviewer 评审
  if (parsedInput.reviewText?.trim()) {
    sections.push({
      heading: "Model Review",
      content: parsedInput.reviewText.trim(),
      level: 2,
    });
  }

  // SRS 各章节
  if (parsedInput.introductionText?.trim()) {
    sections.push({
      heading: "SRS - Introduction",
      content: parsedInput.introductionText.trim(),
      level: 2,
    });
  }

  if (parsedInput.overallDescriptionText?.trim()) {
    sections.push({
      heading: "SRS - Overall Description",
      content: parsedInput.overallDescriptionText.trim(),
      level: 2,
    });
  }

  if (parsedInput.externalInterfaceText?.trim()) {
    sections.push({
      heading: "SRS - External Interface Requirements",
      content: parsedInput.externalInterfaceText.trim(),
      level: 2,
    });
  }

  if (parsedInput.nonfunctionalRequirementText?.trim()) {
    sections.push({
      heading: "SRS - Nonfunctional Requirements",
      content: parsedInput.nonfunctionalRequirementText.trim(),
      level: 2,
    });
  }

  const images: MarkdownImage[] = [];

  if (parsedInput.useCaseDiagramPngPath?.trim()) {
    images.push({
      alt: "Use Case Diagram",
      imagePath: parsedInput.useCaseDiagramPngPath.trim(),
    });
  }

  if (parsedInput.erDiagramPngPath?.trim()) {
    images.push({
      alt: "ER Diagram",
      imagePath: parsedInput.erDiagramPngPath.trim(),
    });
  }

  const exported = await exportMarkdownDocument({
    title: parsedInput.title,
    artifactName: parsedInput.artifactName ?? "project_artifacts",
    outputDir: parsedInput.outputDir,
    sections,
    images,
  });

  return ExportProjectMarkdownOutputSchema.parse({
    markdownPath: exported.markdownPath,
    markdownText: exported.markdownText,
  });
}