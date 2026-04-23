import fs from "node:fs/promises";

import { requirementScoper } from "./src/tools/requirement_scoper.js";
import {
  generateSimpleUseCases,
  generateNewUseCases,
  generateFunctionalRequirements,
} from "./src/tools/use_case_writer.js";
import {
  generateErModel,
  checkErModel,
  completeErModel,
} from "./src/tools/er_model_builder.js";
import {
  generateCurdTriples,
  checkCurdCompleteness,
  completeCurdTriples,
  convertCurdTriplesToMatrix,
} from "./src/tools/curd_model_builder.js";
import { exportRequirementsDocuments } from "./src/tools/document_exporter.js";

// -------------------------
// 本地调试辅助类型
// -------------------------

type ToolResultLike = {
  status: "success" | "error";
  summary: string;
  outputPath?: string;
  outputType?: string;
};

type CurdTriple = {
  entity: string;
  useCase: string;
  operation: "C" | "U" | "R" | "D";
};

type RequirementScoperArtifact = {
  dataEntitiesText: string;
  useCasesText: string;
  dataEntities: string[];
  useCases: string[];
};

type SimpleUseCasesArtifact = {
  simpleUseCaseText: string;
  useCaseList: string[];
};

type NewUseCasesArtifact = {
  appendedSimpleUseCaseText: string;
  newUseCaseText: string;
  newUseCaseList: string[];
};

type ErModelArtifact = {
  erModelText: string;
};

type CurdTriplesArtifact = {
  curdTriplesText: string;
  curdTriples: CurdTriple[];
  newCurdTriplesText?: string;
  newCurdTriples?: CurdTriple[];
  mergedCurdTriples?: CurdTriple[];
};

type CurdCheckArtifact = {
  missingReportText: string;
  isComplete: boolean;
  suggestedUseCases: string[];
};

type CurdMatrixArtifact = {
  entities: string[];
  useCases: string[];
  matrixTable: Array<Record<string, string>>;
};

type FunctionalRequirementsArtifact = {
  functionalRequirementsText: string;
};

type ExportDocumentsArtifact = {
  outputDir: string;
  erModelDocPath: string;
  updatedUseCaseDocPath: string;
  functionalRequirementsDocPath: string;
};

// -------------------------
// 本地调试辅助函数
// -------------------------

