// src/artifact_io.ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";

export type OutputType =
  | "text"
  | "json"
  | "markdown"
  | "plantuml"
  | "unknown";

export type ToolResultLike = {
  status: "success" | "error";
  summary: string;
  outputPath?: string;
  outputType?: OutputType | string;
};

export type SaveArtifactOptions = {
  /**
   * 业务阶段名，例如：
   * "requirement_scoper"
   * "use_case_writer_generate_simple_use_cases"
   * "er_model_builder_generate_er_model"
   */
  stage: string;

  /**
   * 文件逻辑名，例如：
   * "simple_use_cases"
   * "er_model"
   * "curd_triples"
   */
  name: string;

  /**
   * 要保存的数据
   * string -> 原样保存
   * object/array -> JSON 保存
   */
  data: unknown;

  /**
   * 强制扩展名，不带点也可以，例如 "md" / ".json"
   * 不传则根据 data 自动推断
   */
  extension?: string;

  /**
   * 保存到 output 目录而不是 temp 目录
   */
  useOutputDir?: boolean;

  /**
   * 子目录，可选
   * 例如 "pipeline_1" / "round_2"
   */
  subDir?: string;
};

function sanitizeSegment(input: string): string {
  return input
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "artifact";
}

function normalizeExt(ext?: string): string {
  if (!ext) return "";
  return ext.startsWith(".") ? ext : `.${ext}`;
}

function inferExtension(data: unknown): string {
  if (typeof data === "string") {
    return ".txt";
  }
  return ".json";
}

function inferOutputType(data: unknown, ext: string): OutputType {
  const lower = ext.toLowerCase();

  if (lower === ".md") return "markdown";
  if (lower === ".json") return "json";
  if (lower === ".puml" || lower === ".plantuml") return "plantuml";
  if (lower === ".txt") return "text";

  if (typeof data === "string") return "text";
  if (typeof data === "object") return "json";

  return "unknown";
}

function serializeData(data: unknown, ext: string): string {
  const lower = ext.toLowerCase();

  if (typeof data === "string") {
    return data;
  }

  if (lower === ".json") {
    return JSON.stringify(data, null, 2);
  }

  // 即使扩展名不是 json，只要是对象也做 JSON 序列化，避免 [object Object]
  return JSON.stringify(data, null, 2);
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

function getBaseDir(useOutputDir?: boolean): string {
  return path.resolve(useOutputDir ? config.OUTPUT_DIR : config.TEMP_DIR);
}

function buildTimestamp(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

function buildArtifactFilePath(options: SaveArtifactOptions): string {
  const baseDir = getBaseDir(options.useOutputDir);
  const stage = sanitizeSegment(options.stage);
  const name = sanitizeSegment(options.name);
  const subDir = options.subDir ? sanitizeSegment(options.subDir) : "";
  const ext = normalizeExt(options.extension || inferExtension(options.data));
  const timestamp = buildTimestamp();
  const shortId = randomUUID().slice(0, 8);

  const fileName = `${timestamp}_${name}_${shortId}${ext}`;

  if (subDir) {
    return path.join(baseDir, subDir, stage, fileName);
  }

  return path.join(baseDir, stage, fileName);
}

/**
 * 只允许访问 TEMP_DIR / OUTPUT_DIR 下的文件
 */
export function ensureSafeManagedPath(targetPath: string): string {
  const resolved = path.resolve(targetPath);
  const tempRoot = path.resolve(config.TEMP_DIR);
  const outputRoot = path.resolve(config.OUTPUT_DIR);

  const isInsideTemp =
    resolved === tempRoot || resolved.startsWith(tempRoot + path.sep);
  const isInsideOutput =
    resolved === outputRoot || resolved.startsWith(outputRoot + path.sep);

  if (!isInsideTemp && !isInsideOutput) {
    throw new Error(
      `非法路径：${targetPath} 不在 TEMP_DIR 或 OUTPUT_DIR 下`
    );
  }

  return resolved;
}

export async function fileExists(targetPath: string): Promise<boolean> {
  try {
    const safePath = ensureSafeManagedPath(targetPath);
    await fs.access(safePath);
    return true;
  } catch {
    return false;
  }
}

export async function saveArtifact(
  options: SaveArtifactOptions
): Promise<{
  outputPath: string;
  outputType: OutputType | string;
}> {
  const filePath = buildArtifactFilePath(options);
  const safePath = ensureSafeManagedPath(filePath);
  const content = serializeData(
    options.data,
    normalizeExt(options.extension || inferExtension(options.data))
  );

  await ensureDir(path.dirname(safePath));
  await fs.writeFile(safePath, content, "utf-8");

  return {
    outputPath: safePath,
    outputType: inferOutputType(
      options.data,
      normalizeExt(options.extension || inferExtension(options.data))
    ),
  };
}

export async function readArtifactText(targetPath: string): Promise<string> {
  const safePath = ensureSafeManagedPath(targetPath);
  return fs.readFile(safePath, "utf-8");
}

export async function readArtifactJson<T = unknown>(
  targetPath: string
): Promise<T> {
  const text = await readArtifactText(targetPath);
  return JSON.parse(text) as T;
}

export async function deleteArtifact(targetPath: string): Promise<void> {
  const safePath = ensureSafeManagedPath(targetPath);
  await fs.rm(safePath, { force: true });
}

export function buildSuccessResult(params: {
  summary: string;
  outputPath?: string;
  outputType?: OutputType | string;
}): ToolResultLike {
  return {
    status: "success",
    summary: params.summary,
    outputPath: params.outputPath,
    outputType: params.outputType,
  };
}

export function buildErrorResult(summary: string): ToolResultLike {
  return {
    status: "error",
    summary,
  };
}

/**
 * 一步完成：
 * 1. 保存大结果到文件
 * 2. 返回给模型一个轻量结果
 */
export async function saveArtifactAndBuildResult(params: {
  stage: string;
  name: string;
  data: unknown;
  summary: string;
  extension?: string;
  useOutputDir?: boolean;
  subDir?: string;
}): Promise<ToolResultLike> {
  const { outputPath, outputType } = await saveArtifact({
    stage: params.stage,
    name: params.name,
    data: params.data,
    extension: params.extension,
    useOutputDir: params.useOutputDir,
    subDir: params.subDir,
  });

  return buildSuccessResult({
    summary: params.summary,
    outputPath,
    outputType,
  });
}