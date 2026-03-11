# Step 3 - 龙虾监控模块集成记录

更新时间：2026-03-10 23:50 (Asia/Shanghai)

## 目标
将 claw-control 风格中的「监控信息结构」映射到 nas-geek-console Dashboard，形成可读的监控矩阵：
- Gateway 状态
- 会话/任务概览
- 最近日志

## 后端改动
文件：`src/routes/dashboard.js`

- 新增 `monitorMatrix` 响应字段：
  - `gateway`: `unit / activeState / subState`
  - `sessions`: `active`（当前在线会话数）
  - `tasks`: `pending/running/success/failed/unknown` 汇总
  - `recentLogs`: 最近日志（最多 8 条）
- 兼容性：保留原有字段，同时在 `legacy` 中同步返回。

## 前端改动
文件：`public/index.html`, `public/app.js`

Dashboard 新增监控卡片：
- `gatewaySummaryCard`
- `runtimeSummaryCard`
- `dashboardRecentLogs`

渲染逻辑：
- `renderDashboardMonitor` 读取 `payload.monitorMatrix`
- 新增 `normalizeDashboardLogs` 将日志结构适配到统一列表渲染器

## 核心收益
- Dashboard 从“状态展示”升级为“监控矩阵”：可同时看到服务状态、会话活跃度、任务负载、日志动态。
- 保持现有静态 SPA 架构，不引入额外前端框架。
