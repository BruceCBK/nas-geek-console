# Step 8 - 档位2：龙虾小队（多智能体角色 + 评分任务系统）

更新时间：2026-03-11 (Asia/Shanghai)

## 目标
按“队长调度 + 5个专项角色”落地档位2，提供可视化状态反馈和持续质量评分机制。

## 已落地能力

### 1) 五个专项角色（初始评分 100）
- 霓虹侦察虾（Neon Scout）— 情报检索/交叉验证
- 铁钳代码虾（Code Claw）— 功能开发/修复/重构
- 雷达测试虾（Radar QA）— 回归测试/边界校验
- 黑潮运维虾（Ops Tide）— 巡检/诊断/稳定性
- 脉冲文档虾（Doc Pulse）— 文档沉淀/变更追踪

### 2) 多智能体任务系统
新增 API：
- `GET /api/squad/state`：角色状态、任务列表、预警与汇总
- `POST /api/squad/task`：创建任务（派发角色、权重）
- `POST /api/squad/task/:id/review`：提交评分（你 + 队长双评）
- `POST /api/squad/role/:id/reflection`：提交低分自省

评分机制：
- 以 100 为初始分
- 根据完成度/质量分 + 双评（owner/captain）+ 任务权重计算增减分
- `< 60` 自动触发预警状态（warning）并要求自省

### 3) 控制台可视化
- 新增导航页：`龙虾小队`
- 新增模块：
  - 角色状态看板
  - 积分排行榜
  - 任务大厅
  - 派发任务、任务评分、自省提交
- 总览面板 Skills 卡片补充小队快照：
  - 小队均分
  - 低分预警数

## 数据持久化
- `data/squad-roles.json`
- `data/squad-tasks.json`

## 自测
- 接口链路自测：创建任务 -> 评分 -> 自省 -> 状态回读（通过）
- `npm run verify` 全通过：
  - `check:ui` ✅
  - `smoke` ✅
  - `check:memory` ✅