function requireOutputPath(result: ToolResultLike, toolName: string): string {
  if (result.status !== "success") {
    throw new Error(`${toolName} 执行失败：${result.summary}`);
  }

  if (!result.outputPath) {
    throw new Error(`${toolName} 没有返回 outputPath`);
  }

  return result.outputPath;
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

function printToolResult(toolName: string, result: ToolResultLike): void {
  console.log(`\n=== ${toolName} ===`);
  console.log(
    JSON.stringify(
      {
        status: result.status,
        summary: result.summary,
        outputPath: result.outputPath,
        outputType: result.outputType,
      },
      null,
      2
    )
  );
}

// -------------------------
// 主流程
// -------------------------

async function main() {
  const softwareIntro = "我需要一个简单的12306订票系统";
  const projectName = "Train Ticket Booking System";

  // 后面统一只维护“最新路径”
  let latestUseCasePath = "";
  let latestErModelPath = "";
  let latestCurdTriplesPath = "";
  let latestFunctionalRequirementsPath = "";

  console.log("======================================");
  console.log("开始调试当前保留的 tools（path 版本）");
  console.log("======================================");

  // =========================
  // tool1: requirement_scoper
  // =========================
  const scoped = await requirementScoper({
    softwareIntro,
  });

  printToolResult("tool1: requirement_scoper", scoped);

  const scoperResultPath = requireOutputPath(scoped, "requirementScoper");
  const scopedArtifact = await readJsonFile<RequirementScoperArtifact>(
    scoperResultPath
  );

  console.log("\n--- scoper artifact preview ---");
  console.log(
    JSON.stringify(
      {
        dataEntities: scopedArtifact.dataEntities,
        useCases: scopedArtifact.useCases,
      },
      null,
      2
    )
  );

  // =========================
  // tool2-1: generateSimpleUseCases
  // =========================
  const simpleUc = await generateSimpleUseCases({
    softwareIntro,
    scoperResultPath,
  });

  printToolResult("tool2-1: generateSimpleUseCases", simpleUc);

  latestUseCasePath = requireOutputPath(simpleUc, "generateSimpleUseCases");

  const simpleUcArtifact = await readJsonFile<SimpleUseCasesArtifact>(
    latestUseCasePath
  );

  console.log("\n--- simple use cases preview ---");
  console.log(simpleUcArtifact.simpleUseCaseText);

  // =========================
  // tool3-1: generateErModel
  // =========================
  const initialEr = await generateErModel({
    softwareIntro,
    scoperResultPath,
  });

  printToolResult("tool3-1: generateErModel", initialEr);

  const initialErPath = requireOutputPath(initialEr, "generateErModel");
  const initialErArtifact = await readJsonFile<ErModelArtifact>(initialErPath);

  console.log("\n--- initial ER model preview ---");
  console.log(initialErArtifact.erModelText);

  // =========================
  // tool3-2: checkErModel
  // =========================
  const checkedEr = await checkErModel({
    softwareIntro,
    scoperResultPath,
    erModelPath: initialErPath,
  });

  printToolResult("tool3-2: checkErModel", checkedEr);

  latestErModelPath = requireOutputPath(checkedEr, "checkErModel");

  const checkedErArtifact = await readJsonFile<ErModelArtifact>(
    latestErModelPath
  );

  console.log("\n--- checked ER model preview ---");
  console.log(checkedErArtifact.erModelText);

  // =========================
  // tool4-1: generateCurdTriples
  // =========================
  const curd = await generateCurdTriples({
    scoperResultPath,
    useCaseDescriptionPath: latestUseCasePath,
  });

  printToolResult("tool4-1: generateCurdTriples", curd);

  latestCurdTriplesPath = requireOutputPath(curd, "generateCurdTriples");

  const curdArtifact = await readJsonFile<CurdTriplesArtifact>(
    latestCurdTriplesPath
  );

  console.log("\n--- curd triples preview ---");
  console.log(JSON.stringify(curdArtifact.curdTriples, null, 2));

  // =========================
  // tool4-2: checkCurdCompleteness
  // =========================
  const curdCheck = await checkCurdCompleteness({
    erModelPath: latestErModelPath,
    scoperResultPath,
    curdTriplesPath: latestCurdTriplesPath,
  });

  printToolResult("tool4-2: checkCurdCompleteness", curdCheck);

  const curdCheckPath = requireOutputPath(
    curdCheck,
    "checkCurdCompleteness"
  );
  const curdCheckArtifact = await readJsonFile<CurdCheckArtifact>(curdCheckPath);

  console.log("\n--- curd completeness preview ---");
  console.log(
    JSON.stringify(
      {
        isComplete: curdCheckArtifact.isComplete,
        missingReportText: curdCheckArtifact.missingReportText,
        suggestedUseCases: curdCheckArtifact.suggestedUseCases,
      },
      null,
      2
    )
  );

  // =========================
  // 如果 CURD 不完整：
  // 1. 生成新增用例
  // 2. 补全 ER
  // 3. 补全 CURD
  // =========================
  if (
    !curdCheckArtifact.isComplete &&
    curdCheckArtifact.suggestedUseCases.length > 0
  ) {
    console.log("\n=== 检测到 CURD 不完整，开始自动补全 ===");

    const appendedUc = await generateNewUseCases({
      softwareIntro,
      existingSimpleUseCasePath: latestUseCasePath,
      newUseCases: curdCheckArtifact.suggestedUseCases,
    });

    printToolResult("tool2-2: generateNewUseCases", appendedUc);

    latestUseCasePath = requireOutputPath(appendedUc, "generateNewUseCases");

    const appendedUcArtifact = await readJsonFile<NewUseCasesArtifact>(
      latestUseCasePath
    );

    console.log("\n--- appended use cases preview ---");
    console.log(
      JSON.stringify(
        {
          newUseCaseList: appendedUcArtifact.newUseCaseList,
          newUseCaseText: appendedUcArtifact.newUseCaseText,
        },
        null,
        2
      )
    );

    const completedEr = await completeErModel({
      oldErModelPath: latestErModelPath,
      newUseCasePath: latestUseCasePath,
    });

    printToolResult("tool3-3: completeErModel", completedEr);

    latestErModelPath = requireOutputPath(completedEr, "completeErModel");

    const completedErArtifact = await readJsonFile<ErModelArtifact>(
      latestErModelPath
    );

    console.log("\n--- completed ER model preview ---");
    console.log(completedErArtifact.erModelText);

    const completedCurd = await completeCurdTriples({
      erModelPath: latestErModelPath,
      newUseCasePath: latestUseCasePath,
      previousCurdTriplesPath: latestCurdTriplesPath,
      missingReportPath: curdCheckPath,
    });

    printToolResult("tool4-3: completeCurdTriples", completedCurd);

    latestCurdTriplesPath = requireOutputPath(
      completedCurd,
      "completeCurdTriples"
    );

    const completedCurdArtifact = await readJsonFile<CurdTriplesArtifact>(
      latestCurdTriplesPath
    );

    console.log("\n--- completed curd triples preview ---");
    console.log(
      JSON.stringify(
        completedCurdArtifact.mergedCurdTriples ??
          completedCurdArtifact.curdTriples,
        null,
        2
      )
    );
  }

  // =========================
  // 输出最终 CURD 矩阵
  // =========================
  const finalCurdMatrix = await convertCurdTriplesToMatrix({
    curdTriplesPath: latestCurdTriplesPath,
  });

  printToolResult("tool4-4: convertCurdTriplesToMatrix", finalCurdMatrix);

  const finalCurdMatrixPath = requireOutputPath(
    finalCurdMatrix,
    "convertCurdTriplesToMatrix"
  );
  const finalCurdMatrixArtifact = await readJsonFile<CurdMatrixArtifact>(
    finalCurdMatrixPath
  );

  console.log("\n--- final curd matrix preview ---");
  console.log(JSON.stringify(finalCurdMatrixArtifact.matrixTable, null, 2));

  // =========================
  // tool2-3: 生成功能需求
  // =========================
  const functionalRequirements = await generateFunctionalRequirements({
    softwareIntro,
    erModelPath: latestErModelPath,
    simpleUseCasePath: latestUseCasePath,
  });

  printToolResult(
    "tool2-3: generateFunctionalRequirements",
    functionalRequirements
  );

  latestFunctionalRequirementsPath = requireOutputPath(
    functionalRequirements,
    "generateFunctionalRequirements"
  );

  const functionalRequirementsArtifact =
    await readJsonFile<FunctionalRequirementsArtifact>(
      latestFunctionalRequirementsPath
    );

  console.log("\n--- functional requirements preview ---");
  console.log(functionalRequirementsArtifact.functionalRequirementsText);

  // =========================
  // document_exporter
  // 导出三个文档
  // =========================
  const exportedDocs = await exportRequirementsDocuments({
    projectName,
    softwareIntro,
    scoperResultPath,
    erModelPath: latestErModelPath,
    updatedUseCasePath: latestUseCasePath,
    functionalRequirementsPath: latestFunctionalRequirementsPath,
    artifactPrefix: "train_ticket_booking_system",
  });

  printToolResult("new tool: document_exporter", exportedDocs);

  const exportResultPath = requireOutputPath(
    exportedDocs,
    "exportRequirementsDocuments"
  );
  const exportArtifact = await readJsonFile<ExportDocumentsArtifact>(
    exportResultPath
  );

  console.log("\n--- exported documents preview ---");
  console.log(
    JSON.stringify(
      {
        outputDir: exportArtifact.outputDir,
        erModelDocPath: exportArtifact.erModelDocPath,
        updatedUseCaseDocPath: exportArtifact.updatedUseCaseDocPath,
        functionalRequirementsDocPath:
          exportArtifact.functionalRequirementsDocPath,
      },
      null,
      2
    )
  );

  console.log("\n======================================");
  console.log("全部调试完成");
  console.log("如果上面没有报错，并且每一步都有 outputPath，说明当前 path 链路基本可正常运行");
  console.log("======================================");
}

main().catch((error) => {
  console.error("运行失败：", error);
  process.exit(1);
});