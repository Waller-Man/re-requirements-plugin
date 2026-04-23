---
name: requirements-completion
description: 根据用户提供的软件需求，完成实体抽取、用例建模、ER/CURD 建模、功能需求生成，并导出最终文档。当前版本使用 path 传递中间结果。
---

# Requirements Completion

## 作用

当用户提供软件需求描述，希望自动完成需求分析、建模、功能需求整理或文档导出时，使用本 skill。

适用场景：

- 根据需求生成需求工程制品
- 自动抽取实体与初始用例
- 自动生成并补全用例模型、ER 模型、CURD 模型
- 自动生成功能需求文本
- 自动导出最终文档

如果用户只需要某个局部结果，只调用对应 tool，不强制跑完整流程。

---

## 当前工具链

1. `requirement_scoper`
2. `use_case_writer`
3. `er_model_builder`
4. `curd_model_builder`
5. `document_exporter`

---

## 输入要求

至少需要：

- `softwareIntro`：一段清晰的软件需求描述

如果没有需求描述，应先要求补充。

---

## 接口规则

当前版本所有中间结果都通过 **tool 返回的 `outputPath`** 传递。

### 必须遵守

- 只使用上一步 tool 返回的 `outputPath`
- 下一个 tool 只传 path，不传大段正文或大数组
- 始终使用最新结果路径

### 严禁

- 不要自己拼接路径
- 不要猜测文件名
- 不要把旧版字段重新塞回去，例如：
  - `dataEntities`
  - `useCases`
  - `simpleUseCaseText`
  - `erModelText`
  - `curdTriples`
  - `functionalRequirementsText`

当前 skill 只负责：**决定调用顺序，并把上一步返回的 path 传给下一步 tool。**

---

## 默认完整流程

除非用户明确要求只做局部步骤，否则优先执行：

1. `requirement_scoper`
2. `use_case_writer.generate_simple_use_cases`
3. `er_model_builder.generate_er_model`
4. `er_model_builder.check_er_model`
5. `curd_model_builder.generate_curd_triples`
6. `curd_model_builder.check_curd_completeness`
7. 如不完整，进入“补全 + 复检”循环
8. `use_case_writer.generate_functional_requirements`
9. `document_exporter`

---

## 状态维护

执行时持续维护最新路径：

- `latestScoperPath`
- `latestUseCasePath`
- `latestErModelPath`
- `latestCurdTriplesPath`
- `latestCurdCheckPath`
- `latestFunctionalRequirementsPath`

一旦某步产生新结果，必须覆盖旧路径，后续只用最新版本。

---

## 执行步骤

### 第一步：抽取实体与初始用例

调用 `requirement_scoper`：

