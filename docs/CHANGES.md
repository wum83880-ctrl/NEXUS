# NEXUS 改造记录（CHANGES）

> 本轮全面分析 + 修复 + 优化 + 功能添加的完整清单。每个条目标注：位置 / 问题 / 修复方式 / 验证。
> 图谱与架构总览见 [CODE-GRAPH.md](./CODE-GRAPH.md)。

---

## 一、Bug 修复（按模块）

### 1. 设置与供应商（src/lib/nexus/settings.ts）
- **[高] API Key 静默清空**：`saveSettings` 对前端提交的 provider 先 `normalizeProvider`，缺 id 时每次生成随机 id → 与旧记录匹配失败 → 掩码/空 Key 覆盖旧 Key。修复：id 缺失时按 `name + apiBaseUrl` 回退匹配，并透传旧 id。
- **[中] isMaskedApiKey 误判**：`includes("****")` 会把真实 key 里的字面星号误判为掩码。改为正则精确匹配掩码格式（前3位+4星+后4位）。
- **[中] getSettings 返回共享对象**：无配置时返回 `DEFAULT_SETTINGS` 引用，调用方 mutate 会污染全局默认值。改为 `structuredClone`。
- **[低] 可选字段 truthy 判断**：`thinkingLevel:""`/`stop:""` 显式清空被丢弃。统一改为 `!== undefined`。

### 2. 群聊引擎（src/lib/nexus/group-chat.ts）
- **[高] 房间永远不显示"完成"**：`runGroupChat` 成功后置 `done`，finally 又无条件复位 `idle`。修复：成功标志位 `finished`，仅在未完成时兜底复位。
- **[中] 工具轮次耗尽返回裸 JSON**：最后输出工具 JSON 时原样落库。修复：循环退出后若检测到工具调用，追加"收尾"调用要求直接给结论（不带 tools）。
- **[中] cacheKey 全房间共享**：不同成员/轮次可能互相串前缀缓存。修复：cacheKey 加入 `:memberId:round`（总结用 `:summary`）。
- **[中] 坏 JSON 崩列表**：`listRooms/getRoom` 直接 `JSON.parse(members)`，脏数据整体抛错。修复：`parseMembers` 容错，坏成员置空数组。
- **[中] 任务/闲聊分流实现**：此前 `isTask` 死变量（计算后从未使用）。修复：任务类消息注入完整工具协议；闲聊走轻量提示，省 token、回复更自然。
- **[低] runGroupRound 系统提示缺工具协议**：补上工具 JSON 协议与可用工具清单。

### 3. 快照与回溯（src/lib/nexus/snapshot.ts）
- **[高] 单条决策坏 JSON 使整个快照捕获失败**：`JSON.parse(d.toolCalls)` 抛错被外层 catch 吞掉，事件+决策全部缺失但 DB 行照常创建。修复：逐条容错解析，坏字段置空数组。
- **[中] 恢复丢失决策元数据**：blob 未保存 `hasToolCalls` 与 `createdAt`，恢复后恒 false / 时间全变成恢复时刻。修复：blob 增加两字段并透传。
- **[中] 恢复事件无事务**：并发写入撞 `@@unique([sessionId,seq])` 时部分回滚。修复：事件+决策回滚/回补包进 `$transaction`。
- **[低] 旧格式快照诚实反馈**：无事件游标时明确提示"事件未回滚（仅文件已恢复）"。

### 4. 代码图谱（src/lib/nexus/code-graph.ts）
- **[中] extractTouchedPaths 基准错误**：以 `process.cwd()` 解析相对路径，与 executeTool 的 workspaceRoot 不一致时误判。修复：以 `workspaceRoot()` 为基准；pwsh 命令正则避免误匹配 `=>`/`->`。

### 5. 事件投影（src/lib/nexus/projections.ts）
- **[中] 执行图节点永久卡"运行中"**：turn_end 只置 finalize。修复：turn_end 时把该轮剩余 running 节点统一置 done（缺 node_end 事件的兜底）。
- **[低] durationMs 可能为 NaN**：`startedAt` 缺失时。加 `Number.isFinite` 守卫。
- **[低] deriveTitle 劈开代理对**：emoji/生僻字在 42 边界被劈开。改用码点级截断（`Array.from`）。

