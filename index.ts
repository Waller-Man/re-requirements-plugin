import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

type PluginConfig = {
  llmApiKey?: string;
  llmBaseUrl?: string;
  llmModel?: string;
  plantumlJar?: string;
  tempDir?: string;
  outputDir?: string;
};

type CurdTriple = {
  entity: string;
  useCase: string;
  operation: "C" | "U" | "R" | "D";
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
      `插件缺少必要配置：${missing.join("、")}。请先在 openclaw.json 里补齐。`,
    );
  }
}

function toText(data: unknown): string {
  if (typeof data === "string") {
    return data;
  }
  return JSON.stringify(data, null, 2);
}

function toolResult<T>(data: T): {
  content: Array<{
    type: "text";
    text: string;
  }>;
  details: T;
} {
  return {
    content: [
      {
        type: "text",
        text: toText(data),
      },
    ],
    details: data,
  };
}

function requireNonEmptyString(name: string, value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} 不能为空`);
  }
  return value.trim();
}

function optionalString(value: unknown, fallback = ""): string {
  if (typeof value !== "string") {
    return fallback;
  }
  return value;
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

function requireCurdTriples(name: string, value: unknown): CurdTriple[] {
  if (!Array.isArray(value)) {
    throw new Error(`${name} 必须是 CURD 三元组数组`);
  }

  return value.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`${name}[${index}] 格式不正确`);
    }

    const triple = item as Record<string, unknown>;
    const entity = requireNonEmptyString(`${name}[${index}].entity`, triple.entity);
    const useCase = requireNonEmptyString(`${name}[${index}].useCase`, triple.useCase);
    const operation = requireNonEmptyString(
      `${name}[${index}].operation`,
      triple.operation,
    ) as CurdTriple["operation"];

    if (!["C", "U", "R", "D"].includes(operation)) {
      throw new Error(`${name}[${index}].operation 必须是 C/U/R/D`);
    }

    return { entity, useCase, operation };
  });
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
      description: "从软件需求简介中抽取核心数据实体和初始用例列表。",
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
      description: "生成简单用例描述、补充新用例、生成功能需求文本、生成用例图代码。",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: [
              "generate_simple_use_cases",
              "generate_new_use_cases",
              "generate_functional_requirements",
              "generate_use_case_diagram_code",
            ],
            description: "要执行的 use_case_writer 子操作",
          },
          softwareIntro: {
            type: "string",
          },
          dataEntities: {
            type: "array",
            items: { type: "string" },
          },
          useCases: {
            type: "array",
            items: { type: "string" },
          },
          existingSimpleUseCaseText: {
            type: "string",
          },
          newUseCases: {
            type: "array",
            items: { type: "string" },
          },
          erModel: {
            type: "string",
          },
          simpleUseCaseText: {
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
          generateUseCaseDiagramCode,
        } = await import("./src/tools/use_case_writer.js");

        switch (action) {
          case "generate_simple_use_cases": {
            const result = await generateSimpleUseCases({
              softwareIntro: requireNonEmptyString("softwareIntro", params?.softwareIntro),
              dataEntities: requireStringArray("dataEntities", params?.dataEntities),
              useCases: requireStringArray("useCases", params?.useCases),
            });
            return toolResult(result);
          }

          case "generate_new_use_cases": {
            const result = await generateNewUseCases({
              softwareIntro: requireNonEmptyString("softwareIntro", params?.softwareIntro),
              existingSimpleUseCaseText: requireNonEmptyString(
                "existingSimpleUseCaseText",
                params?.existingSimpleUseCaseText,
              ),
              newUseCases: requireStringArray("newUseCases", params?.newUseCases),
            });
            return toolResult(result);
          }

          case "generate_functional_requirements": {
            const result = await generateFunctionalRequirements({
              softwareIntro: requireNonEmptyString("softwareIntro", params?.softwareIntro),
              erModel: requireNonEmptyString("erModel", params?.erModel),
              simpleUseCaseText: requireNonEmptyString(
                "simpleUseCaseText",
                params?.simpleUseCaseText,
              ),
            });
            return toolResult(result);
          }

          case "generate_use_case_diagram_code": {
            const result = await generateUseCaseDiagramCode({
              useCases: requireStringArray("useCases", params?.useCases),
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
      description: "生成 ER 模型、检查 ER 模型、补全 ER 模型、生成 ER 图代码。",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: [
              "generate_er_model",
              "check_er_model",
              "complete_er_model",
              "generate_er_code",
            ],
          },
          softwareIntro: { type: "string" },
          dataEntities: {
            type: "array",
            items: { type: "string" },
          },
          useCases: {
            type: "array",
            items: { type: "string" },
          },
          erModelText: { type: "string" },
          oldErModelText: { type: "string" },
          newUseCaseText: { type: "string" },
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
          generateErCode,
        } = await import("./src/tools/er_model_builder.js");

        switch (action) {
          case "generate_er_model": {
            const result = await generateErModel({
              softwareIntro: requireNonEmptyString("softwareIntro", params?.softwareIntro),
              dataEntities: requireStringArray("dataEntities", params?.dataEntities),
              useCases: requireStringArray("useCases", params?.useCases),
            });
            return toolResult(result);
          }

          case "check_er_model": {
            const result = await checkErModel({
              softwareIntro: requireNonEmptyString("softwareIntro", params?.softwareIntro),
              dataEntities: requireStringArray("dataEntities", params?.dataEntities),
              useCases: requireStringArray("useCases", params?.useCases),
              erModelText: requireNonEmptyString("erModelText", params?.erModelText),
            });
            return toolResult(result);
          }

          case "complete_er_model": {
            const result = await completeErModel({
              oldErModelText: requireNonEmptyString("oldErModelText", params?.oldErModelText),
              newUseCaseText: requireNonEmptyString("newUseCaseText", params?.newUseCaseText),
            });
            return toolResult(result);
          }

          case "generate_er_code": {
            const result = await generateErCode({
              erModelText: requireNonEmptyString("erModelText", params?.erModelText),
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
      description: "生成 CURD 三元组、检查 CURD 完整性、补全 CURD、转成矩阵。",
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
          dataEntities: {
            type: "array",
            items: { type: "string" },
          },
          useCases: {
            type: "array",
            items: { type: "string" },
          },
          useCaseDescriptionText: { type: "string" },
          erModelText: { type: "string" },
          curdTriples: {
            type: "array",
            items: {
              type: "object",
              properties: {
                entity: { type: "string" },
                useCase: { type: "string" },
                operation: {
                  type: "string",
                  enum: ["C", "U", "R", "D"],
                },
              },
              required: ["entity", "useCase", "operation"],
              additionalProperties: false,
            },
          },
          previousCurdTriples: {
            type: "array",
            items: {
              type: "object",
              properties: {
                entity: { type: "string" },
                useCase: { type: "string" },
                operation: {
                  type: "string",
                  enum: ["C", "U", "R", "D"],
                },
              },
              required: ["entity", "useCase", "operation"],
              additionalProperties: false,
            },
          },
          missingReportText: { type: "string" },
          newUseCaseDescriptionText: { type: "string" },
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
              dataEntities: requireStringArray("dataEntities", params?.dataEntities),
              useCases: requireStringArray("useCases", params?.useCases),
              useCaseDescriptionText: requireNonEmptyString(
                "useCaseDescriptionText",
                params?.useCaseDescriptionText,
              ),
            });
            return toolResult(result);
          }

          case "check_curd_completeness": {
            const result = await checkCurdCompleteness({
              erModelText: requireNonEmptyString("erModelText", params?.erModelText),
              useCases: requireStringArray("useCases", params?.useCases),
              curdTriples: requireCurdTriples("curdTriples", params?.curdTriples),
            });
            return toolResult(result);
          }

          case "complete_curd_triples": {
            const result = await completeCurdTriples({
              erModelText: requireNonEmptyString("erModelText", params?.erModelText),
              newUseCaseDescriptionText: requireNonEmptyString(
                "newUseCaseDescriptionText",
                params?.newUseCaseDescriptionText,
              ),
              previousCurdTriples: requireCurdTriples(
                "previousCurdTriples",
                params?.previousCurdTriples,
              ),
              missingReportText: requireNonEmptyString(
                "missingReportText",
                params?.missingReportText,
              ),
            });
            return toolResult(result);
          }

          case "convert_curd_triples_to_matrix": {
            const result = convertCurdTriplesToMatrix({
              curdTriples: requireCurdTriples("curdTriples", params?.curdTriples),
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
        "导出三个文档：ER 模型文档、修改后的用例模型文档、功能需求文档。",
      parameters: {
        type: "object",
        properties: {
          projectName: { type: "string" },
          erModelText: { type: "string" },
          updatedUseCaseText: { type: "string" },
          functionalRequirementsText: { type: "string" },
          softwareIntro: { type: "string" },
          dataEntities: {
            type: "array",
            items: { type: "string" },
          },
          useCases: {
            type: "array",
            items: { type: "string" },
          },
          artifactPrefix: { type: "string" },
          outputDir: { type: "string" },
        },
        required: [
          "projectName",
          "erModelText",
          "updatedUseCaseText",
          "functionalRequirementsText",
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
          erModelText: requireNonEmptyString("erModelText", params?.erModelText),
          updatedUseCaseText: requireNonEmptyString(
            "updatedUseCaseText",
            params?.updatedUseCaseText,
          ),
          functionalRequirementsText: requireNonEmptyString(
            "functionalRequirementsText",
            params?.functionalRequirementsText,
          ),
          softwareIntro:
            typeof params?.softwareIntro === "string"
              ? params.softwareIntro
              : undefined,
          dataEntities: Array.isArray(params?.dataEntities)
            ? requireStringArray("dataEntities", params?.dataEntities)
            : undefined,
          useCases: Array.isArray(params?.useCases)
            ? requireStringArray("useCases", params?.useCases)
            : undefined,
          artifactPrefix:
            typeof params?.artifactPrefix === "string"
              ? params.artifactPrefix
              : undefined,
          outputDir:
            typeof params?.outputDir === "string" ? params.outputDir : undefined,
        });

        return toolResult(result);
      },
    });
  },
});