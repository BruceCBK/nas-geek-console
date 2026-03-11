# Step 7 - Gateway 状态判定与服务运行时长修复

更新时间：2026-03-11 (Asia/Shanghai)

## 问题背景

用户反馈两类显示异常：

1. **Gateway 状态**在网站上显示“异常”，但 OpenClaw 实际在线。
2. **OpenClaw 服务运行时间**每次登录都显示“不足1分钟”。

## 根因分析

### A. Gateway 状态误判
- 旧逻辑在 `inferGatewayStateFromText` 中只要匹配到 `error/failed` 文本就容易判为异常。
- `openclaw gateway status` 输出里包含一些非致命警告（如 systemd user unavailable），同时也有：
  - `RPC probe: ok`
  - `Listening: *:18789`
- 由于关键词冲突，出现“实际在线但界面显示异常”。

### B. 运行时长计算错误
- systemd 返回时间戳如：`Wed 2026-03-11 11:45:51 CST`。
- JS 默认将 `CST` 解释为 `UTC-6`（美国中部），而非中国标准时间 `UTC+8`。
- 结果是时间被解析到“未来”，运行时长被压成 0，最终显示为“不足1分钟”。

## 修复方案

文件：`src/services/openclaw-service.js`

### 1) 网关状态推断增强
- 调整状态优先级：
  1. `RPC probe: ok` 或监听正常 → `running`
  2. probe 失败或硬故障（panic/crash/fatal）→ `error`
  3. 其余再走 starting/stopped/unknown
- 避免仅凭泛化 `error` 文本触发误报。
- 增强 endpoint/port 提取规则。

### 2) 时间戳解析兼容
- `parseIsoTimestamp` 增加中国环境下的 `CST` 兜底解析：按 `Asia/Shanghai (+08:00)` 处理。
- 保留“未来时间漂移”保护逻辑，防止异常时间污染。

## 验证结果

- `/api/dashboard/summary`
  - `statusSummary`: `OpenClaw 运行中 · Gateway 在线`
- `/api/openclaw/service/status`
  - `runtimeSec`: 非 0（示例：`21910`）
  - `runtimeText`: 正确显示（示例：`6小时5分钟`）
- 总览与“会话与运行摘要”中的服务运行时间保持一致。
- 回归：`npm run verify` 全通过。