### 6. 流式服务（mini-services/nexus-stream/index.ts）
- **[高] 空载荷崩溃（本地 DoS）**：`group:run`/`chat:plan`/`chat:compact`/`group:message` 对 undefined/null 解构抛 TypeError → unhandledRejection → Node>=15 直跑产物时**整个 stream 进程崩溃**。修复：所有 handler 首行判空；chat:stop/group:stop 同步 handler 同样加固。
- **[中] stopFlags 冲突**：sessionId 与 roomId 共用单 Map，同字符串互相覆盖。拆分为 `stopFlagsBySession` / `stopFlagsByRoom`。
- **[中] 限流内存泄漏**：socket.id 键永久驻留。disconnect 时删除对应限流桶。
- **[中] chat:plan/compact 绕过限流**：补限流（独立键）。
- **[中] 编译产物路径推导错层**：dist 产物多一层目录导致 .env/DB 定位失败。argv[1] 含 /dist/ 时上推三级。
- **[低] .env 解析器缺陷**：支持 `export KEY=` 前缀与行内注释剥离。

### 7. CLI（scripts/nexus.mjs）
- **[中] web() 自动 setup 缺 stream 编译**：无 bun 时聊天静默不可用。修复：自动 setup 路径补 `buildStream()`。
- **[中] 子进程崩溃无感知**：startChild 增加 exit 监听，崩溃时打印并触发 shutdown（带防重入标志）。
- **[中] tsconfig.stream.json 残留项目根**：改写到系统临时目录（include 路径转绝对）。
- **[低] doctor 遍历崩溃**：readdirSync 补 try/catch。

### 8. 部署脚本与网关
- scripts/copy-standalone.mjs：`import.meta.dirname` → `fileURLToPath`（兼容 Node < 20.11）。
- src/proxy.ts：**[中] XFF 首段可伪造绕过限流** → 优先 `x-real-ip`（可信反代设置），XFF 仅作最后回退；**[低] 限流先于鉴权** → 鉴权失败直接 401 不消耗配额。

### 9. 数据模型（prisma/schema.prisma）
- 删除 SessionEvent 冗余重复索引（`@@unique([sessionId,seq])` 自带索引）。
- ToolApproval.id 增加 `@default(cuid())`（此前创建方必须手传 id）。
- 已执行 `prisma db push --accept-data-loss` 同步并重新生成 Client。

---

## 二、功能添加

### F1. Agent 记忆工具（打通"记忆面板 ↔ Agent"）
此前 MemoryPanel 与 /api/memory 已存在，但 Agent **没有可用的记忆工具**（沙箱规则早已就绪，工具未注册）。新增并注册：
- `memory_save`（命名空间 KV 保存，pinned 置顶）
- `memory_recall`（按命名空间/可选 key 回忆，置顶优先，最多 50 条）
- 实现用动态 import db，不污染 tools.ts 的静态模块图（测试可正常加载）。
- **记忆注入上下文**：`buildHistory` 把默认命名空间记忆（置顶优先，前 10 条）注入系统提示，Agent 开箱即用记住用户事实/偏好。

### F2. 通用工具补齐
- `http_request`（GET/HEAD 只读低风险；POST/PUT/DELETE 需审批；走 `guardedFetch`，SSRF 防护拦截本地/内网/云元数据/重定向；输出截断 12K）
- `calculator`（复用 safeEvaluate 安全求值器）
- `current_time`、`echo`
- 同步更新：PERSONA 工具清单、群聊系统提示、设置面板 ALL_TOOLS。

### F3. 审批后自动继续执行（chat:rerun）
- 新 ClientMessage `chat:rerun` + socket handler：取事件流最近一条用户消息重放 `runTurn`（复用运行锁/限流/停止标志）。
- 时间轴"待审批工具"批准成功后自动发送 rerun——已批准的相同调用由 `findPriorApproval` 直接放行，不再重复弹审批。
- 审批提示文案同步更新为"批准后自动继续执行"。

### F4. 健壮性回归
- 新增 tests/tools-registry.test.ts：工具注册完整性、schema 形状、新工具风险分级、SSRF 拦截、turn_end 兜底、码点级标题截断。

---

## 三、验证结果

| 项目 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ 0 错误 |
| `bun test`（5 文件 37 用例） | ✅ 37 pass / 0 fail |
| `nexus setup`（stream 编译） | ✅ 编译 + 别名改写 14 处 |
| `prisma db push` | ✅ schema 同步 + Client 重新生成 |
| `next build` | 见构建日志 |

---

---

## 二·第二轮：编程能力补强（新增）

