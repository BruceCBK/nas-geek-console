# OpenclawVue / claw-control 基线分析（Step 1）

更新时间：2026-03-10 23:29 (Asia/Shanghai)

## 1. 拉取结果

- `reference/OpenclawVue`：`git pull --ff-only` 成功，已是最新。
- `reference/claw-control`：远端拉取失败（TLS 连接中断），基于本地已有代码继续分析。

## 2. 参考项目风格提取

### OpenclawVue（视觉方向）
- 强调「品牌化首页 + 渐变背景 + 卡片化信息」
- 顶部导航 + 主内容区，交互偏宣传/门户型
- 现有实现主要集中在 `src/App.vue` 单体页面

### claw-control（控制台方向）
- 技术栈：Next.js + Tailwind + shadcn/ui
- 特征：
  - 语义化信息架构（Agents / Platform / Settings / Resources）
  - 稳定侧栏 + 内容分页
  - UI token 统一（`src/app/globals.css`）
  - 组件化程度高，适合管理后台

## 3. nas-geek-console 当前状态

- 架构：Express + 静态 SPA（`public/index.html` + `public/app.js` + `public/styles.css`）
- 当前 UI 为浅绿色拟物卡片风，存在能力较多但信息层级偏平
- 功能覆盖：健康状态、skills、memory、content、task/log 等

## 4. 重构映射策略（用于 Step 2/3）

1) **布局层**（Step 2）
- 侧栏按 claw-control 分组重排：
  - 控制台（总览/服务）
  - 运营（任务/日志）
  - 能力（Skills/Memory/Content）
- 头部统一为「标题 + 状态胶囊 + 主操作」

2) **视觉层**（Step 2）
- 保留现有纯静态 SPA，不引入 React/Next
- 引入 design tokens（背景、前景、卡片、边框、强调色、半径、阴影）
- 兼容深色模式（先支持 token，后接入切换）

3) **监控模块集成层**（Step 3）
- 抽取 claw-control 的监控信息结构：
  - gateway 状态
  - 会话/任务概览
  - 最近日志
- 在 dashboard 区新增「龙虾监控矩阵」卡片组

4) **功能裁剪层**（Step 4）
- 暂停对核心目标无关的高噪音区块（保留数据接口，不删服务）
- 仅保留：总览、任务日志、skills、memory、content

5) **验证层**（Step 5）
- 继续使用 `npm run check:ui` + `npm run smoke`
- 手工回归登录、总览刷新、任务筛选、skills/memory/content 基础链路

## 5. 风险与缓解

- 风险：claw-control 远端暂未同步到最新
- 缓解：
  - 先按本地参考实现布局规范
  - 后续网络恢复后补一次 `git pull`，若有差异再做增量对齐

