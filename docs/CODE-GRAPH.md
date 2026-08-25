# NEXUS 代码图谱（CODE GRAPH）

> 生成时间：全面静态分析（本人逐文件通读 91 个源文件 + 多轮静态分析交叉验证）。
> 覆盖：src/（130 文件）、mini-services/nexus-stream、scripts、tests、prisma、配置。总源码约 1.34 万行。
> 本文档 = 架构地图 + 模块/文件/函数清单 + 调用关系 + 数据流 + Socket 协议 + 已知问题索引。

---

## 1. 系统架构总览

```
┌────────────────────────────────────────────────────────────────┐
│ 浏览器（Next.js App，port 3000，Next 16 standalone）            │
│  src/app/layout.tsx + page.tsx → AppFrame                       │
│  ├─ NexusSidebar（会话/群聊/技能/团队/记忆/MCP 导航）            │
│  ├─ NexusConversation（Header + 视图 Tabs + Composer）          │
│  │   ├─ ChatView / GraphView / TimelineView（三视图）           │
│  │   └─ SessionMetaBar（goal/plan 元数据栏）                    │
│  ├─ NexusDetails（右侧详情抽屉：节点/决策/事件日志）             │
│  └─ CommandPalette（⌘K） + SnapshotDialog + SettingsDialog      │
│  状态：useNexus（zustand 全局 store）                            │
│  实时：useNexusSocket（socket.io-client，连接 :3003）            │
└───────────────┬────────────────────────────────────────────────┘
                │ fetch /api/*（经 proxy.ts：Origin/令牌/IP限流）
                │ Socket.IO（:3003，事件流）
┌───────────────▼────────────────────────────────────────────────┐
│ src/proxy.ts（中间件，matcher=/api/:path*）                     │
│  限流 300/min/IP → Origin 校验 → NEXUS_ACCESS_TOKEN 校验        │
├────────────────────────────────────────────────────────────────┤
│ src/app/api/*（26 个 route.ts，REST 端点，见 §5）               │
├────────────────────────────────────────────────────────────────┤
│ src/lib/nexus/*（核心引擎，纯服务端/纯函数，见 §3）              │
│  agent.ts（runTurn 循环/上下文构建/自动压缩/计划生成）           │
│  tools.ts + sandbox.ts（32 个工具 + 风险分级沙箱）               │
│  snapshot.ts（三层快照+双向恢复）、group-chat.ts（群聊引擎）      │
│  memory/skills/team/code-graph/projections/settings/...         │
├────────────────────────────────────────────────────────────────┤
│ mini-services/nexus-stream（独立 Socket.IO 服务，127.0.0.1:3003）│
│  chat:run/stop/plan/compact、group:run/message/stop 事件路由    │
│  运行锁（runningSessions/runningRooms）+ 限流 + 协作式停止       │
├────────────────────────────────────────────────────────────────┤
│ Prisma + SQLite（db/custom.db，11 个模型，见 §6）                │
│ scripts/nexus.mjs（CLI：setup/web/clean/doctor）                │
│ scripts/{copy-standalone,start-standalone}.mjs（生产部署）      │
└────────────────────────────────────────────────────────────────┘
```