### 编程工具（工具集 38 → 41）
- **`run_tests`**：项目验证白名单（test / typecheck / build），自动探测 bun/npm，输出结构化判定（通过/失败 + 尾部日志）。修改代码后验证闭环的核心工具；沙箱按 safe 处理（仅白名单命令，杜绝任意命令执行）。
- **`workspace_info`**：概览项目结构（package.json 脚本/依赖、顶层目录/文件、关键配置），编程任务开始时的"项目认知"入口。
- **`page_reader`**：抓网页提取可读文本（剥离 HTML/script/style，SSRF 防护复用 guardedFetch），适合读文档/手册。
- **`grep` 增加 context 参数**：匹配行前后 N 行，便于定位函数体与调用点。

### 代码图谱增强（编程上下文感知）
- **确定性 import 依赖提取**：`extractImports` 从源码提取本地模块依赖（相对路径/别名），扫描清单与图谱节点自动附带；schema 新增 `imports` 列。
- **图谱上下文渲染依赖关系**：graphToContext 输出「path (N行): 职责（依赖: a, b）」，Agent 改文件前能评估影响面。
- **`/graph` 分析命令**（slash 指令 + socket `chat:graph`）：扫描工作区 → LLM 分批归纳文件职责（每批 25 个，进度流式推送，单批失败跳过）→ 写入图谱 → 后续对话自动注入项目结构认知。

### 协议能力
- **llm-client Responses API 原生工具调用解析**：新增 `response.output_item.added` / `function_call_arguments.delta` / `output_item.done` 事件处理，OpenAI Responses 协议也能原生调用工具（此前只能文本协议）。

### 提示词工程
- **PERSONA 新增「编程工作流」章节**：先建立认知（workspace_info/图谱）→ 先读后写 → 改完必验证（run_tests）→ 小步迭代 → 报错先看根因 → 评估依赖影响面。

### 本轮 Bug 修复
- **app-frame 启动健壮性**：初始会话加载/selectSession/createSession 补 try/catch 与 !res.ok 检查，后端未启动时不再抛未处理异常/卡死。
- **mini-services 不在主 tsconfig include**：stream 文件缺 ChatMessage/llmStreamChat 导入，仅 stream 构建可发现——已补导入（tsc 主项目无法覆盖，stream 构建作为独立验证门）。

### 验证（第二轮）
| 项目 | 结果 |
|---|---|
| tsc --noEmit | ✅ 0 错误 |
| bun test（44 用例） | ✅ 44 pass / 0 fail |
| eslint | ✅ clean |
| next build | ✅ 通过 |
| stream 编译（nexus setup） | ✅ 通过 |
| 新工具端到端冒烟（编译产物直调） | ✅ run_tests typecheck 通过 / workspace_info / grep context 正常 |

### 遗留（同第一轮）
会话级访问控制、断线恢复订阅、run 超时强制释放、MCP 真实客户端、记忆语义检索、API Key 加密、快照差异预览/单文件恢复、stream 集成测试、安全响应头。

---

---

## 三·第三轮：图架构补强 + GitHub 借鉴（新增）

> 本轮依据 GitHub 公开调研（api.github.com 检索：pi 96k⭐ / LibreChat 42k⭐ / continue 35k⭐ / agentmemory 27k⭐ / qwen-code 27k⭐ 等），借鉴成熟开源 Agent 的核心技术与功能，并深挖"图驱动"架构。

### 图架构补强（核心）
- **新增「代码图谱」视图**（第 4 个 ViewTab）：浏览工作区分析结果（文件职责 + 行数 + 本地依赖 + 类型筛选 + 搜索），一键「建立图谱」（触发 /graph 分析，运行中显示进度，完成后自动刷新）——让"图驱动"从后端上下文延伸到用户可见的交互界面。
- **执行图决策节点**：每次 LLM 决策（decision/record）成为图上可点击的 `decision:N` 节点（连入/连出 llm_call），点击直接打开该决策详情（思维链/工具调用/协议）；多决策按索引区分。
- **执行统计条**（GraphStats）：工具调用数 / LLM 决策数 / 错误与运行中 / 工具总耗时与均值——图的可观测性聚合。

