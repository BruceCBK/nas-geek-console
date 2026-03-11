# nas-geek-console

OpenClaw 小龙虾控制台（MVP / V3）。

这是一个基于 **Node.js + Express + 原生前端** 的轻量控制台，聚焦 OpenClaw 日常运维与技能管理：

- 服务健康与网关状态总览
- Skills 安装 / 更新 / 卸载 / ZIP 安装
- Skills 实时状态识别（非仅任务历史）
- 内容工作台（推荐、收藏、选题）
- Memory 文件工作流（读写、压缩、提取、重命名）

## 近期更新（2026-03-11）

### 1) Skills 状态识别升级（重点）
- 修复了 Skills 中心普遍显示 `unknown` 的问题。
- 状态计算由“仅任务记录”升级为“**任务记录 + OpenClaw 实时技能可用性**”（`openclaw skills list --json`）。
- 支持 slug 与 canonical name 归一匹配（例如 `tavily-search -> tavily`、`self-improving-agent -> self-improvement`）。
- 对缺失依赖给出可读原因（如：`缺少命令: gh`）。

### 2) Dashboard Skills 预览同步
- 总览面板中的 `skillSummary` 改为与 Skills 中心一致的实时逻辑，避免两处统计不一致。

### 3) GitHub Skill 可用性修复
- 增加命令执行 PATH 兜底（`~/.local/bin` + `~/.npm-global/bin`）。
- 已安装 `gh` CLI（v2.88.0），`github` skill 状态恢复为 `ok`。

### 4) UI/视觉优化
- Skills 官网搜索链接高对比样式（修复“链接看不清”问题）。
- 新增炫酷 favicon：`public/favicon.svg`。

### 5) Gateway 状态与运行时长修复
- 修复 Gateway 状态误判：当 `RPC probe: ok` 且端口监听正常时，优先判定为在线，避免被非致命 warning 文本误标为异常。
- 修复 OpenClaw 运行时长始终“不足1分钟”问题：增加对 systemd 时间戳 `... CST`（中国时区）兼容解析。
- 当前服务运行时长可正确显示为真实值（如 `6小时5分钟`），并在总览与会话摘要中保持一致。

## 本地开发

```bash
npm install
npm run dev
# or
npm start
```

默认端口：`3900`

## 质量检查

```bash
npm run check:ui
npm run smoke
npm run check:memory
npm run verify
```

## Security Guardrails

```bash
npm run hooks:install        # install pre-commit secret scan hook
npm run check:secrets        # full tracked-files scan
npm run check:secrets:staged # staged-files scan
```

See [SECURITY.md](./SECURITY.md) for reporting and secret-handling policy.

## 目录结构

```text
src/                 后端路由与服务
public/              前端静态资源
scripts/             校验与回归脚本
docs/                迭代文档
data/                运行时数据（默认不入库）
```

## 备注

- 本项目面向 OpenClaw 运行环境，部分路径（如 OpenClaw/ClawHub 命令）默认按本机部署配置。
- 若在其他机器部署，请按实际环境调整 `src/config/paths.js`。
