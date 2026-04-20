import { requirementScoper } from "./src/tools/requirement_scoper.js";
import {
  generateSimpleUseCases,
  generateNewUseCases,
  generateFunctionalRequirements,
  generateUseCaseDiagramCode,
} from "./src/tools/use_case_writer.js";
import {
  generateErModel,
  checkErModel,
  completeErModel,
  generateErCode,
} from "./src/tools/er_model_builder.js";
import {
  generateCurdTriples,
  checkCurdCompleteness,
  completeCurdTriples,
  convertCurdTriplesToMatrix,
} from "./src/tools/curd_model_builder.js";
import type { CurdTriple } from "./src/tools/curd_model_builder.js";
import { reviewRequirementModel } from "./src/tools/model_reviewer.js";
import {
  generateIntroduction,
  generateOverallDescription,
  generateExternalInterface,
  generateNonfunctionalRequirement,
} from "./src/tools/srs_writer.js";
import {
  renderUseCaseDiagram,
  renderErDiagram,
  exportProjectMarkdown,
} from "./src/tools/artifact_renderer.js";

async function main() {
  const softwareIntro = "我需要一个简单的12306订票系统";

  let latestUseCases: string[] = [];
  let latestSimpleUseCaseText = "";
  let latestErModelText = "";
  let latestFunctionalRequirementsText = "";
  let latestCurdTriples: CurdTriple[] = [];

  // tool6 产物
  let introductionText = "";
  let overallDescriptionText = "";
  let externalInterfaceText = "";
  let nonfunctionalRequirementText = "";

  // tool5 产物
  let reviewText = "";

  // tool7 产物
  let useCaseDiagramCode = "";
  let erDiagramCode = "";
  let useCaseDiagramPngPath = "";
  let erDiagramPngPath = "";
  let markdownPath = "";

  // =========================
  // tool1: requirement_scoper
  // =========================
  const scoped = await requirementScoper({
    softwareIntro,
  });

  latestUseCases = [...scoped.useCases];

  console.log("=== tool1: requirement_scoper ===");
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
  // =========================
  const simpleUc = await generateSimpleUseCases({
    softwareIntro,
    dataEntities: scoped.dataEntities,
    useCases: latestUseCases,
  });

  latestSimpleUseCaseText = simpleUc.simpleUseCaseText;

  console.log("\n=== tool2: use_case_writer ===");
  console.log(latestSimpleUseCaseText);

  // =========================
  // tool3: er_model_builder
  // =========================
  const initialEr = await generateErModel({
    softwareIntro,
    dataEntities: scoped.dataEntities,
    useCases: latestUseCases,
  });

  const checkedEr = await checkErModel({
    softwareIntro,
    dataEntities: scoped.dataEntities,
    useCases: latestUseCases,
    erModelText: initialEr.erModelText,
  });

  latestErModelText = checkedEr.checkedErModelText;

  console.log("\n=== tool3: er_model_builder ===");
  console.log(latestErModelText);

  // =========================
  // tool4: curd_model_builder
  // =========================
  const curd = await generateCurdTriples({
    dataEntities: scoped.dataEntities,
    useCases: latestUseCases,
    useCaseDescriptionText: latestSimpleUseCaseText,
  });

  latestCurdTriples = curd.curdTriples;

  const curdCheck = await checkCurdCompleteness({
    erModelText: latestErModelText,
    useCases: latestUseCases,
    curdTriples: latestCurdTriples,
  });

  console.log("\n=== tool4: curd_model_builder ===");
  console.log(
    JSON.stringify(
      {
        curdTriples: latestCurdTriples,
        missingReport: curdCheck.missingReportText,
        isComplete: curdCheck.isComplete,
        suggestedUseCases: curdCheck.suggestedUseCases,
      },
      null,
      2
    )
  );

  // 如果 CURD 不完整，则继续补全 use case / ER / CURD
  if (!curdCheck.isComplete && curdCheck.suggestedUseCases.length > 0) {
    const appendedUc = await generateNewUseCases({
      softwareIntro,
      existingSimpleUseCaseText: latestSimpleUseCaseText,
      newUseCases: curdCheck.suggestedUseCases,
    });

    latestSimpleUseCaseText = appendedUc.appendedSimpleUseCaseText;
    latestUseCases = [...latestUseCases, ...appendedUc.newUseCaseList];

    const completedEr = await completeErModel({
      oldErModelText: latestErModelText,
      newUseCaseText: appendedUc.newUseCaseText,
    });

    latestErModelText = completedEr.completedErModelText;

    const completedCurd = await completeCurdTriples({
      erModelText: latestErModelText,
      newUseCaseDescriptionText: latestSimpleUseCaseText,
      previousCurdTriples: latestCurdTriples,
      missingReportText: curdCheck.missingReportText,
    });

    latestCurdTriples = completedCurd.mergedCurdTriples;

    console.log("\n=== pipeline updated result ===");
    console.log(
      JSON.stringify(
        {
          latestUseCases,
          latestErModelText,
          latestCurdTriples,
        },
        null,
        2
      )
    );
  }

  // 打印最终 CURD 矩阵
  const finalCurdMatrix = convertCurdTriplesToMatrix({
    curdTriples: latestCurdTriples,
  });

  console.log("\n=== final curd matrix ===");
  console.log(JSON.stringify(finalCurdMatrix.matrixTable, null, 2));

  // =========================
  // tool2 补充：功能需求
  // tool6 的 external interface 要用
  // =========================
  const functionalRequirements = await generateFunctionalRequirements({
    softwareIntro,
    erModel: latestErModelText,
    simpleUseCaseText: latestSimpleUseCaseText,
  });

  latestFunctionalRequirementsText =
    functionalRequirements.functionalRequirementsText;

  console.log("\n=== functional requirements ===");
  console.log(latestFunctionalRequirementsText);

  // =========================
  // tool5: model_reviewer
  // 按原始 Python 主控逻辑，传 simple_uc 文本
  // =========================
  const review = await reviewRequirementModel({
    softwareIntro,
    dataEntities: scoped.dataEntities,
    useCases: latestUseCases,
    erModelText: latestErModelText,
    fullUseCaseText: latestSimpleUseCaseText,
  });

  reviewText = review.reviewText;

  console.log("\n=== tool5: model_reviewer ===");
  console.log(reviewText);

  // =========================
  // tool6: srs_writer
  // =========================
  const introduction = await generateIntroduction({
    softwareIntro,
    dataEntities: scoped.dataEntities,
    useCases: latestUseCases,
    erModelText: latestErModelText,
    simpleUseCaseText: latestSimpleUseCaseText,
  });

  introductionText = introduction.introductionText;

  console.log("\n=== tool6: introduction ===");
  console.log(introductionText);

  const overallDescription = await generateOverallDescription({
    softwareIntro,
    dataEntities: scoped.dataEntities,
    useCases: latestUseCases,
    erModelText: latestErModelText,
    simpleUseCaseText: latestSimpleUseCaseText,
  });

  overallDescriptionText = overallDescription.overallDescriptionText;

  console.log("\n=== tool6: overall description ===");
  console.log(overallDescriptionText);

  const externalInterface = await generateExternalInterface({
    softwareIntro,
    functionalRequirementsText: latestFunctionalRequirementsText,
  });

  externalInterfaceText = externalInterface.externalInterfaceText;

  console.log("\n=== tool6: external interface ===");
  console.log(externalInterfaceText);

  const nonfunctionalRequirement = await generateNonfunctionalRequirement({
    softwareIntro,
    overallDescriptionText,
    simpleUseCaseText: latestSimpleUseCaseText,
  });

  nonfunctionalRequirementText =
    nonfunctionalRequirement.nonfunctionalRequirementText;

  console.log("\n=== tool6: nonfunctional requirement ===");
  console.log(nonfunctionalRequirementText);

  // =========================
  // tool7: artifact_renderer
  // 图片渲染 + Markdown 导出
  // =========================

  // 先生成用例图代码
  const useCaseDiagram = await generateUseCaseDiagramCode({
    useCases: latestUseCases,
  });
  useCaseDiagramCode = useCaseDiagram.useCaseDiagramCode;

  console.log("\n=== tool7: use case diagram code ===");
  console.log(useCaseDiagramCode);

  // 再生成 ER 图代码
  const erCode = await generateErCode({
    erModelText: latestErModelText,
  });
  erDiagramCode = erCode.erCode;

  console.log("\n=== tool7: er diagram code ===");
  console.log(erDiagramCode);

  // 渲染用例图图片
  const renderedUc = await renderUseCaseDiagram({
    useCaseDiagramCode,
    artifactName: "use_case_diagram",
  });
  useCaseDiagramPngPath = renderedUc.pngPath;

  console.log("\n=== tool7: rendered use case diagram ===");
  console.log(JSON.stringify(renderedUc, null, 2));

  // 渲染 ER 图图片
  const renderedEr = await renderErDiagram({
    erDiagramCode,
    artifactName: "er_diagram",
  });
  erDiagramPngPath = renderedEr.pngPath;

  console.log("\n=== tool7: rendered er diagram ===");
  console.log(JSON.stringify(renderedEr, null, 2));

  // 导出项目 Markdown
  const exportedMarkdown = await exportProjectMarkdown({
    title: "12306 Requirements Engineering Artifacts",
    softwareIntro,
    dataEntities: scoped.dataEntities,
    useCases: latestUseCases,

    simpleUseCaseText: latestSimpleUseCaseText,
    erModelText: latestErModelText,
    functionalRequirementsText: latestFunctionalRequirementsText,
    reviewText,

    introductionText,
    overallDescriptionText,
    externalInterfaceText,
    nonfunctionalRequirementText,

    useCaseDiagramPngPath,
    erDiagramPngPath,

    artifactName: "requirements_artifacts",
  });

  markdownPath = exportedMarkdown.markdownPath;

  console.log("\n=== tool7: exported markdown ===");
  console.log(markdownPath);
  console.log(exportedMarkdown.markdownText);
}

main().catch((error) => {
  console.error("运行失败：", error);
  process.exit(1);
});