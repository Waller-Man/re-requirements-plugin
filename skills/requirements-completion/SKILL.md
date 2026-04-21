---
name: requirements-completion
description: 根据用户提供的软件需求，分阶段完成数据实体抽取、用例建模、ER 建模、CURD 建模，并最终导出 ER 模型文档、修改后的用例模型文档和功能需求文档。适用于需求工程建模与需求制品生成任务。
---

# Requirements Completion

## 作用

当用户提供一段软件需求描述，并希望自动完成需求分析、需求建模、功能需求整理或需求文档导出时，使用本 skill。

本 skill 适用于以下场景：

- 根据一句或一段软件需求，自动生成需求工程相关制品
- 自动抽取数据实体与初始用例
- 自动生成和补全用例模型、ER 模型、CURD 模型
- 自动生成功能需求文本
- 自动导出最终文档

---

## 何时使用

当用户表达出以下意图时，应考虑使用本 skill：

- “帮我根据这个需求生成需求模型”
- “帮我分析这个系统应该有哪些实体、用例、ER 模型”
- “帮我补全需求工程建模流程”
- “帮我把这些需求结果导出成文档”
- “帮我跑完整个需求工程流水线”

如果用户只是想修改局部文本、单独调整某个实体、单独补一个用例，或者只想导出已有结果，则不应强制跑完整流程，可以只调用相关 tool。

---

## 当前工具链

默认使用以下工具：

1. `requirement_scoper`
2. `use_case_writer`
3. `er_model_builder`
4. `curd_model_builder`
5. `document_exporter`

说明：

- 旧版流程中的 `model_reviewer`、`srs_writer`、`artifact_renderer` 已不再作为本 skill 的默认组成部分
- 当前版本的最终导出由 `document_exporter` 负责
- 当前版本重点输出三类文档：
  - ER 模型文档
  - 修改后的用例模型文档
  - 功能需求文档

---

## 输入要求

通常至少需要：

- 一段清晰的软件需求描述 `softwareIntro`

例如：

- “我需要一个简单的 12306 订票系统”
- “请为一个在线图书管理系统生成需求模型和功能需求文档”
- “请根据这个需求完成实体、用例、ER 和 CURD，并导出文档”

如果用户没有提供系统需求描述，应先要求用户补充。

---

## 总体流程

默认按以下顺序执行：

1. 使用 `requirement_scoper` 抽取数据实体与初始用例
2. 使用 `use_case_writer` 生成简单用例描述
3. 使用 `er_model_builder` 生成并检查 ER 模型
4. 使用 `curd_model_builder` 生成并检查 CURD 模型
5. 若 CURD 检查发现缺口，则回到用例与 ER 补全过程
6. 使用 `use_case_writer` 生成功能需求文本
7. 使用 `document_exporter` 导出三个最终文档

除非用户明确要求只执行某一部分，否则优先按完整流程推进。

---

## 执行步骤

### 第一步：抽取数据实体与初始用例

调用 `requirement_scoper`，输入用户的 `softwareIntro`。

目标：

- 识别核心数据实体
- 识别初始用例列表

要求：

- 实体数量尽量精简，不要把普通属性误当成实体
- 用例应覆盖系统的主要业务流程
- 如果结果明显偏离需求主题，应优先重新生成当前步骤

这一步的输出将作为后续步骤的基础。

---

### 第二步：生成简单用例描述

调用 `use_case_writer` 的 `generate_simple_use_cases`。

输入：

- `softwareIntro`
- `dataEntities`
- `useCases`

目标：

- 为每个初始用例生成结构化用例描述
- 输出统一格式的用例模型文本

要求：

- 用例描述要围绕系统核心业务
- 风格保持一致
- 不要生成与系统无关的边缘功能
- 若后续发现用例缺失，可再次调用补充能力

---

### 第三步：生成并检查 ER 模型

调用 `er_model_builder`。

推荐顺序：

1. `generate_er_model`
2. `check_er_model`

输入：

- `softwareIntro`
- `dataEntities`
- `useCases`
- 已生成的 `erModelText`

目标：

- 形成较完整的实体关系模型
- 保证实体关系具备业务合理性
- 尽量避免孤立实体、重复实体、关系缺失

如果后续因为 CURD 检查而新增了用例，则应调用 `complete_er_model` 更新 ER 模型。

---

### 第四步：生成并检查 CURD 模型

调用 `curd_model_builder`。

推荐顺序：

1. `generate_curd_triples`
2. `check_curd_completeness`

