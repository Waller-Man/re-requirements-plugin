---
name: requirements-completion
description: 根据用户提供的软件需求，完成数据实体抽取、用例建模、ER 建模、CURD 建模、功能需求生成，并导出 ER 模型文档、修改后的用例模型文档和功能需求文档。
---

# Requirements Completion

## 作用

当用户提供一段软件需求描述，并希望自动完成需求分析、需求建模、功能需求整理或文档导出时，使用本 skill。

适用场景：

- 根据一句或一段软件需求生成需求工程制品
- 自动抽取数据实体与初始用例
- 自动生成并补全用例模型、ER 模型、CURD 模型
- 自动生成功能需求文本
- 自动导出最终文档

如果用户只想修改局部内容、补某个实体、补某个用例，或只导出已有结果，则不要强制执行完整流程，只调用对应 tool。

---

## 当前工具链

默认使用以下工具：

1. `requirement_scoper`
2. `use_case_writer`
3. `er_model_builder`
4. `curd_model_builder`
5. `document_exporter`

说明：

- 旧版流程中的 `model_reviewer`、`srs_writer`、`artifact_renderer` 不再参与默认流程
- 最终只导出三类文档：
  - ER 模型文档
  - 修改后的用例模型文档
  - 功能需求文档

---

## 输入要求

至少需要：

- 一段清晰的软件需求描述 `softwareIntro`

例如：

- “我需要一个简单的 12306 订票系统”
- “请为一个在线图书管理系统生成需求模型和功能需求文档”
- “请根据这个需求完成实体、用例、ER 和 CURD，并导出文档”

如果用户没有提供系统需求描述，应先要求补充。

---

## 总体流程

默认按以下顺序执行：

1. `requirement_scoper`
2. `use_case_writer.generate_simple_use_cases`
3. `er_model_builder.generate_er_model`
4. `er_model_builder.check_er_model`
5. `curd_model_builder.generate_curd_triples`
6. `curd_model_builder.check_curd_completeness`
7. 若不完整，则进入“补全 + 复检”循环
8. `use_case_writer.generate_functional_requirements`
9. `document_exporter`

除非用户明确要求只执行其中一部分，否则优先跑完整流程。

---

## 执行步骤

### 第一步：抽取数据实体与初始用例

调用 `requirement_scoper`，输入 `softwareIntro`。

目标：

- 识别核心数据实体
- 识别初始用例列表

要求：

- 实体数量尽量精简，不要把普通属性误当成实体
- 用例要覆盖主要业务流程
- 若输出明显偏题，应优先重做当前步骤

输出作为后续全部步骤的基础。

---

### 第二步：生成简单用例描述

调用 `use_case_writer.generate_simple_use_cases`。

输入：

- `softwareIntro`
- `dataEntities`
- `useCases`

目标：

- 为每个初始用例生成结构化描述
- 形成统一格式的 `simpleUseCaseText`

要求：

- 围绕系统核心业务
- 风格一致
- 不生成无关边缘功能
- 若后续发现缺失用例，可再调用补充能力

执行后，保存最新的 `simpleUseCaseText`。

---

### 第三步：生成并检查 ER 模型

调用 `er_model_builder`，推荐顺序：

1. `generate_er_model`
2. `check_er_model`

输入：

- `softwareIntro`
- `dataEntities`
- `useCases`
- `erModelText`

目标：

- 形成较完整、合理的实体关系模型
- 尽量避免孤立实体、重复实体、关系缺失

如果后续新增了用例，必须再调用 `complete_er_model` 更新 ER 模型。

执行后，保存最新的 `erModelText`。

---

### 第四步：生成并检查 CURD 模型

调用 `curd_model_builder`，推荐顺序：

1. `generate_curd_triples`
2. `check_curd_completeness`

输入：

- `dataEntities`
- `useCases`
- `useCaseDescriptionText`
- `erModelText`

目标：

- 生成 CURD 三元组
- 检查实体与用例的交互是否缺失
- 若有缺失，给出 `suggestedUseCases`

执行后，保存：

- `curdTriples`
- `isComplete`
- `missingReportText`
- `suggestedUseCases`

---

### 第五步：必要时执行补全过程，并反复复检

如果 `check_curd_completeness` 返回模型不完整，则进入循环。

每轮循环必须按以下顺序执行：

1. `use_case_writer.generate_new_use_cases`
2. `er_model_builder.complete_er_model`
3. `curd_model_builder.complete_curd_triples`
4. **再次调用** `curd_model_builder.check_curd_completeness`

循环退出条件：

- `isComplete = true`
- 或已经无法继续生成合理的新用例

目标：

- 用新增用例补足缺失业务动作
- 用最新用例更新 ER 模型
- 让 CURD 模型更完整、更贴近真实业务流程

强制要求：

- 每轮补全后都必须重新 `check_curd_completeness`
- 不允许只补一次就默认正确
- 不允许跳过复检直接进入后续步骤
- 每轮都必须用最新结果覆盖旧状态

每轮结束后必须刷新：

- `useCases`
- `simpleUseCaseText`
- `erModelText`
- `curdTriples`
- `missingReportText`
- `suggestedUseCases`

后续步骤只允许使用最后一次复检后的最新结果。

---

### 第六步：生成功能需求文本

调用 `use_case_writer.generate_functional_requirements`。

输入：

