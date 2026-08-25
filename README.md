# NEXUS

> 图驱动 · 智能嵌入 · 本地优先 —— 对话、工具调用、群聊、技能、团队、记忆、时间回溯。
图驱动 AI Agent：对话、工具调用、群聊、技能、团队、记忆、时间回溯。

## 一键安装（推荐）

**Windows：运行 nexus.cmd**

**Linux/macOS：**

```bash
chmod +x install-linux.sh
./install-linux.sh
```

安装脚本会自动完成：装依赖 → 初始化数据库 → 编译流式服务 → 创建 `start-nexus.bat`（或 `start-nexus.sh`）。
完成后可选择立即启动。

## 日常使用

- **运行 nexus.cmd**（Linux/macOS 运行 `./start-nexus.sh`）→ 就绪后自动打开浏览器 `http://localhost:3000`
- 或在命令行运行 `nexus web`

首次打开页面后，到 **设置 → 添加供应商** 填入你的 AI API Key 即可开始使用。

## 常用命令

| 命令 | 说明 |
|---|---|
| `nexus setup` | 安装依赖 + 初始化数据库 + 编译流式服务 |
| `nexus web` | 一键启动 Web(3000) + Stream(3003)，自动开浏览器 |
| `nexus doctor` | 环境检查 |
| `nexus clean` | 清理 node_modules / .next 释放空间 |

## 目录

- `src/app/api` — API 路由
- `src/lib/nexus` — Agent、工具、群聊、快照等核心逻辑
- `mini-services/nexus-stream` — Socket.IO 流式服务（`dist/` 为编译产物）
- `scripts/nexus.mjs` — NEXUS CLI
- `tests` — 单元测试
- `docs/CODE-GRAPH.md` — 代码图谱（架构/模块/调用关系/数据流/协议）
- `docs/CHANGES.md` — 改造记录（bug 修复 / 功能添加 / 验证结果）

## 项目亮点

- 🗺️ **图驱动**：执行图实时可视化（LLM 决策节点 + 工具调用 + 耗时统计）；代码图谱自动分析项目结构并注入上下文，Agent 改代码前就懂影响面；一键智能整理（仅移动/改名，绝不删除）。
- 🔧 **36 个内置工具**：read/write/edit/patch/glob/grep/pwsh/web_search、本地子代理 delegate、网页阅读、测试验证、记忆与 HTTP 请求，全部经统一沙箱风险分级。
- 🧠 **记忆会学习**：自动提炼事实与偏好（手动 / 自动 / 偏好三路），注入上下文并最高优先级遵守——越用越懂你。
- ⏪ **快照时间回溯**：事件 + 决策 + 项目文件三层快照，支持整包回滚与**单文件恢复**，恢复前自动保护。
- 📊 **上下文管理**：实时占用率徽标，达到阈值一键压缩，token 用量逐决策可见。
- 🔒 **安全**：沙箱系统保护层（系统破坏性操作永拒）+ SSRF 防护 + 高风险工具审批流 + 安全响应头 + 可选访问令牌。
- ⚡ **轻量部署**：Next.js + SQLite + Socket.IO，nexus web 一条命令启动；纯净源码仅 1.2MB。
## Agent 能力

- **工具系统**：read/write/edit/patch/glob/grep/pwsh/web_search/delegate 等 36 个工具，统一沙箱风险分级 + 系统保护 + SSRF 防护。
- **长期记忆**：`memory_save` / `memory_recall`，记忆面板可见可管，置顶记忆自动注入上下文。
- **HTTP 请求**：`http_request` 内置 SSRF 防护（GET/HEAD 免审批，写方法需审批）。
- **安全模式**：默认模式高风险操作先拦截要求审批；无限制模式放开常规审批，系统破坏性操作始终拦截。
- **审批自动续跑**：时间轴批准工具后自动重放上一条消息继续执行。
- **时间回溯**：事件级 rewind + 三层快照（事件/决策/项目文件），双向恢复，恢复前自动保护快照。
- **上下文管理**：按模型窗口自动压缩（保留目标/计划/最新内容），手动 `/compact`；`/goal` 设置总目标，`/plan` 生成执行计划。
- **群聊**：多 Agent 群聊协作（真人群聊式回应 + 多轮任务讨论 + 自动总结），任务/闲聊自动分流。

## 环境变量

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | SQLite 数据库地址（`nexus setup` 自动生成绝对路径） |
| `NEXUS_ACCESS_TOKEN` | 设置后所有 API 与 Socket 必须携带令牌（公网部署必设） |
| `NEXT_PUBLIC_NEXUS_ACCESS_TOKEN` | 前端自动附加 `x-nexus-token` 头 |
| `NEXUS_WORKSPACE` | 工作区根目录（工具相对路径的解析基准，默认项目根） |
| `PORT` / `HOSTNAME` | 生产 standalone 的监听端口/地址（默认 3000 / 0.0.0.0） |
| `NEXUS_BIND` | stream 服务监听地址（默认 127.0.0.1 仅本机；局域网访问设 0.0.0.0，需配合访问令牌） |

## 安全说明

- 默认适合**本机/内网**使用；公网部署请务必设置 `NEXUS_ACCESS_TOKEN` 与 `NEXT_PUBLIC_NEXUS_ACCESS_TOKEN`，否则所有 API 与 Socket 均可匿名访问。
- 所有工具统一经过沙箱：默认（安全）模式下工作区外写入需要审批；删除系统目录、格式化、关机等系统破坏性操作始终被底层拦截。
- `.env` 与数据库文件不应提交到 Git（已在 .gitignore 排除）；快照备份已排除 `.env` 与数据库文件。
- API 已内置轻量内存限流（默认 300 次/分钟/IP），防止接口被刷。
## 致谢与反馈

本人独立开发，水平有限，代码中难免有疏漏与不完善之处。恳请各位大佬批评指正：

- 🐛 发现 Bug、性能问题或安全隐患，欢迎提 Issue（描述越具体越好：复现步骤、报错信息、环境）。
- 💡 有好的功能建议或架构改进思路，同样欢迎讨论。
- 🤝 想一起完善这个项目，欢迎提交 PR。

每条反馈我都会认真看、认真改。感谢你的时间与耐心 🙏