输入：

- `dataEntities`
- `useCases`
- `useCaseDescriptionText`
- `erModelText`

目标：

- 生成 CURD 三元组
- 检查实体与用例之间是否存在明显缺失的交互
- 如有缺失，提出建议补充的用例

---

### 第五步：在必要时执行补全过程

如果 `check_curd_completeness` 表明模型不完整，并且返回了 `suggestedUseCases`，则执行以下回路：

1. 调用 `use_case_writer` 的 `generate_new_use_cases`
2. 调用 `er_model_builder` 的 `complete_er_model`
3. 调用 `curd_model_builder` 的 `complete_curd_triples`

目标：

- 用新增用例补足缺失业务动作
- 用最新用例更新 ER 模型
- 让 CURD 模型更完整、更贴近真实业务流程

注意：

- 后续步骤必须优先使用补全后的最新结果
- 不要继续沿用旧版本的 `useCases`、`simpleUseCaseText`、`erModelText`、`curdTriples`

---

### 第六步：生成功能需求文本

调用 `use_case_writer` 的 `generate_functional_requirements`。

输入：

- `softwareIntro`
- `erModel`
- `simpleUseCaseText`

目标：

- 基于当前已完成的用例模型与 ER 模型，整理成功能需求文档文本
- 保持需求表达完整、正式、可读

要求：

- 功能需求必须和前面的模型保持一致
- 不要脱离当前模型随意扩展功能范围
- 功能需求应体现系统能做什么，而不是泛泛而谈

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
- `updatedUseCaseText` 应传入最新的完整用例模型文本
- 如果用户没有指定项目名，可根据需求内容给出一个简洁、明确的默认名称

---

## 状态维护要求

执行本 skill 时，应持续维护以下中间结果，并在后续步骤中始终使用“最新版本”：

- `softwareIntro`
- `dataEntities`
- `useCases`
- `simpleUseCaseText`
- `erModelText`
- `curdTriples`
- `functionalRequirementsText`

如发生补全过程，还应同步更新：

- `latestUseCases`
- `latestSimpleUseCaseText`
- `latestErModelText`
- `latestCurdTriples`

最终导出时，必须使用补全后的最终版本，而不是初始版本。

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
7. 如有缺失则执行补全过程
8. `use_case_writer.generate_functional_requirements`
9. `document_exporter`

### 局部流程场景

如果用户只关心某一部分，则只调用对应步骤。例如：

- 只想要实体和用例：调用 `requirement_scoper`
- 只想补用例：调用 `use_case_writer.generate_new_use_cases`
- 只想更新 ER：调用 `er_model_builder.complete_er_model`
- 只想导出文档：调用 `document_exporter`

---

## 错误处理

### 如果模型调用超时或连接中断

可以重试当前步骤一次。  
如果仍失败，应明确告诉用户是哪一步失败，不要伪造结果。

### 如果某一步输出明显不合理

例如：

- 实体明显偏题
- 用例与需求不匹配
- ER 模型出现大量无关实体
- CURD 建议明显失真

应优先重新生成当前步骤，而不是直接把错误继续传递给后续步骤。

### 如果导出失败

应检查以下内容：

- `projectName` 是否为空
- 三份文档正文是否为空
- `outputDir` 是否可写
- 传入的 `updatedUseCaseText`、`erModelText`、`functionalRequirementsText` 是否已经生成完成

不要在导出失败时假装已经生成文件。

---

## 不应做的事

- 不要在没有 `softwareIntro` 的情况下强行运行完整流程
- 不要跳过前置建模步骤直接导出文档
- 不要把旧版中已经移除的工具当作默认流程的一部分
- 不要在模型还未补全完成时就导出最终文档
- 不要把初始结果误当成最终结果使用
- 不要在功能需求中混入未经模型支持的额外功能

---

## 最终输出建议

如果用户要求完整结果，最终应尽量提供：

1. 核心建模结果摘要
2. 数据实体列表
3. 最终用例列表
4. ER 模型摘要
5. CURD 检查情况
6. 功能需求摘要
7. 三个导出文档的路径

如果用户只关心某个中间结果，则只返回相关部分即可。

---

## 给代理的执行提醒

- 优先保证步骤之间的数据一致性
- 发现 CURD 缺口时，不要直接忽略
- 一旦发生补全过程，后续必须切换到最新状态
- 导出前最后确认三份核心文本都已经生成
- 默认以“完整流程优先、局部调用兼容”的方式使用本 skill