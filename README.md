# nas-geek-console

OpenClaw 小龙虾控制台（NAS Geek Console）是一个面向 **OpenClaw 日常运维 + 多角色任务协作** 的本地控制台。

它的目标不是“做一个页面”，而是把这三件事打通：

1. **看得见**：服务状态、网关状态、任务执行、协作链路都可视化。
2. **管得住**：技能安装/更新、任务派发、记忆同步、异常重试都可操作。
3. **可追踪**：每条任务来源、协作角色、进展心跳、最终汇报都可追溯。

---

## 项目定位

适用于以下场景：

- 在 NAS / 家庭服务器 / 轻量主机上运行 OpenClaw
- 需要一个统一入口管理 Skills、内容工作流、记忆文件
- 希望把“用户指令任务”交给多角色 AI 团队协作执行，并把执行过程透明化

---

## 核心能力

### 1) Dashboard（运行态总览）

- OpenClaw 服务状态与网关状态识别
- 运行时长、近期日志、近期任务快照
- 融合信号（风险告警 + 建议动作）

### 2) Skills 中心

- 技能搜索、安装、更新、卸载
- ZIP 包安装
- 任务状态 + 运行态可用性融合判断（避免“假在线”）

### 3) 龙虾小队（多角色协作）

- 任务自动路由到最合适角色
- 每个用户任务默认 2~3 角色并行协作（性能受限场景优化）
- 协作链路门禁：**侦察 -> 实现 -> 验证/文档** 未完成，不允许产出最终汇报
- AI agent 不可用时最终汇报自动重试（最多 3 次），失败日志可追踪
- 任务大厅展示：来源、衍生关系、协作编队、进展心跳、最终汇报状态

### 4) 记忆工作流

- Memory 文件读写、压缩、提取、重命名
- 播报结果可同步到 memory 日志
- blocked 任务可自动归档复盘

### 5) 内容工作台

- 推荐内容查看
- 收藏与选题管理
- 内容状态面板

---

## 协作任务执行模型（重点）

每条用户任务都遵循以下执行规则：

1. 进入小队任务系统并分配主角色
2. 自动拉起协作角色（并行规模 2~3）
3. 持续心跳更新进展（任务大厅可见）
4. 完成评分与阶段闭环
5. 仅当协作链路完整时生成最终汇报

这保证了“有结果”之外，还能保证“结果可解释、过程可审计”。

---

## 技术栈与目录

- Backend: Node.js 22 + Express
- Frontend: 原生 HTML/CSS/JS
- Data: JSON 文件存储（适配轻量部署）

```text
src/                 后端路由与服务
public/              前端静态资源
scripts/             校验/回归/运维脚本
docs/                设计与迭代文档
data/                运行时任务与日志数据
memory/              记忆同步配置与产物
config/              配置文件
```

---

## 快速开始

```bash
npm install
npm run dev
# 或
npm start
```

默认监听：`3900`

---

## 常用命令

```bash
npm run verify          # UI + smoke + memory 全量回归
npm run smoke           # 关键 API 烟测
npm run check:ui        # 前端契约检查
npm run check:memory    # memory 工作流检查
npm run push:fallback   # push 失败时自动切换 ssh:443 重试
```

---

## 关键 API（节选）

- `GET /api/dashboard/summary`：控制台总览
- `GET /api/squad/state`：龙虾小队状态与任务大厅
- `POST /api/squad/task`：创建任务
- `POST /api/squad/task/:id/heartbeat`：进展心跳
- `POST /api/squad/task/:id/review`：任务评分
- `POST /api/squad/task/:id/final-report/retry`：重试最终汇报
- `POST /api/squad/reporting/sync-memory`：同步播报到记忆

---

## 运维说明

- 推荐把仓库操作优先走 SSH（支持 `ssh.github.com:443`）
- 若 HTTPS push 间歇失败，可直接使用 `npm run push:fallback`
- 本项目默认以本地文件持久化，部署时请做好目录备份（`data/`, `memory/`）

---

## 安全

- pre-commit 已集成 secret scan
- 安全策略见：`SECURITY.md`

---

## License

内部项目（按团队约定使用）。
