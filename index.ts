import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

type PluginConfig = {
  llmApiKey?: string;
  llmBaseUrl?: string;
  llmModel?: string;
  plantumlJar?: string;
  tempDir?: string;
  outputDir?: string;
};

type PathBasedToolResult = {
  status: "success" | "error";
  summary: string;
  outputPath?: string;
  outputType?: string;
};

function applyPluginConfigToEnv(config: PluginConfig = {}) {
  const mapping: Array<[keyof PluginConfig, string]> = [
    ["llmApiKey", "LLM_API_KEY"],
    ["llmBaseUrl", "LLM_BASE_URL"],
    ["llmModel", "LLM_MODEL"],
    ["plantumlJar", "PLANTUML_JAR"],
    ["tempDir", "TEMP_DIR"],
    ["outputDir", "OUTPUT_DIR"],
  ];

  for (const [configKey, envKey] of mapping) {
    const value = config[configKey];
    if (typeof value === "string" && value.trim()) {
      process.env[envKey] = value.trim();
    }
  }
}

function ensureRequiredEnv() {
  const missing: string[] = [];

  if (!process.env.LLM_API_KEY?.trim()) {
    missing.push("plugins.entries.re-requirements-plugin.config.llmApiKey");
  }
  if (!process.env.LLM_BASE_URL?.trim()) {
    missing.push("plugins.entries.re-requirements-plugin.config.llmBaseUrl");
  }

  if (missing.length > 0) {
    throw new Error(
      `插件缺少必要配置：${missing.join("、")}。请先在 openclaw.json 里补齐。`
    );
  }
}

function requireNonEmptyString(name: string, value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} 不能为空`);
  }
  return value.trim();
}

function requireStringArray(name: string, value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${name} 必须是字符串数组`);
  }

  const arr = value
    .map((item) => {
      if (typeof item !== "string") {
        throw new Error(`${name} 中存在非字符串项`);
      }
      return item.trim();
    })
    .filter(Boolean);

  if (arr.length === 0) {
    throw new Error(`${name} 不能为空数组`);
  }

  return arr;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function toolResult<T extends PathBasedToolResult>(data: T): {
  content: Array<{
    type: "text";
    text: string;
  }>;
  details: T;
} {
  const lines = [
    `status: ${data.status}`,
    `summary: ${data.summary}`,
    ...(data.outputPath ? [`outputPath: ${data.outputPath}`] : []),
    ...(data.outputType ? [`outputType: ${data.outputType}`] : []),
  ];

  return {
    content: [
      {
        type: "text",
        text: lines.join("\n"),
      },
    ],
    details: data,
  };
}