**三条数据通路**
1. **REST**：面板/设置/快照/会话 CRUD → /api/* → lib/nexus → Prisma。
2. **Socket 实时流**：聊天/群聊运行 → nexus-stream → runTurn/runGroupChat → 事件（seq:-1 实时 + 落库）→ 前端 applyLiveEvent 增量渲染；完成后再 REST 重载拿到真实 seq。
3. **纯函数投影**：事件流（DB）→ projections.ts 投影为 消息/执行图/标题，服务端与客户端共用。

---

## 2. 目录与文件清单（按职责分组，行数/行）

### 2.1 核心引擎（src/lib/nexus，约 4300 行）
| 文件 | 行 | 职责 | 关键导出 |
|---|---|---|---|
| tools.ts | 904 | 36 个工具定义 + executeTool/executeToolSandboxed + safeEvaluate | TOOLS/TOOL_MAP/executeTool/needsApproval/toolSchemas |
| agent.ts | 601 | 对话主循环 runTurn、上下文构建/自动压缩、计划生成、自动标题 | runTurn/maybeAutoTitle/nextTurn/compactNow/generatePlan |
| sandbox.ts | 490 | 统一沙箱：风险分级/系统保护/SSRF 防护/路径策略 | assessToolCall/resolveSandboxedPath/guardedFetch/blockedUrlReason |
| llm-client.ts | 435 | 三协议流式客户端（chat-completions/anthropic/responses） | streamChat/normalizeProviderUrl |
| snapshot.ts | 460 | 三层快照（DB+事件/决策 blob+文件备份）、加权推荐、双向恢复 | createSnapshot/restoreSnapshot/listSnapshots/recommendSnapshot |
| group-chat.ts | 418 | 群聊房间/消息 CRUD + 两个运行引擎（真人群聊/多轮任务） | handleUserMessage/runGroupChat/runToolLoop |
| settings.ts | 174 | 供应商/模型两级配置、掩码、保存合并 | getSettings/saveSettings/sanitizeSettings |
| team.ts | 156 | 8 个内置团队成员（静态） | TEAM/TEAM_MAP |
| skills.ts | 154 | 8 个预置技能（静态） | SKILLS/SKILL_MAP |
| code-graph.ts | 113 | 工作区扫描、图谱节点 CRUD、上下文注入、被改文件提取 | scanWorkspace/getGraph/upsertNodes/graphToContext |
| projections.ts | 93 | 事件流→消息/图/标题的纯函数投影（客户端安全） | projectMessages/projectGraph/deriveTitle |
| 其余 | ~300 | types/events/memory/tool-parser/constants/model-catalog/provider-utils/client-token/socket-url | — |

### 2.2 API 路由（src/app/api，32 个文件，约 900 行）
sessions（5）/ snapshots（4）/ groups（3）/ custom-skills（2）/ custom-team（2）/ tool-approvals（2）/ memory（2）/ code-graph / llm-probe / optimize-prompt / settings / tools / 根路由。详见 §5。

### 2.3 前端（src/components/nexus + src/hooks/nexus，约 6500 行）
- **hooks**：use-nexus.ts（zustand store，202 行）、use-nexus-socket.ts（111）、use-theme.ts（130，5 套 CSS 变量主题）、use-toast（shadcn）。
- **视图**：chat-view（223）、graph-view（177）、timeline-view（571，时间回溯核心）。
- **面板**：skills-panel（503）、team-panel（444）、memory-panel（383）、group-panel（322）、mcp-panel（305，当前为演示态）。
- **主组件**：sidebar（384）、conversation（314）、details（350）、providers-settings（389）、settings-dialog（239）、markdown（218）、slash-command（210）、model-switcher（199）、snapshot-dialog（170）、prompt-optimizer（170）、session-meta-bar（125）、其余小件。
- **ui/**：50 个 shadcn/ui 组件（标准实现，未定制逻辑）。

### 2.4 基础设施（约 1100 行）
| 文件 | 行 | 职责 |
|---|---|---|
| mini-services/nexus-stream/index.ts | 546 | Socket.IO 服务：连接鉴权/限流/运行锁/chat+group 事件路由 |
| scripts/nexus.mjs | 456 | CLI：setup/web/clean/doctor（含 stream 编译链路） |
| scripts/copy-standalone.mjs | 22 | 复制 static/public 进 standalone |
| scripts/start-standalone.mjs | 59 | 生产双进程启动器 |
| src/proxy.ts | 69 | /api 网关：限流/Origin/令牌 |
| next.config.ts | 9 | standalone 输出、StrictMode 关、dev 源白名单 |

### 2.5 数据与测试
- prisma/schema.prisma：11 模型（见 §6）。
- tests/：5 个 bun 测试（projections/sandbox/tool-parser/tools，共 251 行），全部针对纯函数。

---

## 3. 核心函数调用图谱（跨模块边）

### 3.1 对话主链路
```
socket chat:run ──► nextTurn(sessionId)                    [agent.ts]
               ──► maybeAutoTitle(sessionId,text)         [agent.ts → events.deriveTitle]
               ──► runTurn({sessionId,userText,turn,cb})  [agent.ts]
                     ├─ getSettings() → resolveProvider → activeModelOf  [settings/provider-utils]
                     ├─ buildContextHistory()
                     │    ├─ maybeAutoCompact() → summarizeItems() → llmStreamChat [llm-client]
                     │    └─ buildHistory() → loadEvents [events] + getGraph [code-graph]
                     ├─ llmStreamChat(history, {tools, provider}) [llm-client]
                     ├─ parseTextToolCalls(content) [tool-parser]（文本协议兜底）
                     ├─ db.decision.create（决策审计）
                     ├─ needsApproval → findPriorApproval（审批匹配，stableStringify）
                     ├─ createSnapshot（before_tool 节流 30s）[snapshot]
                     ├─ executeTool(name,args) [tools → sandbox 风险门]
                     └─ upsertNodes/removeNode（写操作后增量维护图谱）[code-graph]
```

### 3.2 群聊链路
```
socket group:message ──► handleUserMessage(roomId,msg,cb)   [group-chat]
      group:run     ──► runGroupChat(roomId,task,rounds,cb) [group-chat]
                          └─ runGroupRound() → runToolLoop()
                               ├─ llmStreamChat（成员级 provider 覆盖）
                               ├─ assessToolCall（系统保护/审批判定）
                               └─ executeTool(approved:true)
```

### 3.3 快照/回溯链路
```
createSnapshot ──► db.snapshot.create + getEvents [events] + db.decision.findMany
              ──► copyProjectFiles（全项目文件备份 + manifest）→ .nexus/snapshots/<id>/files
restoreSnapshot ──► 保护快照 → 事件双向回滚（回插/删除）→ 决策整体替换 → restoreProjectFiles / pruneUntrackedFiles
rewind API ──► createSnapshot(before_rewind) + $transaction(删事件+删决策)
```

### 3.4 前端状态流
```
useNexusSocket: event ──► store.applyLiveEvent ──► projectGraph(events) 重建图 + 消息增量
   chat:done ──► reloadSession() ──► selectSession [app-frame] ──► GET /api/sessions/:id ──► loadSession
Composer ──► send(chat:run) ──► socket ──► chat:started/event*/chat:done
Timeline ──► REST（快照/审批/回溯）＋ openTimelineAt(seq) 切视图
```

### 3.5 工具执行（统一沙箱门）
```
executeToolSandboxed ──► executeTool ──► assessToolCall（风险分级：safe/low/high/system_critical）
   ├─ blockedBySystemGuard ──► 直接 blocked（rm -rf /、格式化、关机等，任意模式）
   ├─ requiresApproval(default 模式 high) ──► approval_required / 审批流
   └─ 放行 ──► tool.handler（read/write/edit/glob/grep/pwsh/web_search/...）