- `softwareIntro`
- `erModel`
- `simpleUseCaseText`

目标：

- 基于当前用例模型与 ER 模型，生成功能需求文档正文
- 保持表达完整、正式、可读

要求：

- 与前面模型保持一致
- 不要脱离当前模型扩展范围
- 功能需求应体现系统能做什么
- **必须保留 tool 返回的完整正文**
- **不要压缩成一句摘要**
- **不要只保留标题、章节名或简短说明**

特别要求：

- `functionalRequirementsText` 必须是 `generate_functional_requirements` 返回的完整原文
- 不允许改写成类似 “Functional Requirements Document with xx requirements ...” 的摘要句
- 如果结果过短、只有标题或一两句总结，应视为异常，先重做本步骤，再继续后续流程

---

### 第七步：导出最终文档

调用 `document_exporter`。

输入通常包括：

- `projectName`
- `softwareIntro`
- `dataEntities`
- `useCases`
- `erModelText`
- `updatedUseCaseText`
- `functionalRequirementsText`

目标：

- 导出 ER 模型文档
- 导出修改后的用例模型文档
- 导出功能需求文档

要求：

- 导出内容必须基于最新版本结果
- `updatedUseCaseText` 必须传入最新的完整用例模型文本
- `functionalRequirementsText` 必须传入第六步生成的完整正文
- 如果用户没有指定项目名，可根据需求内容给出简洁明确的默认名称

导出时的强制要求：

- 不要把 `updatedUseCaseText` 改成摘要再传入
- 不要把 `functionalRequirementsText` 改成摘要再传入
- 必须直接使用前面 tool 的完整输出
- 如果发现 `functionalRequirementsText` 明显不是完整正文，而只是摘要句或极短说明，应停止导出，先重成功能需求文本

---

## 状态维护要求

执行本 skill 时，应持续维护并始终使用“最新版本”的以下结果：

- `softwareIntro`
- `dataEntities`
- `useCases`
- `simpleUseCaseText`
- `erModelText`
- `curdTriples`
- `functionalRequirementsText`

发生补全过程时，还必须同步更新：

- `latestUseCases`
- `latestSimpleUseCaseText`
- `latestErModelText`
- `latestCurdTriples`
- `latestMissingReportText`
- `latestSuggestedUseCases`
- `latestCurdCheckResult`

最终导出时，必须使用补全后的最终版本，不得回退到初始版本。

---

## 推荐调用策略

### 完整流程场景

当用户要求“完整生成需求工程结果”时，优先按以下流程：

1. `requirement_scoper`
2. `use_case_writer.generate_simple_use_cases`
3. `er_model_builder.generate_er_model`
4. `er_model_builder.check_er_model`
5. `curd_model_builder.generate_curd_triples`
6. `curd_model_builder.check_curd_completeness`
7. 如不完整，则进入“补全 + 复检”循环，直到通过或无法合理继续
8. `use_case_writer.generate_functional_requirements`
9. `document_exporter`

### 局部流程场景

如果用户只关心某一部分，只调用对应步骤，例如：

- 只要实体和用例：`requirement_scoper`
- 只补用例：`use_case_writer.generate_new_use_cases`
- 只更新 ER：`er_model_builder.complete_er_model`
- 只导出文档：`document_exporter`

---

## 错误处理

### 如果模型调用超时或连接中断

可重试当前步骤一次。  
若仍失败，应明确说明失败步骤，不要伪造结果。

### 如果某一步输出明显不合理

例如：

- 实体明显偏题
- 用例与需求不匹配
- ER 模型出现大量无关实体
- CURD 建议明显失真
- 功能需求只有标题和摘要，没有正文

应优先重做当前步骤，而不是把错误继续传递给后续步骤。

### 如果导出失败

应检查：

- `projectName` 是否为空
- 三份文档正文是否为空
- `outputDir` 是否可写
- `updatedUseCaseText`、`erModelText`、`functionalRequirementsText` 是否已生成完成
- `functionalRequirementsText` 是否确实为完整正文，而非摘要

不要在导出失败时假装已生成文件。

---

## 不应做的事

- 不要在没有 `softwareIntro` 的情况下强行跑完整流程
- 不要跳过前置建模步骤直接导出文档
- 不要把旧版已移除工具当作默认流程的一部分
- 不要在模型未补全完成时就导出最终文档
- 不要把初始结果误当成最终结果使用
- 不要在功能需求中混入未经模型支持的额外功能
- 不要把完整功能需求正文压成一句摘要后再导出
- 不要在未再次复检 CURD 的情况下结束补全过程

---

## 最终输出建议

如果用户要求完整结果，尽量提供：

1. 核心建模结果摘要
2. 数据实体列表
3. 最终用例列表
4. ER 模型摘要
5. CURD 检查情况
6. 功能需求摘要
7. 三个导出文档路径

如果用户只关心某个中间结果，则只返回相关部分。

---

## 给代理的执行提醒

- 始终优先保证步骤间数据一致性
- 发现 CURD 缺口时不要忽略
- 补全过程不是一次性动作，必须“补全后再检测”
- 一旦发生补全过程，后续必须切换到最新状态
- 生成功能需求后，必须保留完整正文，不得摘要化
- 导出前确认三份核心文本都已生成且内容完整
- 默认按“完整流程优先、局部调用兼容”的方式使用本 skill