---
name: requirements-completion
description: 根据用户提供的软件需求，分阶段生成数据实体、用例模型、ER 模型、CURD 模型、需求评审、SRS 文本以及最终 Markdown 与图形制品。适用于需求工程建模与需求规约自动生成任务。
---

# Requirements Completion

## 作用

当用户提供一段软件需求描述，并希望自动完成需求建模、需求分析、SRS 撰写或需求制品导出时，使用本 skill。

本 skill 适用于以下场景：

- 根据一句或一段软件需求，自动生成需求工程相关制品
- 自动补全过程中的数据实体、用例、ER、CURD 等模型
- 自动撰写 SRS 各章节
- 自动输出 PlantUML 图与 Markdown 文档

---

## 何时使用

当用户表达出以下意图时，应考虑使用本 skill：

- “帮我根据这个需求生成需求模型”
- “帮我分析这个系统应该有哪些实体、用例、ER 图”
- “帮我生成软件需求规格说明书”
- “帮我把这些需求结果导出成文档或图”
- “帮我跑完整个需求工程流水线”

如果用户只是想修改某一小段文本，而不是运行完整需求流程，则不应强制使用整个 skill，可以只调用局部 tool。

---

## 总体流程

默认按以下顺序执行：

1. `requirement_scoper`
2. `use_case_writer`
3. `er_model_builder`
4. `curd_model_builder`
5. `model_reviewer`
6. `srs_writer`
7. `artifact_renderer`

除非用户明确要求只执行其中一部分，否则优先按完整流程推进。

---

## 输入要求

通常至少需要：

- 一段清晰的软件需求描述 `softwareIntro`

例如：

- “我需要一个简单的 12306 订票系统”
- “请为一个在线图书管理系统生成需求模型与 SRS”

如果用户没有提供系统需求描述，应先要求用户补充。

---

## 执行步骤

### 第一步：抽取数据实体与初始用例

调用 `requirement_scoper`，输入用户的 `softwareIntro`。

目标：

- 识别核心数据实体
- 识别初始用例列表

要求：

- 实体数量尽量精简
- 用例应覆盖主要业务流程
- 若输出明显偏离系统主题，应提醒并重新生成

这一步的输出作为后续所有步骤的基础。

---

### 第二步：生成简单用例描述

调用 `use_case_writer` 中生成简单用例描述的能力。

输入：

- `softwareIntro`
- `dataEntities`
- `useCases`

目标：

- 为每个初始用例生成结构化描述
- 输出统一格式的用例模型文本

要求：

- 用例描述应包含名称、编号、参与者、前置条件、后置条件、主流程、备选流程
- 风格保持一致
- 不要生成与系统无关的内容

如果后续步骤发现缺失用例，可以再次调用 `use_case_writer` 的补充能力追加新用例。

---

### 第三步：生成并完善 ER 模型

调用 `er_model_builder`。

先生成初始 ER 模型，再进行检查与修正。

输入：

- `softwareIntro`
- `dataEntities`
- `useCases`
- 必要时输入新增用例描述

目标：

- 形成较完整的实体关系模型
- 保证实体关系具备业务合理性
- 尽量避免孤立实体

如果后续补充了新用例，则应再次调用 `er_model_builder` 的补全能力更新 ER 模型。

---

### 第四步：生成并检查 CURD 模型

调用 `curd_model_builder`。

输入：

- `dataEntities`
- `useCases`
- `simpleUseCaseText`
- `erModelText`

目标：

- 生成 CURD 三元组
- 检查是否存在明显缺失的交互
- 如有缺失，生成建议补充的用例

若 CURD 检查发现模型不完整，则执行以下回路：

1. 调用 `use_case_writer` 补充新用例
2. 调用 `er_model_builder` 补全 ER 模型
3. 调用 `curd_model_builder` 补全 CURD 三元组

直到模型达到可接受状态，或用户主动终止。

---

### 第五步：进行综合评审

调用 `model_reviewer`。

输入：

- `softwareIntro`
- `dataEntities`
- `useCases`
- `erModelText`
- `simpleUseCaseText`

目标：

- 从业务价值、工程实践、规模适应性等角度评审当前需求模型
- 输出结构化评审意见

要求：

- 评审必须基于当前已有模型
- 不要凭空扩展系统功能
- 如果发现明显问题，应指出并给出修改建议

---

### 第六步：撰写 SRS 各章节

调用 `srs_writer`。

通常生成以下内容：

- Introduction
- Overall Description
- External Interface Requirements
- Nonfunctional Requirements

必要时，还应结合 `use_case_writer` 生成的功能需求文本一起组织输出。

要求：

- 各章节内容应与前面的模型保持一致
- 不要脱离系统需求自行扩展范围
- 文本应保持较正式、规范的需求文档风格

---

### 第七步：渲染图形与导出 Markdown

调用 `artifact_renderer`。

通常包括：

- 渲染用例图
- 渲染 ER 图
- 导出 Markdown 文档

如果 PlantUML 渲染失败：

- 先检查图代码是否包含非法说明行、无效语法或额外自然语言
- 必要时重新生成图代码
- 再重新渲染

Markdown 导出时，应尽量包含：

- 软件简介
- 数据实体
- 用例列表
- 用例描述
- ER 模型
- 功能需求
- 评审结果
- SRS 各章节
- 已渲染图片路径

---

## 状态维护要求

在执行本 skill 时，应持续维护并更新以下中间结果：

- `dataEntities`
- `useCases`
- `simpleUseCaseText`
- `erModelText`
- `curdTriples`
- `functionalRequirementsText`
- `reviewText`
- `introductionText`
- `overallDescriptionText`
- `externalInterfaceText`
- `nonfunctionalRequirementText`
- `useCaseDiagramCode`
- `erDiagramCode`
- `useCaseDiagramPngPath`
- `erDiagramPngPath`
- `markdownPath`

后续步骤应优先使用“最新版本”的结果，而不是旧结果。

---

## 错误处理

### 如果模型调用超时或连接中断

可以重试当前步骤一次。  
如果仍失败，应明确告诉用户是哪一步失败，不要伪造结果。

### 如果 PlantUML 渲染失败

优先判断是否为图代码语法问题。  
必要时先清理非法说明行，再重新渲染。

### 如果某一步输出明显不合理

例如：

- 实体明显偏题
- 用例与需求不匹配
- ER 模型出现大量无关实体
- CURD 建议明显失真

应优先重新生成当前步骤，而不是直接把错误继续传递给后续步骤。

---

## 不应做的事

- 不要跳过前置步骤直接生成后续高层产物
- 不要在没有 `softwareIntro` 的情况下强行运行完整流程
- 不要把 reviewer 的意见当成最终事实直接覆盖模型，除非重新经过模型更新步骤
- 不要输出与 PlantUML 无关的自然语言到图代码中
- 不要在 Markdown 导出中混入未验证的内容

---

## 最终输出建议

如果用户要求完整结果，最终应尽量提供：

1. 核心建模结果摘要
2. Markdown 文档路径
3. 用例图路径
4. ER 图路径

如用户只关心某个中间结果，则只返回相关部分即可。