```json
{
  "softwareIntro": "<softwareIntro>"
}
````

保存：

* `latestScoperPath = outputPath`

---

### 第二步：生成简单用例描述

调用 `use_case_writer.generate_simple_use_cases`：

```json
{
  "action": "generate_simple_use_cases",
  "softwareIntro": "<softwareIntro>",
  "scoperResultPath": "<latestScoperPath>"
}
```

保存：

* `latestUseCasePath = outputPath`

---

### 第三步：生成并检查 ER 模型

先生成：

```json
{
  "action": "generate_er_model",
  "softwareIntro": "<softwareIntro>",
  "scoperResultPath": "<latestScoperPath>"
}
```

保存：

* `latestErModelPath = outputPath`

再检查：

```json
{
  "action": "check_er_model",
  "softwareIntro": "<softwareIntro>",
  "scoperResultPath": "<latestScoperPath>",
  "erModelPath": "<latestErModelPath>"
}
```

更新：

* `latestErModelPath = outputPath`

---

### 第四步：生成并检查 CURD 模型

先生成：

```json
{
  "action": "generate_curd_triples",
  "scoperResultPath": "<latestScoperPath>",
  "useCaseDescriptionPath": "<latestUseCasePath>"
}
```

保存：

* `latestCurdTriplesPath = outputPath`

再检查：

```json
{
  "action": "check_curd_completeness",
  "erModelPath": "<latestErModelPath>",
  "scoperResultPath": "<latestScoperPath>",
  "curdTriplesPath": "<latestCurdTriplesPath>"
}
```

保存：

* `latestCurdCheckPath = outputPath`

---

### 第五步：必要时执行补全过程，并反复复检

如果 CURD 检查结果不完整，则进入循环。

### 每轮循环必须严格按以下顺序执行

#### 1）补充新用例

```json
{
  "action": "generate_new_use_cases",
  "softwareIntro": "<softwareIntro>",
  "existingSimpleUseCasePath": "<latestUseCasePath>",
  "newUseCases": "<来自 latestCurdCheckPath 对应结果里的 suggestedUseCases>"
}
```

更新：

* `latestUseCasePath = outputPath`

#### 2）补全 ER 模型

```json
{
  "action": "complete_er_model",
  "oldErModelPath": "<latestErModelPath>",
  "newUseCasePath": "<latestUseCasePath>"
}
```

更新：

* `latestErModelPath = outputPath`

#### 3）补全 CURD 三元组

```json
{
  "action": "complete_curd_triples",
  "erModelPath": "<latestErModelPath>",
  "newUseCasePath": "<latestUseCasePath>",
  "previousCurdTriplesPath": "<latestCurdTriplesPath>",
  "missingReportPath": "<latestCurdCheckPath>"
}
```

更新：

* `latestCurdTriplesPath = outputPath`

#### 4）再次复检

```json
{
  "action": "check_curd_completeness",
  "erModelPath": "<latestErModelPath>",
  "scoperResultPath": "<latestScoperPath>",
  "curdTriplesPath": "<latestCurdTriplesPath>"
}
```

更新：

* `latestCurdCheckPath = outputPath`

### 循环退出条件

满足任一条件即可退出：

* `isComplete = true`
* 已无法继续生成合理的新用例
* 建议新增用例为空

### 强制要求

* 每轮补全后都必须重新复检
* 不允许只补一次就默认正确
* 不允许跳过复检直接进入后续步骤
* 每轮都必须覆盖旧 path

---

### 第六步：生成功能需求文本

调用：

```json
{
  "action": "generate_functional_requirements",
  "softwareIntro": "<softwareIntro>",
  "erModelPath": "<latestErModelPath>",
  "simpleUseCasePath": "<latestUseCasePath>"
}
```

保存：

* `latestFunctionalRequirementsPath = outputPath`

如果结果明显过短或像摘要，应重做本步骤。

---

### 第七步：导出最终文档

调用：

```json
{
  "projectName": "<projectName>",
  "softwareIntro": "<softwareIntro>",
  "scoperResultPath": "<latestScoperPath>",
  "erModelPath": "<latestErModelPath>",
  "updatedUseCasePath": "<latestUseCasePath>",
  "functionalRequirementsPath": "<latestFunctionalRequirementsPath>"
}
```

可选：

* `artifactPrefix`
* `outputDir`

要求：

* 只使用最终版本 path
* 不要回退到初始结果

---

## 局部调用策略

按用户需求只调用必要步骤：

* 只要实体和用例：`requirement_scoper`
* 只补用例：`use_case_writer.generate_new_use_cases`
* 只更新 ER：`er_model_builder.complete_er_model`
* 只转 CURD 矩阵：`curd_model_builder.convert_curd_triples_to_matrix`
* 只导出文档：`document_exporter`

局部调用时也必须遵守 path 规则。

---

## 错误处理

* 某一步失败：可重试一次；仍失败则明确说明失败步骤
* 某一步结果明显不合理：优先重做当前步骤，不要把错误传下去
* 不要伪造结果，不要假装导出成功

---

## 不应做的事

* 没有 `softwareIntro` 时强行跑完整流程
* 跳过前置建模直接导出
* 使用旧接口字段
* 自己构造路径
* 未复检完成就结束补全过程
* 只补一次就默认 CURD 正确

---

## 最终输出建议

完整流程结束后，优先给用户：

1. 数据实体列表
2. 最终用例列表
3. CURD 是否完整
4. 功能需求已生成说明
5. 导出文档结果路径


