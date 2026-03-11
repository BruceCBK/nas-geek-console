# Step 6 - V3 融合迭代（自动调优基线）

更新时间：2026-03-11 (Asia/Shanghai)

## 目标
把 `OpenclawVue`（视觉表达）与 `claw-control`（控制台信息结构）沉淀到当前 `nas-geek-console`，形成 V3 融合态 Dashboard：

- 可直接看到「风险评分 + 风险等级 + 告警 + 行动建议」
- 持续保留原有总览 / Skills / 内容工作台链路
- 保持 Express + 原生 SPA 架构，不引入额外前端框架

## 本轮落地

### 1) 后端：新增 V3 融合信号计算
文件：`src/routes/dashboard.js`

- 新增 `buildV3FusionSignals(...)`：
  - 输入：服务状态、Gateway 状态、任务汇总、最近日志、会话摘要
  - 输出：`v3` 字段，包含
    - `version` / `codename` / `references`
    - `score`（0-100）
    - `level` / `levelLabel`
    - `alerts[]`
    - `recommendations[]`
    - `updateMode`

- `GET /api/dashboard/summary` 已返回 `payload.v3`。

### 2) 前端：Dashboard 新增 V3 面板
文件：`public/index.html`, `public/app.js`

新增区块：
- `fusionSummaryCard`（V3 融合信号概览）
- `dashboardFusionAlerts`（V3 风险告警）
- `dashboardActionPlan`（V3 自动迭代建议）

新增渲染：
- `renderV3Fusion(fusion, payload)`

### 3) 契约与样式
文件：`scripts/ui-contract-check.js`, `public/styles.css`

- UI 契约升级为 V3，新增 DOM id 与 `renderV3Fusion` hook 校验。
- Dashboard 卡片网格改为 `auto-fit`，保证 V3 增量卡片在不同宽度下可用。

## 意义
- 控制台从“被动展示状态”升级到“主动给出风险与动作建议”。
- V3 已具备自动迭代所需的运行态信号基础，可继续向“自动执行策略”扩展。
