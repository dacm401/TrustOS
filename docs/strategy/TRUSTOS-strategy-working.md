# TrustOS 策略工作文档（Living Doc）

> 规则（本次 retrospect 约定，双方遵守）：
> 1. 单一真相源 = 本文档；聊天只做「改哪、为什么」。
> 2. 一次一个决定，不堆问。
> 3. 新名词先定义再展开。
>
> 状态：进行中。源于 `TRUSTOS-positioning.md` 与 `TRUSTOS-user-facing.md`，并吸收本次 meta 复盘。

## 0. 当前 Thesis（sharp 版）
TrustOS 赌的是**后聊天（post-chat）的交互范式**，不是又一个聊天 agent：

- 人机协作的基本单位从「一条聊天」变成「一个持久、可导航、可分支、可 steer 的工作空间」。
- 两个具体钩子：
  - **时间机器 / 分支**：每次 model/tool 调用都被完整记录（Event Backbone 已有），用户可拖拽 / 回退 / 从任意节点另开一条线。
  - **累积的、可携带的「懂你」**：agent 持久理解你和项目，且跟随你、不绑某个模型（反锁定 = 留存）。
- 聊天降为多种输入方式之一（文字 / 语音 / 拖拽 / 命令），不再是组织隐喻。

## 1. 已决事项（Decision Log）
- **D1**：审计 / 可验证问责 = 伪需求，正式认栽冻结（evidence / provenance / signed-approval / trust-ref → deprecated，停投）。
- **D2**：隐私脱敏（DLP / sanitizer）保留，重归类为「隐私」而非「审计」。
- **D3**：架构站位 = A（保留自有核心；Hermes 作 worker 进主干，借脑不借壳；不做 UI 套黑盒的浅壳）。
- **D4**：继续开发不重来；Event Backbone 复用为连续性引擎（去「证明」叙事，保留 hash/prev_hash 近乎零成本完整性）。

## 2. 待决（Open / To-decide）
- **Q1**：产品名 **「TrustOS」是否还成立？** 核心 thesis 已承认「信任 / 可验证」是伪需求，品牌与 thesis 冲突，需决。
- **Q2**：UX 主线选「时间机器 / 分支」（工具向）还是「会顶嘴、记得住的搭档」（关系向），或两者揉合？
- **Q3**：「时间机器」如何翻译成非开发者能懂的隐喻（版本 / 后悔药 / 换条路）？
- **Q4**：前端现有 Next 壳能否承载 workspace / timeline，还是要重做？

## 3. 来源
- `TRUSTOS-positioning.md` — 内部战略叙事 v1
- `TRUSTOS-user-facing.md` — 用户视角说明 + 竞争力判断

## 4. 本次 meta 复盘要点（供后续对话遵守）
- 个人约束 ≠ 产品决策（不因用户机器/环境限制动产品 scope）。
- 策略讨论从第 1 轮落 living doc，不在聊天里反复现推导。
- 一次只问一件事；结论不早于前提；同时测「清晰」与「吸引力」；新名词先溯因再展开。
- 术语先对齐（audit / evidence / backbone / continuity / trust 边界）。