```

---

## 4. 实时事件流（Socket 协议）

**客户端 → 服务端**：chat:run {sessionId,message,turn} / chat:stop / chat:plan / chat:compact / group:run {roomId,task,rounds} / group:message {roomId,message} / group:stop

**服务端 → 客户端**：hello {provider,model} / ping / session:updated / chat:started / chat:done / chat:error / chat:stopped / event {sessionId, event:{seq:-1,type,data,createdAt}} / group:started / group:round_start / round_end / message_start / message_chunk / message_done / group:done / stopped / error

**事件类型（EventType，types.ts）**：session/created、user/message、assistant/message、assistant/chunk、assistant/thinking、assistant/thinking_chunk、tool/call、tool/result、tool/error、tool/approval_request、graph/node_start、graph/node_end、graph/turn_start、graph/turn_end、decision/record、evidence/added（预留，无发射方）、error、session/goal、session/plan、context/compacted。

**seq 语义**：落库事件 seq 从 1 递增（@@unique([sessionId,seq])）；实时推送事件 seq=-1（不落库），chat:done 后前端 REST 重载补齐真实 seq。

---

## 5. API 端点清单（26 个）

| 端点 | 方法 | 职责 |
|---|---|---|
| /api/sessions | GET/POST | 会话列表（含 lastMessage/messageCount 聚合）/ 新建 |
| /api/sessions/:id | GET/PATCH/DELETE | 全量会话（事件+消息+图+决策）/ 改标题/置顶/标签 / 删除（含快照清理） |
| /api/sessions/:id/events | GET | 事件流 |
| /api/sessions/:id/decisions | GET | 决策审计 |
| /api/sessions/:id/meta | POST | 设置/清除 goal 或 plan |
| /api/sessions/:id/rewind | POST | 时间回溯（保护快照 + 事务删事件/决策） |
| /api/snapshots | GET/POST | 列表（含 restorable 健康标记+推荐点）/ 创建 |
| /api/snapshots/:id | DELETE | 删除（含文件备份） |
| /api/snapshots/:id/restore | POST | 恢复（可 pruneFiles） |
| /api/groups | GET/POST | 群聊房间列表/创建 |
| /api/groups/:id | GET/PATCH/DELETE | 房间详情/更新/删除 |
| /api/groups/:id/messages | GET/POST | 消息列表/追加 |
| /api/memory | GET/POST | 记忆列表/保存 |
| /api/search | GET | 全局消息全文搜索 |
| /api/sessions/import | POST | 会话导入（重建事件+决策） |
| /api/sessions/:id/context | GET | 上下文用量估算 |
| /api/sessions/:id/export | GET | 会话导出（JSON） |
| /api/snapshots/:id/files | GET | 快照文件清单 |
| /api/snapshots/:id/file | POST | 单文件恢复 |
| /api/memory/:id | PATCH/DELETE | 置顶/删除 |
| /api/custom-skills | GET/POST | 技能列表（内置+自定义合并）/ 创建 |
| /api/custom-skills/:id | PATCH/DELETE | 更新/删除 |
| /api/custom-team | GET/POST | 团队列表（内置+自定义）/ 创建 |
| /api/custom-team/:id | DELETE | 删除自定义成员 |
| /api/tool-approvals | GET | 审批列表（status/sessionId 过滤） |
| /api/tool-approvals/:id | PATCH | 审批（pending→approved/rejected，单向） |
| /api/code-graph | GET/POST/PATCH | 图谱查询/工作区扫描/节点批量写入 |
| /api/llm-probe | POST | 模型拉取（live→catalog 回退）/ 真实对话测试（SSRF 防护） |
| /api/optimize-prompt | POST | 提示词三版本改写 |
| /api/settings | GET/PATCH | 设置读取（脱敏）/ 保存（Key 保留逻辑） |
| /api/tools | GET | 工具 schema 清单 |

---

## 6. 数据模型（Prisma/SQLite，11 表）

Session（标题/置顶/标签/时间）→ SessionEvent（会话事件流，seq 唯一）、Decision（决策审计）、CodeGraphNode（复合主键 [sessionId,id]，图谱）
Memory（namespace+key 唯一，置顶）、Setting（KV）、GroupRoom（members/task 为 JSON blob）→ GroupMessage（**无外键**，见问题 P9）
CustomSkill（用户技能）、ToolApproval（id 手动生成，见问题 P10）、Snapshot（事件/决策 blob + 文件备份路径）

---

## 7. 已识别问题索引（完整明细见 docs/CHANGES.md 与本次改动日志）

### 7.1 高优先级（本次已修复，见 docs/CHANGES.md）
- P1 settings.ts：saveSettings 可能静默清空 API Key（normalizeProvider 缺 id 时生成新随机 id → 旧记录匹配失败）。
- P2 group-chat.ts：runGroupChat 成功后 finally 把 status 从 done 复位为 idle，房间永远不显示"完成"。
- P3 snapshot.ts：单条决策坏 JSON 导致整个快照事件/决策捕获静默失败；恢复丢失 hasToolCalls/createdAt。
- P4 snapshot.ts：恢复事件 createMany 与并发写入存在唯一约束竞态（无事务）。
- P5 nexus-stream：group:run/chat:plan/chat:compact/group:message 空载荷解构抛 TypeError → unhandledRejection → Node≥15 直跑产物时进程崩溃（本地 DoS）。
- P6 nexus-stream：stopFlags 单 Map 被 sessionId 与 roomId 共用，同字符串时互相覆盖。
- P7 group-chat.ts：工具轮次耗尽把工具 JSON 当最终回复；cacheKey 全房间共享。
- P8 code-graph.ts：extractTouchedPaths 以 process.cwd() 而非 workspaceRoot 解析（B24）。
- P9 schema：GroupMessage 无外键、重复索引、ToolApproval.id 无默认值（B34-B36）。
- P10 projections：turn_end 不清理 running 节点；durationMs 可能 NaN（B12/B27）。

### 7.2 中优先级（本次已修复/缓解）
- 限流：chat:plan/compact 绕过限流；rateMap 无回收（内存泄漏）；proxy XFF 伪造（B18/B19/B4/B3）。
- CLI：web() 自动 setup 缺 buildStream（无 bun 时聊天静默不可用）；startChild 无 exit 感知；tsconfig.stream.json 残留；copy-standalone import.meta.dirname 兼容性。
- 群聊：房间状态并发竞争（B15）；审批拒绝逻辑与 executeTool 双路径（B16）；runGroupRound 系统提示缺工具协议（B17）。
- settings：getSettings 返回共享 DEFAULT_SETTINGS（B29）；isMaskedApiKey includes("****") 误判（B30）。

### 7.3 功能缺口（本次已实现/推进）
- G1 **Agent 记忆工具**：memory_save/memory_recall 已注册进工具集（此前 MemoryPanel/API 存在但 Agent 无法使用），并把置顶记忆注入系统上下文。
- G2 **http_request / calculator / current_time / echo**：注册进工具集（沙箱早已有 SSRF/风险规则，工具缺失）。
- G3 **审批后自动继续**：新增 chat:rerun，批准工具后客户端一键/自动续跑上一条消息。
- G4 MCP 面板：当前为演示态（未真正启动 MCP 进程），文档已注明（后续可接 @modelcontextprotocol/sdk）。

### 7.4 遗留建议（未实施，文档记录于 docs/CHANGES.md 末尾）
- 会话级访问控制（事件流订阅授权）、断线恢复订阅接口、run 超时强制释放、群聊消息分页、记忆语义检索、API Key 加密存储、快照差异预览/单文件恢复、stream 集成测试。