### GitHub 借鉴功能（注明出处）
- **Auto-Memory 自动记忆**（借鉴 [QwenLM/qwen-code](https://github.com/QwenLM/qwen-code) 的 Auto-Memory 与 [rohitg00/agentmemory](https://github.com/rohitg00/agentmemory) 的持久记忆模式）：新增设置项「自动记忆」，每轮结束后异步让 LLM 提炼值得长期记住的事实/偏好存入 `auto` 命名空间；上下文注入改为合并 手动(default)+自动(auto) 双命名空间（去重、置顶优先、标注来源）。
- **会话导出/导入**（借鉴 [danny-avila/LibreChat](https://github.com/danny-avila/LibreChat) 的导出能力）：`GET /api/sessions/:id/export`（事件流+决策+标题/标签打包 JSON）+ `POST /api/sessions/import`（类型白名单过滤、按原序重放、决策重建）；侧边栏会话右键「导出」+「导入会话」按钮（导入后自动选中新会话）。
- **LLM 智能标题**：首条消息较长时用 LLM 提炼 ≤24 字标题（失败/短消息回退首段截断）。
- **代码块一键复制**：markdown 渲染器为代码块注入复制按钮（模块级代码存储 + 事件委托，hover 显示）。

### 本轮 Bug 修复
- **chat:graph 缺少运行锁**：与进行中的 chat:run 并发会重复消耗 LLM——已并入 runningSessions 互斥并在 finally 释放。
- 导出/导入逻辑经端到端冒烟验证（事件重放 seq 顺序正确、脏类型过滤）。

### 验证（第三轮）
| 项目 | 结果 |
|---|---|
| tsc --noEmit | ✅ 0 错误 |
| bun test（46 用例，含决策节点投影） | ✅ 46 pass / 0 fail |
| eslint | ✅ clean |
| next build | ✅ 通过（含 /api/sessions/import 路由） |
| stream 编译 + 3003 冒烟 | ✅ 通过 |
| 导入重放冒烟 | ✅ seq 顺序正确 |

### 调研来源（GitHub）
- [earendil-works/pi](https://github.com/earendil-works/pi)（96k⭐，agent 运行时/多供应商/遥测）
- [danny-avila/LibreChat](https://github.com/danny-avila/LibreChat)（42k⭐，会话导出/消息搜索/审批流）
- [continuedev/continue](https://github.com/continuedev/continue)（35k⭐，编码 agent）
- [rohitg00/agentmemory](https://github.com/rohitg00/agentmemory)（27k⭐，持久记忆/置信度/生命周期）
- [QwenLM/qwen-code](https://github.com/QwenLM/qwen-code)（27k⭐，Auto-Memory/Auto-Skills/MCP）

---

---

## 四·目标轮第2轮：Token 可观测性 + 消息搜索 + apply_patch（新增）

> 继续借鉴 GitHub 开源项目：LibreChat（message search）、Claude Code（apply_patch 统一 diff）、主流 agent 的 token 用量跟踪。

### 图架构/可观测性
- **Token 用量跟踪**：Decision 模型新增 `inputTokens`/`outputTokens` 列；runTurn 每次 LLM 决策估算输入/输出 token（输入≈上下文消息体，输出≈内容+思维链）；快照 blob 透传；详情面板「Token 估算」字段展示；实时事件同步。
- **执行统计**：上一轮的 GraphStats 已聚合工具耗时；本轮 Token 数据为成本可观测性补齐输入侧。

### GitHub 借鉴功能
- **全局消息搜索**（借鉴 LibreChat message search）：`GET /api/search?q=` 在会话事件流中全文检索 user/assistant 消息（SQLite LIKE），返回 {会话, seq, 类型, 高亮片段}；侧边栏搜索框输入即防抖检索，点击直达该会话时间轴对应消息（selectSession + openTimelineAt）。
- **apply_patch 工具**（借鉴 Claude Code）：解析 unified diff（多文件/多 hunk/上下文校验/±10 行容错偏移/dry-run 预览），批量修改时一次给多个文件的新旧对比；沙箱按写风险处理、需审批；PERSONA 与工具清单同步。

### 本轮 Bug 修复
- **tool-approvals 坏 JSON 崩列表**：`JSON.parse(r.arguments)` 对脏数据 500 → 逐条容错。
- **auto-memory 审批轮误提炼**：审批阻塞轮（等待用户操作）不再触发自动记忆提炼。
- 详情面板 Token 字段的 JSX 结构修复（Field 嵌套闭合问题，tsc 回归验证）。

### 验证（目标轮第2轮）
| 项目 | 结果 |
|---|---|
| tsc --noEmit | ✅ 0 错误 |
| bun test（51 用例，含 patch 解析/应用 5 例） | ✅ 51 pass / 0 fail |
| eslint | ✅ clean |
| next build | ✅ 通过（含 /api/search 路由） |
| stream 编译 | ✅ 通过 |
| patch 工具端到端冒烟（dry-run + 实写） | ✅ 内容正确更新 |

### 调研来源（GitHub）
- [danny-avila/LibreChat](https://github.com/danny-avila/LibreChat)（message search / 导出 / 审批流）
- Claude Code apply_patch（统一 diff 应用，社区广泛复刻）
- token 用量跟踪模式（tokenguard-copilot / nest-ai-tokens 等）

---

---

## 五·目标轮第3轮：队列 follow-up + 审批精确回放 + 图谱保鲜（新增）

> 借鉴 LibreChat v0.8.8 的 "Agent run control: queue follow-up messages"；修复审批回放边界 bug；代码图谱增加过期保鲜。

### 功能
- **排队发送（队列 follow-up）**（借鉴 [LibreChat](https://github.com/danny-avila/LibreChat) 的 agent 运行控制）：Agent 运行中输入消息并回车 → 不再被忽略，而是入队显示「已排队：…（本轮完成后自动发送）✕」；`chat:done` 后自动发送；用户主动停止时清空队列，避免意外发送。
- **审批触发消息精确回放**：ToolApproval 新增 `triggerMessage` 列（记录触发审批的用户消息原文）；`chat:rerun` 优先回放该消息——修复"用户批准的是较早消息、但最新用户消息不同导致重放错误"的边界 bug。
- **代码图谱过期保鲜**：GET /api/code-graph 逐节点 stat 文件 mtime 与节点分析时间比对 → `stale` 标记；代码图谱视图显示「N 个文件已变更」汇总与逐节点「已过期」徽标（建议重新分析）。
- **最近改动注入上下文**：buildHistory 从工具调用事件提取最近改动的文件（write/edit/patch/str_replace_editor），注入「## 本会话最近改动的文件」——Agent 持续感知自己改过什么，接续修改更连贯。

### 本轮 Bug 修复
- **schema CRLF 换行导致编辑静默失效**：prisma/schema.prisma 是 CRLF，此前按 LF 匹配的编辑未生效（triggerMessage 列缺失导致 tsc 报错）——已按实际行尾重做并 db push 验证。
- **审批重放目标不精确**（上文）：用 triggerMessage 替代"最近一条用户消息"兜底。

### 验证（目标轮第3轮）
| 项目 | 结果 |
|---|---|
| tsc --noEmit | ✅ 0 错误 |
| bun test（51 用例） | ✅ 51 pass / 0 fail |
| eslint | ✅ clean |
| next build | ✅ 通过 |
| stream 编译 | ✅ 通过 |
| triggerMessage 回放冒烟 | ✅ 精确命中触发消息 |

### 调研来源（GitHub）
- [danny-avila/LibreChat](https://github.com/danny-avila/LibreChat) v0.8.8：Agent run control / queue follow-up / message search
- Claude Code apply_patch、主流 agent 的 token 用量跟踪（前两轮已引）

---


---

## 六·自主修 Bug 轮（新增）

> 自主静态扫描 + 动态验证发现的缺陷修复。目标：状态同步一致性、资源泄漏、边界误判、未处理异常。

### 修复清单
1. **流式服务限流桶泄漏**（nexus-stream）：disconnect 清理只覆盖 chat/group/plan/compact 键，graph:/rerun: 键永久驻留内存——补齐。
2. **chat:error 状态不同步**（use-nexus-socket）：出错后前端不重载会话，runTurn 已写入的部分事件（工具结果/错误）在实时态缺失——补 reloadSession。
3. **短 Key 掩码误判**（settings.isMaskedApiKey）：≤8 字符 Key 掩码后为 4 星号，此前正则不识别，会被当作真实 Key 存回导致旧 Key 被覆盖——增加精确匹配。
4. **实时消息合并丢失工具结果**（use-nexus.applyLiveEvent）：assistant/message 收口替换流式占位时丢弃已附着的 toolResults，多轮调用时工具卡片每轮消失（直到重载）——合并保留。
5. **未处理 fetch 拒绝**（app-frame/group-panel）：renameSession/togglePin/deleteSession/createRoom/deleteRoom 网络异常产生 unhandledRejection——补 try/catch；createRoom 增加错误提示与返回校验。
6. **测试基建**：新增 isMaskedApiKey 边界回归（正常掩码/短 Key 掩码/真实 Key 不误判）。

### 验证（本轮）
| 项目 | 结果 |
|---|---|
| tsc --noEmit | ✅ 0 错误 |
| bun test（54 用例） | ✅ 54 pass / 0 fail |
| eslint | ✅ clean |
| next build | ✅ 通过 |
| stream 编译 | ✅ 通过 |
| 搜索查询冒烟（SQLite contains） | ✅ 命中正确 |

### 累计状态
三轮 + 本自主轮共修复 **60+ bug**；工具集 32→42；测试 37→54。遗留项持续记录于文末。

---

## 四、遗留建议（未实施，后续可做）

1. 会话级访问控制：事件流订阅需持有会话令牌（防本地进程偷听任意会话）。
2. 断线恢复订阅接口：`chat:subscribe` 重放进行中状态（刷新后不丢进度）。
3. run 超时强制释放：LLM 挂起时释放 runningSessions 锁（协作式停止的兜底）。
4. 群聊消息分页（当前 take 500 封顶）。
5. 记忆语义检索（向量化嵌入）。
6. API Key 加密存储（AES-GCM，密钥走环境变量）。
7. 快照差异预览 / 单文件恢复。
8. MCP 面板从演示态升级为真实 MCP 客户端（@modelcontextprotocol/sdk）。
9. stream 集成测试（socket.io-client 覆盖空载荷/限流/互斥/停止）。
10. next.config：补充安全响应头（X-Content-Type-Options 等）。


---

## 七·运行期修复（用户实测反馈）

- **LLM 智能标题阻塞首个回合**：maybeAutoTitle 的标题提炼是同步 await 的 LLM 调用，供应商未配置/慢/挂起时，chat:run 在 runTurn 之前就被卡住——表现为「会话起了名字但对话不继续」。已改为：maybeAutoTitle 立即用首段截断返回；智能标题拆到 refineTitleInBackground 后台异步执行（8s 硬超时，且仅在标题仍为自动生成值时才覆盖）。
- **内置供应商 SDK 无超时**：旧内置流式实现的 create() 可无限挂起（未配置 Key 时最典型）。新增 withTimeout 助手，供应商调用 30s 硬超时，回合不再被永久卡死。
- 验证：tsc ✅ / 54 测试 ✅ / eslint ✅ / stream 编译 ✅。

---

## 八·用户反馈修复轮（内置供应商清除 + 交互修复 + 智能整理）

### 1. 彻底移除内置供应商 SDK（含全部注释引用）
- llm-client：删除内置供应商 SDK 的导入与全部相关实现；未配置供应商时直接明确报错，绝不静默挂起。
- provider-utils：resolveProvider 直接返回 ModelProvider | null（移除内置回退概念）；同步更新 agent/group-chat/optimize-prompt/stream/model-switcher/settings-dialog 全部调用点。
- 删除 package.json（根 + stream）中的 内置供应商 SDK 依赖与 stream node_modules 下的包目录；清理所有提及 内置供应商/内置的注释。

### 2. 修复设置页嵌套 button 水合错误
- 工具白名单行：外层 button 包裹 Switch（内部也是 button）触发 React 水合错误——外层改为 div[role=button] + 键盘事件，保留完整交互。

### 3. 代码图谱可点击 + 让 Agent 分析
- 节点展开区新增「让 Agent 分析此文件」（发送 chat:run 让大模型读取分析）与「复制路径」；依赖徽标点击可定位（此前已有）。

### 4. 智能整理项目（chat:organize）
- 新增 socket 事件 chat:organize + 代码图谱视图「智能整理」按钮（带同意确认）。
- 流程：扫描工作区 → LLM 制定整理方案（JSON）→ 严格校验（仅工作区内、跳过自动生成目录、不删除、最多 50 项）→ 逐项 mkdir+rename 执行并流式反馈 → 图谱节点同步迁移。
- 安全边界：仅移动/改名，绝不删除；越界/跳过目录一律拒绝（已冒烟验证）。

### 验证
| 项目 | 结果 |
|---|---|
| tsc --noEmit | ✅ 0 错误 |
| bun test（54 用例） | ✅ 54 pass / 0 fail |
| eslint | ✅ clean |
| next build | ✅ 通过 |
| stream 编译 | ✅ 通过 |
| 整理安全冒烟（工作区内移动/越界拒绝） | ✅ 通过 |

---

## 九·持续打磨轮（子代可用 / 上下文管理 / 记忆偏好 / 快照深度 / UI 与安全）

### 1. 本地子代理 delegate（子代真正可用）
- 新增 delegate 工具：启动独立上下文的子代理，配只读工具白名单（read/glob/grep/web_search/page_reader/calculator/current_time/echo/workspace_info/memory_recall/run_tests），自主调研最多 8 轮后回传结论。
- 子代在 NEXUS 内独立运行、真实可用（此前 subagent 系列为宿主占位）。

### 2. 上下文管理：用量指示器
- GET /api/sessions/:id/context 返回估算 tokens/window/pct/threshold；头部新增「上下文 N%」徽标（绿<60 / 黄60-阈值 / 红≥阈值），超过阈值时点击直接 /compact。

### 3. 记忆层学习偏好（智能非人为）
- 自动记忆提取器显式识别用户偏好 → 存入 prefs 命名空间；上下文注入按 偏好 > 手动 > 自动 三路合并，偏好最高优先级并提示 Agent 优先遵守——记忆真正影响行为。

### 4. 快照深度（不止表面）
- listSnapshots 解析快照 blob 返回 eventCount / decisionCount / fileCount；快照对话框与时间轴均展示「N 事件 / M 文件」，恢复前对内容规模一目了然。

### 5. UI 美化与快捷操作
- 全局快捷键：⌘/Ctrl+N 新建会话、⌘/Ctrl+1..4 切换视图（对话/执行图/代码图谱/时间轴）、⌘/Ctrl+Shift+D 详情面板。
- 侧边栏会话显示相对时间（刚刚/N分钟前/昨天/日期）。

### 6. 安全与兼容性
- next.config 增加安全响应头（X-Content-Type-Options / X-Frame-Options / Referrer-Policy / Permissions-Policy）。
- nexus web 启动前同步探测 3000/3003 端口占用并给出明确提示（NEXUS_FORCE=1 可跳过）。

### 7. Bug 修复
- delegate 静态导入 settings/llm-client 后测试链路验证（PrismaClient 惰性构造不抛错）。
- ContextUsageBadge 数据获取 effect 的 react-hooks 规则豁免（异步 setState）。

### 验证
| 项目 | 结果 |
|---|---|
| tsc --noEmit | ✅ 0 错误 |
| bun test（54 用例） | ✅ 54 pass / 0 fail |
| eslint | ✅ clean |
| next build | ✅ 通过 |
| stream 编译（43 工具注册确认） | ✅ delegate/run_tests/patch 等全部 OK |

---

## 十·继续打磨轮（快照单文件恢复 / patch CRLF / 供应商引导 / 部署兼容）

### 1. 快照单文件恢复（快照不止整包回滚）
- 新增 GET /api/snapshots/:id/files（读 manifest 列文件）与 POST /api/snapshots/:id/file（从备份拷回工作区，路径防越界）。
- 时间轴快照行新增「恢复文件」按钮：打开文件清单对话框（可搜索），选中即恢复并覆盖工作区同名文件。
- 冒烟验证：恢复内容正确（version-1 覆盖 version-2）、越界路径（../）被拒绝。

### 2. patch 工具 CRLF 兼容（Windows 真实 bug）
- 此前 applyHunks 按换行切分，对 CRLF 文件（如多数 Windows 项目）上下文匹配必失败。修复：匹配前剥行尾 CR，写回时保留原换行风格（CRLF→CRLF）。
- 新增 CRLF 回归测试。

### 3. 未配置供应商引导横幅（新用户体验）
- 会话页顶部：未配置任何供应商时显示可关闭的提示条（localStorage 记忆），引导去设置添加供应商，避免新手困惑对话为何没有回复。

### 4. 部署兼容：start-standalone 优先编译产物
- 生产启动器改为优先用 node 直跑 stream 编译产物（无需 bun），无产物且无 bun 时给出明确提示；同时兼容 Node <20.11（fileURLToPath）并注入 NEXUS_WORKSPACE。

### 5. Bug 修复
- ProviderHint localStorage 初始化改为 useState 惰性求值（消除 react-hooks set-state-in-effect 报错）。

### 验证
| 项目 | 结果 |
|---|---|
| tsc --noEmit | ✅ 0 错误 |
| bun test（55 用例） | ✅ 55 pass / 0 fail |
| eslint | ✅ clean |
| next build | ✅ 通过 |
| stream 编译 | ✅ 通过 |
| 单文件恢复冒烟（含越界拒绝） | ✅ 通过 |
---

## 十一·运行期故障修复（Turbopack panic）

### 问题
- `nexus web` 启动后 GET / 返回 500，Turbopack 反复 panic（next-panic-*.log）。

### 根因
- `mini-services/nexus-stream/package.json` 存在自我引用依赖（`file:../..` 指向项目根）——npm 在 stream 的 node_modules 建立指回项目根的 junction，Turbopack 扫描 tailwind 内容 glob 时沿符号链接无限循环。

### 修复
- 删除该依赖与 junction；重新 `npm install` 同步依赖；启动验证 HTTP 200、无 panic。

### 验证
| 项 | 结果 |
|---|---|
| dev 启动 + 首页请求 | ✅ 200，无 FATAL |
| tsc / tests(55) / eslint | ✅ 全通过 |
---

## 十二·图谱视图重构（智能嵌入底层 + 美观化）

### 问题
- 「建立图谱」按钮在未配置供应商时静默失败（错误只发到聊天流，视图无反馈，看起来像按钮失效）；
- 头部一排大字按钮（建立图谱/智能整理/刷新）显得笨重、不美观。

### 重构
- **智能嵌入底层**：进入代码图谱视图且图谱为空、供应商已配置时，**自动发起分析**（无需任何按钮）；未配置供应商时显示优雅引导（去设置添加供应商后自动分析）。
- **失败可见**：分析失败在头部以红字提示（含原因），不再静默。
- **美观化**：头部改为 图标瓦片 + 标题 + 状态行 + 三个克制的小图标操作（✨分析/🪄智能整理/⟳刷新，仅 tooltip）；分析时显示流动进度条 + 「AI 正在分析…」；空状态重新设计为智能引导卡片。
- **智能整理下沉到对话层**：新增 `/organize` 快捷指令（确认后执行），与代码图谱视图的小图标入口并存。

### 验证
| 项 | 结果 |
|---|---|
| tsc / tests(55) / eslint | ✅ 全通过 |
| next build | ✅ 通过 |
---

## 十三·故障诊断与健壮性（供应商余额不足场景）

### 诊断结论
- 用户配置的供应商（自定义网关）拉取模型正常，但 chat 调用返回 503 SERVICE_BUSY，重试后暴露 402 INSUFFICIENT_BALANCE（账户余额不足）——非代码问题，属供应商账户状态。

### 健壮性改进
- **错误真实可见**：store 新增 lastError，chat:error 写入真实原因；代码图谱视图头部显示实际错误文案（如余额不足/服务繁忙），不再误导为未配置供应商。
- **LLM 调用重试**：新增 llmWithRetry（SERVICE_BUSY/5xx/超时/断连等瞬时故障重试 2 次，3s/6s 退避），应用于 chat:graph 与 chat:organize。
- **失败降级**：图谱分析在模型不可用时仍写入基础结构节点（文件树 + 行数 + 依赖，摘要标注待恢复），视图不空白、Agent 仍能感知项目结构。

### 验证
| 项 | 结果 |
|---|---|
| tsc / tests(55) / eslint | ✅ 全通过 |
| next build | ✅ 通过 |
| stream 编译 | ✅ 通过 |
---

## 十四·已断开问题修复（stream 崩溃防护 + 自动重启 + 局域网地址）

### 问题
- 前端显示「已断开」：web(3000) 正常但 stream(3003) 进程中途退出——单个未捕获的异步错误即可杀死整个 Node 进程，前端 socket 永久断开。

### 修复（三层防护）
1. **stream 全局错误兜底**：unhandledRejection / uncaughtException 只记录日志，不再杀死服务（错误可见、服务存活）。
2. **CLI 自动重启**：nexus web 拉起的 stream 子进程退出后自动重启（最多 5 次，1.5s 递增退避），不再连带关闭 web。
3. **局域网访问**：socket-url 增加 dev 启发式（页面端口 3000 → 直连 同host:3003，支持局域网 IP）；stream 支持 NEXUS_BIND=0.0.0.0 暴露（配合 NEXUS_ACCESS_TOKEN 使用）。

### 验证
| 项 | 结果 |
|---|---|
| tsc / tests(55) / eslint | ✅ 全通过 |
| next build | ✅ 通过 |
| stream 编译 + 3003 启动 | ✅ 通过 |