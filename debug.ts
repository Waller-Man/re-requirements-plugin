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
import type { CurdTriple } from "./src/tools/curd_model_builder.js";
import { exportRequirementsDocuments } from "./src/tools/document_exporter.js";

async function main() {
  const softwareIntro = "我需要一个简单的12306订票系统";
  const projectName = "Train Ticket Booking System";

  let latestUseCases: string[] = [];
  let latestSimpleUseCaseText = "";
  let latestErModelText = "";
  let latestFunctionalRequirementsText = "";
  let latestCurdTriples: CurdTriple[] = [];

  console.log("======================================");
  console.log("开始调试当前保留的 tools");
  console.log("======================================");

  // =========================
  // tool1: requirement_scoper
  // =========================
  const scoped = await requirementScoper({
    softwareIntro,
  });

  latestUseCases = [...scoped.useCases];

  console.log("\n=== tool1: requirement_scoper ===");
  console.log(
    JSON.stringify(
      {
        dataEntities: scoped.dataEntities,
        useCases: scoped.useCases,
      },
      null,
      2
    )
  );

  // =========================
  // tool2: use_case_writer
  // 生成基础用例描述
  // =========================
  const simpleUc = await generateSimpleUseCases({
    softwareIntro,
    dataEntities: scoped.dataEntities,
    useCases: latestUseCases,
  });

  latestSimpleUseCaseText = simpleUc.simpleUseCaseText;

  console.log("\n=== tool2-1: generateSimpleUseCases ===");
  console.log(latestSimpleUseCaseText);

  // =========================
  // tool3: er_model_builder
  // 先生成，再检查
  // =========================
  const initialEr = await generateErModel({
    softwareIntro,
    dataEntities: scoped.dataEntities,
    useCases: latestUseCases,
  });

  console.log("\n=== tool3-1: generateErModel ===");
  console.log(initialEr.erModelText);

  const checkedEr = await checkErModel({
    softwareIntro,
    dataEntities: scoped.dataEntities,
    useCases: latestUseCases,
    erModelText: initialEr.erModelText,
  });

  latestErModelText = checkedEr.checkedErModelText;

  console.log("\n=== tool3-2: checkErModel ===");
  console.log(latestErModelText);

  // =========================
  // tool4: curd_model_builder
  // 生成 CURD，再检查完整性
  // =========================
  const curd = await generateCurdTriples({
    dataEntities: scoped.dataEntities,
    useCases: latestUseCases,
    useCaseDescriptionText: latestSimpleUseCaseText,
  });

  latestCurdTriples = curd.curdTriples;

  console.log("\n=== tool4-1: generateCurdTriples ===");
  console.log(JSON.stringify(latestCurdTriples, null, 2));

  const curdCheck = await checkCurdCompleteness({
    erModelText: latestErModelText,
    useCases: latestUseCases,
    curdTriples: latestCurdTriples,
  });

  console.log("\n=== tool4-2: checkCurdCompleteness ===");
  console.log(
    JSON.stringify(
      {
        isComplete: curdCheck.isComplete,
        missingReport: curdCheck.missingReportText,
        suggestedUseCases: curdCheck.suggestedUseCases,
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
  if (!curdCheck.isComplete && curdCheck.suggestedUseCases.length > 0) {
    console.log("\n=== 检测到 CURD 不完整，开始自动补全 ===");

    const appendedUc = await generateNewUseCases({
      softwareIntro,
      existingSimpleUseCaseText: latestSimpleUseCaseText,
      newUseCases: curdCheck.suggestedUseCases,
    });

    latestSimpleUseCaseText = appendedUc.appendedSimpleUseCaseText;
    latestUseCases = [...latestUseCases, ...appendedUc.newUseCaseList];

    console.log("\n=== tool2-2: generateNewUseCases ===");
    console.log(
      JSON.stringify(
        {
          newUseCaseList: appendedUc.newUseCaseList,
          newUseCaseText: appendedUc.newUseCaseText,
        },
        null,
        2
      )
    );

    const completedEr = await completeErModel({
      oldErModelText: latestErModelText,
      newUseCaseText: appendedUc.newUseCaseText,
    });

    latestErModelText = completedEr.completedErModelText;

    console.log("\n=== tool3-3: completeErModel ===");
    console.log(latestErModelText);

    const completedCurd = await completeCurdTriples({
      erModelText: latestErModelText,
      newUseCaseDescriptionText: latestSimpleUseCaseText,
      previousCurdTriples: latestCurdTriples,
      missingReportText: curdCheck.missingReportText,
    });

    latestCurdTriples = completedCurd.mergedCurdTriples;

    console.log("\n=== tool4-3: completeCurdTriples ===");
    console.log(JSON.stringify(latestCurdTriples, null, 2));
  }

  // =========================
  // 输出最终 CURD 矩阵
  // =========================
  const finalCurdMatrix = convertCurdTriplesToMatrix({
    curdTriples: latestCurdTriples,
  });

  console.log("\n=== tool4-4: final curd matrix ===");
  console.log(JSON.stringify(finalCurdMatrix.matrixTable, null, 2));

  // =========================
  // tool2 补充：功能需求生成
  // =========================
  const functionalRequirements = await generateFunctionalRequirements({
    softwareIntro,
    erModel: latestErModelText,
    simpleUseCaseText: latestSimpleUseCaseText,
  });

  latestFunctionalRequirementsText =
    functionalRequirements.functionalRequirementsText;

  console.log("\n=== tool2-3: generateFunctionalRequirements ===");
  console.log(latestFunctionalRequirementsText);

  // =========================
  // 新 tool: document_exporter
  // 导出三个文档：
  // 1. ER 模型文档
  // 2. 修改过的用例模型文档
  // 3. 功能需求文档
  // =========================
  const exportedDocs = await exportRequirementsDocuments({
    projectName,
    softwareIntro,
    dataEntities: scoped.dataEntities,
    useCases: latestUseCases,
    erModelText: latestErModelText,
    updatedUseCaseText: latestSimpleUseCaseText,
    functionalRequirementsText: latestFunctionalRequirementsText,
    artifactPrefix: "train_ticket_booking_system",
  });

  console.log("\n=== new tool: document_exporter ===");
  console.log(
    JSON.stringify(
      {
        outputDir: exportedDocs.outputDir,
        erModelDocPath: exportedDocs.erModelDocPath,
        updatedUseCaseDocPath: exportedDocs.updatedUseCaseDocPath,
        functionalRequirementsDocPath:
          exportedDocs.functionalRequirementsDocPath,
      },
      null,
      2
    )
  );

  console.log("\n======================================");
  console.log("全部调试完成");
  console.log("如果上面没有报错，说明当前 tools 基本可正常运行");
  console.log("======================================");
}

main().catch((error) => {
  console.error("运行失败：", error);
  process.exit(1);
});