export default definePluginEntry({
  id: "re-requirements-plugin",
  name: "RE Requirements Plugin",
  description:
    "Requirements engineering plugin for entity extraction, use case modeling, ER/CURD modeling, and document exporting.",
  register(api) {
    const pluginConfig = (api.pluginConfig ?? {}) as PluginConfig;

    applyPluginConfigToEnv(pluginConfig);

    api.logger.info("[re-requirements-plugin] registered");

    api.registerTool({
      name: "requirement_scoper",
      label: "Requirement Scoper",
      description: "从软件需求简介中抽取核心数据实体和初始用例列表，并将结果写入文件。",
      parameters: {
        type: "object",
        properties: {
          softwareIntro: {
            type: "string",
            description: "用户提供的软件需求简介",
          },
        },
        required: ["softwareIntro"],
        additionalProperties: false,
      },
      async execute(_toolCallId: string, params: any) {
        applyPluginConfigToEnv(pluginConfig);
        ensureRequiredEnv();

        const { requirementScoper } = await import("./src/tools/requirement_scoper.js");

        const result = await requirementScoper({
          softwareIntro: requireNonEmptyString("softwareIntro", params?.softwareIntro),
        });

        return toolResult(result);
      },
    });

    api.registerTool({
      name: "use_case_writer",
      label: "Use Case Writer",
      description: "生成基础用例描述、补充新用例、生成功能需求文本，均以文件路径作为中间输入输出。",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: [
              "generate_simple_use_cases",
              "generate_new_use_cases",
              "generate_functional_requirements",
            ],
            description: "要执行的 use_case_writer 子操作",
          },
          softwareIntro: {
            type: "string",
          },
          scoperResultPath: {
            type: "string",
          },
          existingSimpleUseCasePath: {
            type: "string",
          },
          newUseCases: {
            type: "array",
            items: { type: "string" },
          },
          erModelPath: {
            type: "string",
          },
          simpleUseCasePath: {
            type: "string",
          },
        },
        required: ["action"],
        additionalProperties: false,
      },
      async execute(_toolCallId: string, params: any) {
        applyPluginConfigToEnv(pluginConfig);
        ensureRequiredEnv();

        const action = requireNonEmptyString("action", params?.action);

        const {
          generateSimpleUseCases,
          generateNewUseCases,
          generateFunctionalRequirements,
        } = await import("./src/tools/use_case_writer.js");

        switch (action) {
          case "generate_simple_use_cases": {
            const result = await generateSimpleUseCases({
              softwareIntro: requireNonEmptyString("softwareIntro", params?.softwareIntro),
              scoperResultPath: requireNonEmptyString(
                "scoperResultPath",
                params?.scoperResultPath
              ),
            });
            return toolResult(result);
          }

          case "generate_new_use_cases": {
            const result = await generateNewUseCases({
              softwareIntro: requireNonEmptyString("softwareIntro", params?.softwareIntro),
              existingSimpleUseCasePath: requireNonEmptyString(
                "existingSimpleUseCasePath",
                params?.existingSimpleUseCasePath
              ),
              newUseCases: requireStringArray("newUseCases", params?.newUseCases),
            });
            return toolResult(result);
          }

          case "generate_functional_requirements": {
            const result = await generateFunctionalRequirements({
              softwareIntro: requireNonEmptyString("softwareIntro", params?.softwareIntro),
              erModelPath: requireNonEmptyString("erModelPath", params?.erModelPath),
              simpleUseCasePath: requireNonEmptyString(
                "simpleUseCasePath",
                params?.simpleUseCasePath
              ),
            });
            return toolResult(result);
          }

          default:
            throw new Error(`未知 action: ${action}`);
        }
      },
    });

    api.registerTool({
      name: "er_model_builder",
      label: "ER Model Builder",
      description: "生成 ER 模型、检查 ER 模型、补全 ER 模型，均以文件路径作为中间输入输出。",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: [
              "generate_er_model",
              "check_er_model",
              "complete_er_model",
            ],
          },
          softwareIntro: { type: "string" },
          scoperResultPath: { type: "string" },
          erModelPath: { type: "string" },
          oldErModelPath: { type: "string" },
          newUseCasePath: { type: "string" },
        },
        required: ["action"],
        additionalProperties: false,
      },
      async execute(_toolCallId: string, params: any) {
        applyPluginConfigToEnv(pluginConfig);
        ensureRequiredEnv();

        const action = requireNonEmptyString("action", params?.action);

        const {
          generateErModel,
          checkErModel,
          completeErModel,
        } = await import("./src/tools/er_model_builder.js");

        switch (action) {
          case "generate_er_model": {
            const result = await generateErModel({
              softwareIntro: requireNonEmptyString("softwareIntro", params?.softwareIntro),
              scoperResultPath: requireNonEmptyString(
                "scoperResultPath",
                params?.scoperResultPath
              ),
            });
            return toolResult(result);
          }

          case "check_er_model": {
            const result = await checkErModel({
              softwareIntro: requireNonEmptyString("softwareIntro", params?.softwareIntro),
              scoperResultPath: requireNonEmptyString(
                "scoperResultPath",
                params?.scoperResultPath
              ),
              erModelPath: requireNonEmptyString("erModelPath", params?.erModelPath),
            });
            return toolResult(result);
          }

          case "complete_er_model": {
            const result = await completeErModel({
              oldErModelPath: requireNonEmptyString(
                "oldErModelPath",
                params?.oldErModelPath
              ),
              newUseCasePath: requireNonEmptyString(
                "newUseCasePath",
                params?.newUseCasePath
              ),
            });
            return toolResult(result);
          }

          default:
            throw new Error(`未知 action: ${action}`);
        }
      },
    });

    api.registerTool({
      name: "curd_model_builder",
      label: "CURD Model Builder",
      description: "生成 CURD 三元组、检查 CURD 完整性、补全 CURD、转成矩阵，均以文件路径作为中间输入输出。",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: [
              "generate_curd_triples",
              "check_curd_completeness",
              "complete_curd_triples",
              "convert_curd_triples_to_matrix",
            ],
          },
          scoperResultPath: {
            type: "string",
          },
          useCaseDescriptionPath: {
            type: "string",
          },
          erModelPath: {
            type: "string",
          },
          curdTriplesPath: {
            type: "string",
          },
          newUseCasePath: {
            type: "string",
          },
          previousCurdTriplesPath: {
            type: "string",
          },
          missingReportPath: {
            type: "string",
          },
        },
        required: ["action"],
        additionalProperties: false,
      },
      async execute(_toolCallId: string, params: any) {
        applyPluginConfigToEnv(pluginConfig);
        ensureRequiredEnv();

        const action = requireNonEmptyString("action", params?.action);

        const {
          generateCurdTriples,
          checkCurdCompleteness,
          completeCurdTriples,
          convertCurdTriplesToMatrix,
        } = await import("./src/tools/curd_model_builder.js");

        switch (action) {
          case "generate_curd_triples": {
            const result = await generateCurdTriples({
              scoperResultPath: requireNonEmptyString(
                "scoperResultPath",
                params?.scoperResultPath
              ),
              useCaseDescriptionPath: requireNonEmptyString(
                "useCaseDescriptionPath",
                params?.useCaseDescriptionPath
              ),
            });
            return toolResult(result);
          }

          case "check_curd_completeness": {
            const result = await checkCurdCompleteness({
              erModelPath: requireNonEmptyString("erModelPath", params?.erModelPath),
              scoperResultPath: requireNonEmptyString(
                "scoperResultPath",
                params?.scoperResultPath
              ),
              curdTriplesPath: requireNonEmptyString(
                "curdTriplesPath",
                params?.curdTriplesPath
              ),
            });
            return toolResult(result);
          }

          case "complete_curd_triples": {
            const result = await completeCurdTriples({
              erModelPath: requireNonEmptyString("erModelPath", params?.erModelPath),
              newUseCasePath: requireNonEmptyString(
                "newUseCasePath",
                params?.newUseCasePath
              ),
              previousCurdTriplesPath: requireNonEmptyString(
                "previousCurdTriplesPath",
                params?.previousCurdTriplesPath
              ),
              missingReportPath: requireNonEmptyString(
                "missingReportPath",
                params?.missingReportPath
              ),
            });
            return toolResult(result);
          }

          case "convert_curd_triples_to_matrix": {
            const result = await convertCurdTriplesToMatrix({
              curdTriplesPath: requireNonEmptyString(
                "curdTriplesPath",
                params?.curdTriplesPath
              ),
            });
            return toolResult(result);
          }

          default:
            throw new Error(`未知 action: ${action}`);
        }
      },
    });

    api.registerTool({
      name: "document_exporter",
      label: "Document Exporter",
      description:
        "导出三个文档：ER 模型文档、修改后的用例模型文档、功能需求文档，输入为文件路径。",
      parameters: {
        type: "object",
        properties: {
          projectName: { type: "string" },
          erModelPath: { type: "string" },
          updatedUseCasePath: { type: "string" },
          functionalRequirementsPath: { type: "string" },
          softwareIntro: { type: "string" },
          scoperResultPath: { type: "string" },
          artifactPrefix: { type: "string" },
          outputDir: { type: "string" },
        },
        required: [
          "projectName",
          "erModelPath",
          "updatedUseCasePath",
          "functionalRequirementsPath",
        ],
        additionalProperties: false,
      },
      async execute(_toolCallId: string, params: any) {
        applyPluginConfigToEnv(pluginConfig);
        ensureRequiredEnv();

        const { exportRequirementsDocuments } = await import(
          "./src/tools/document_exporter.js"
        );

        const result = await exportRequirementsDocuments({
          projectName: requireNonEmptyString("projectName", params?.projectName),
          erModelPath: requireNonEmptyString("erModelPath", params?.erModelPath),
          updatedUseCasePath: requireNonEmptyString(
            "updatedUseCasePath",
            params?.updatedUseCasePath
          ),
          functionalRequirementsPath: requireNonEmptyString(
            "functionalRequirementsPath",
            params?.functionalRequirementsPath
          ),
          softwareIntro: optionalString(params?.softwareIntro),
          scoperResultPath: optionalString(params?.scoperResultPath),
          artifactPrefix: optionalString(params?.artifactPrefix),
          outputDir: optionalString(params?.outputDir),
        });

        return toolResult(result);
      },
    });
  },
});