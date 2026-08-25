// NEXUS ChatAgent — graph-driven conversation loop.
import { db } from "@/lib/db";
import { promises as fs } from "fs";
import path from "path";
import { appendEvent, deriveTitle } from "./events";
import { executeTool, TOOLS, needsApproval } from "./tools";
import { createSnapshot } from "./snapshot";
import { parseToolCallsFromText } from "./tool-parser";
import { getGraph, graphToContext, upsertNodes, removeNode, extractTouchedPaths } from "./code-graph";
import { recallMemory, saveMemory } from "./memory";
import { getSettings, resolveProvider, activeModelOf, type AgentSettings, type ModelProvider, type ModelConfig } from "./settings";
import { streamChat as llmStreamChat, type ChatMessage } from "./llm-client";
import type { EventType, ToolCall } from "./types";

export interface AgentCallbacks {
  onEvent?: (type: EventType, data: Record<string, any>) => void;
  onToken?: (delta: string) => void;
  onThinking?: (delta: string) => void;
  shouldStop?: () => boolean;
}

const PERSONA = `你是 NEXUS，一个图驱动的通用 AI Agent。你透明、可观测、善于使用工具。

## 如何调用工具
- 优先使用平台提供的原生工具调用（function calling）能力。
- 如果当前环境没有原生工具，则输出**恰好一个** JSON 代码块，格式如下，代码块之后不要输出任何内容：

\`\`\`json
{"tool": "<工具名>", "args": {<参数>}}
\`\`\`

## 可用工具
- read: {"path": string, "offset"?: number, "limit"?: number} — 读取文件（带行号）或列出目录。
- write: {"path": string, "content": string} — 覆盖写入文件。
- edit: {"file_path": string, "old_string": string, "new_string": string} — 精准替换文件内容。
- patch: {"diff": string, "dryRun"?: boolean} — 应用 unified diff（git 格式），支持多文件多 hunk 与 dry-run 预览。
- str_replace_editor: {"command": "view|create|insert|str_replace", "path": string, ...} — 通用编辑工具。
- glob: {"pattern": string} — 按模式递归查找文件。
- grep: {"pattern": string, "path"?: string} — 正则搜索文件内容。
- read_image: {"path": string} — 读取图片元数据。
- pwsh: {"command": string, "cwd"?: string, "timeout"?: number} — 执行 PowerShell 命令。
- web_search: {"query": string} — 搜索公开网络获取实时信息。
- memory_save: {"key": string, "value": string, "namespace"?: string, "pinned"?: boolean} — 保存长期记忆（跨会话保留）。
- memory_recall: {"namespace"?: string, "key"?: string} — 回忆长期记忆。
- http_request: {"url": string, "method"?: string, "headers"?: object, "body"?: string} — 发起 HTTP 请求（SSRF 防护）。
- page_reader: {"url": string} — 抓取网页并提取可读文本（读文档）。
- run_tests: {"command": "test"|"typecheck"|"build", "filter"?: string} — 运行项目验证（白名单）。
- workspace_info: {} — 概览项目结构（脚本/依赖/配置）。
- delegate: {"task": string, "maxRounds"?: number} — 启动本地子代理独立调研并返回结论（只读工具）。
- calculator: {"expression": string} — 安全表达式求值。
- current_time: {} — 获取当前时间。
- create_goal / get_goal / update_goal / todo_write — 目标与任务清单管理。
- workflow / ralph / subagent / subagent_fork / send_message / list_agents / interrupt_agent — 多代理与编排（当前环境可能不可用）。
- job_list / job_output / job_kill — 后台任务管理（当前环境可能不可用）。
- ask_user_question — 向用户提问。
- skill — 加载技能说明（当前环境可能不可用）。

## 编程工作流（处理代码/项目任务时遵守）
1. **先建立认知**：优先调用 workspace_info 了解项目结构、scripts 与依赖；如有代码图谱（/graph 生成）则直接依赖它定位文件。
2. **先读后写**：修改任何文件前先用 read 查看相关代码与上下文；grep 支持 context 参数，可带前后文定位函数体与调用点。
3. **改完必验证**：每次修改后用 run_tests（typecheck 或 test）验证没有破坏现有功能；涉及构建流程时运行 build。测试失败必须阅读错误并修复后再继续。
4. **小步迭代**：复杂改动拆成多个小步骤，每步验证；一次只改一个关注点。
5. **报错先看根因**：编译/运行错误先读第一条错误与对应文件上下文，再动手修复；不要盲目重试相同操作。
6. **善用图谱与检索**：改 A 文件前先看它被谁依赖（图谱中的依赖信息），评估影响面。

## 行为准则
- 你处于固定的执行循环中：【思考 → 判断信息是否充足 → 调用工具 → 读取工具结果 → 再思考】。
- 工具返回结果后，你**必须**基于结果重新判断：信息仍不足就继续调用工具（可换参数、换工具、换关键词），信息充足才输出最终回答。
- 严禁调用一次工具就结束任务；严禁无视工具返回内容直接编造答案。
- 处理代码/文件任务时，优先使用 read / glob / grep 调查，再用 write / edit / str_replace_editor 修改。
- 需要执行命令时使用 pwsh；高风险命令默认需审批，系统破坏性命令会被底层拦截。
- 涉及时事或需要实时信息时，**必须**调用 web_search。
- 工具返回后，基于真实结果综合回答。**绝不**编造工具结果。
- 不需要工具时，直接用 markdown 回答。
- 每轮只输出一个工具调用块。
- 用中文回答。

## 终止条件（全部满足才能输出最终回答）
1. 用户全部诉求已得到解答；
2. 已充分检索，确认不再需要任何工具；
3. 回答对齐「会话总目标」与「执行计划」（如已设置）。
`;

export async function maybeAutoTitle(sessionId: string, userText: string): Promise<string | null> {
  const session = await db.session.findUnique({ where: { id: sessionId } });
  if (!session) return null;
  if (session.title && session.title !== "新建会话") return null;
  // 立即用首段截断起标题（绝不阻塞回合）；智能标题由 refineTitleInBackground 后台异步补充
  const title = deriveTitle(userText);
  await db.session.update({ where: { id: sessionId }, data: { title } });
  return title;
}

// 后台智能标题：不阻塞主回合；8s 硬超时；仅当标题仍为自动生成值时覆盖（避免覆盖用户重命名）
export async function refineTitleInBackground(sessionId: string, userText: string): Promise<string | null> {
  try {
    if (userText.trim().length <= 24) return null;
    const settings = await getSettings();
    const provider = resolveProvider(settings);
    const model = activeModelOf(provider);
    if (!provider || !model) return null;
    const r = await Promise.race([
      llmStreamChat(
        [
          { role: "system", content: "为一段用户消息提炼一个 ≤24 字的会话标题（中文，不带标点结尾，不要引号）。直接输出标题本身，不要任何解释。" },
          { role: "user", content: userText.slice(0, 400) },
        ],
        { model: model.name, temperature: 0.3, maxTokens: 60, thinkingEnabled: false, provider },
      ),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
    const t = ((r?.content || "") as string).trim().replace(/^["'「『]|["'」』]$/g, "").slice(0, 24);
    if (t.length < 2) return null;
    // 仅覆盖自动生成的标题：用户已重命名则不动
    const session = await db.session.findUnique({ where: { id: sessionId }, select: { title: true } });
    if (!session || !session.title || session.title === "新建会话") return null;
    if (session.title !== deriveTitle(userText)) return null;
    await db.session.update({ where: { id: sessionId }, data: { title: t } });
    return t;
  } catch {
    return null;
  }
}

// 计算会话下一个回合号：事件流中已出现的最大 turn + 1。
// 客户端维护的 turn 在刷新/重连后会从 1 重新计，若直接采用会与历史回合冲突
// （执行图节点合并、决策记录重复），因此以服务端事件流为准。
export async function nextTurn(sessionId: string): Promise<number> {
  const events = await loadEvents(sessionId);
  let maxTurn = 0;
  for (const e of events) {
    const t = Number(e.data?.turn);
    if (Number.isFinite(t) && t > maxTurn) maxTurn = t;
  }
  return maxTurn + 1;
}

function parseTextToolCalls(content: string): ToolCall[] | null {
  const parsed = parseToolCallsFromText(content);
  if (!parsed) return null;
  return parsed.map((tc, i) => ({
    id: `call-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${i}`,
    name: tc.name,
    arguments: tc.arguments,
  }));
}

const MAX_TOOL_ROUNDS = 5;

// 键序稳定的 JSON 序列化，用于审批匹配（模型两次生成的参数键序可能不同）
function stableStringify(v: any): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(",")}}`;
}

// 查询该工具+参数在本会话是否已被批准/拒绝过
async function findPriorApproval(sessionId: string, toolName: string, args: Record<string, any>) {
  const target = stableStringify(args);
  const rows = await db.toolApproval.findMany({ where: { sessionId, toolName } }).catch(() => [] as any[]);
  return rows.find((r) => {
    try { return stableStringify(JSON.parse(r.arguments)) === target; } catch { return false; }
  }) ?? null;
}

export async function runTurn(args: { sessionId: string; userText: string; turn: number; cb: AgentCallbacks }): Promise<{ reply: string; error?: string }> {
  const { sessionId, userText, turn, cb } = args;
  const settings = await getSettings();
  const provider = resolveProvider(settings);
  const activeModel = activeModelOf(provider);
  const maxToolRounds = Math.min(Math.max(settings.maxToolRounds || MAX_TOOL_ROUNDS, 1), 10);
  // 白名单内的工具以原生 function calling 形式下发给模型
  const toolDefs = TOOLS
    .filter((t) => !settings.enabledTools.length || settings.enabledTools.includes(t.name))
    .map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));

  cb.onEvent?.("graph/turn_start", { turn });
  cb.onEvent?.("graph/node_start", { node: "user_input", turn });
  cb.onEvent?.("graph/node_end", { node: "user_input", turn, ok: true });
  await appendEvent({ sessionId, type: "user/message", data: { content: userText, turn } });
  cb.onEvent?.("user/message", { content: userText, turn });

  let lastReply = "";
  let llmError: string | undefined;
  let stopped = false;

  for (let round = 0; round < maxToolRounds; round++) {
    if (cb.shouldStop?.()) { stopped = true; break; }
    cb.onEvent?.("graph/node_start", { node: "llm_call", turn, round });
    const llmStart = Date.now();
    const history = await buildContextHistory(sessionId, settings, provider, activeModel, cb);

    let content = "";
    let thinking = "";
    let nativeToolCalls: ToolCall[] | null = null;
    let llmRetryed = false;
    try {
      const r = await llmStreamChat(history, {
        onToken: (d) => { content += d; cb.onToken?.(d); },
        onThinking: (d) => { thinking += d; cb.onThinking?.(d); },
        shouldStop: cb.shouldStop,
        model: activeModel?.name,
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
        thinkingEnabled: settings.thinkingEnabled,
        thinkingLevel: provider?.thinkingLevel,
        topP: provider?.topP,
        frequencyPenalty: provider?.frequencyPenalty,
        presencePenalty: provider?.presencePenalty,
        stop: provider?.stop,
        customParams: provider?.customParams,
        cacheKey: sessionId,
        tools: toolDefs,
        provider
      });
      content = r.content || content;
      thinking = r.thinking || thinking;
      nativeToolCalls = r.toolCalls?.length
        ? r.toolCalls.map((tc, i) => ({ id: tc.id || `call-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${i}`, name: tc.name, arguments: tc.arguments }))
        : null;
    } catch (err: any) {
      // 异常兜底：LLM 调用失败重试一次（瞬时故障常见），再失败才结束本轮
      if (!llmRetryed && !cb.shouldStop?.()) {
        llmRetryed = true;
        cb.onEvent?.("graph/node_end", { node: "llm_call", turn, round, ok: false, error: err?.message, retry: true });
        try {
          const r = await llmStreamChat(history, {
            onToken: (d) => { content += d; cb.onToken?.(d); },
            onThinking: (d) => { thinking += d; cb.onThinking?.(d); },
            shouldStop: cb.shouldStop,
            model: activeModel?.name,
            temperature: settings.temperature,
            maxTokens: settings.maxTokens,
            thinkingEnabled: settings.thinkingEnabled,
            thinkingLevel: provider?.thinkingLevel,
            topP: provider?.topP,
            stop: provider?.stop,
            customParams: provider?.customParams,
            cacheKey: sessionId,
            tools: toolDefs,
            provider
          });
          content = r.content || content;
          thinking = r.thinking || thinking;
          nativeToolCalls = r.toolCalls?.length
            ? r.toolCalls.map((tc, i) => ({ id: tc.id || `call-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${i}`, name: tc.name, arguments: tc.arguments }))
            : null;
        } catch (err2: any) {
          llmError = err2?.message || String(err2);
          cb.onEvent?.("graph/node_end", { node: "llm_call", turn, round, ok: false, error: llmError });
          break;
        }
      } else {
        llmError = err?.message || String(err);
        cb.onEvent?.("graph/node_end", { node: "llm_call", turn, round, ok: false, error: llmError });
        break;
      }
    }
    const llmDuration = Date.now() - llmStart;
    cb.onEvent?.("graph/node_end", { node: "llm_call", turn, round, ok: true, durationMs: llmDuration });

    const toolCallsFromText = nativeToolCalls || parseTextToolCalls(content);
    const decisionProvider = provider?.name || "custom";
    const decisionModel = activeModel?.name || "";
    // Token 用量估算（供成本/可观测性展示）：输入≈上下文消息体，输出≈内容+思维链
    const inputTokens = estimateTokens(history.map((m) => m.content).join("\n"));
    const outputTokens = estimateTokens(content) + estimateTokens(thinking);
    cb.onEvent?.("decision/record", { turn, provider: decisionProvider, model: decisionModel, protocol: nativeToolCalls ? "native" : "text", thinking: thinking.slice(0, 1500), hasToolCalls: !!toolCallsFromText, toolCalls: toolCallsFromText || [], contextSummary: history.slice(-2).map((m) => m.content.slice(0, 200)).join(" | "), durationMs: llmDuration, inputTokens, outputTokens });
    await db.decision.create({ data: { sessionId, turn, provider: decisionProvider, model: decisionModel, protocol: nativeToolCalls ? "native" : "text", thinking: thinking.slice(0, 1500), hasToolCalls: !!toolCallsFromText, toolCalls: JSON.stringify(toolCallsFromText || []), contextSummary: history.slice(-2).map((m) => m.content.slice(0, 200)).join(" | "), durationMs: llmDuration, inputTokens, outputTokens } }).catch(() => {});

    if (!toolCallsFromText || toolCallsFromText.length === 0) {
      await appendEvent({ sessionId, type: "assistant/message", data: { content, thinking: thinking || undefined, turn } });
      cb.onEvent?.("assistant/message", { content, thinking: thinking || undefined, turn });
      cb.onEvent?.("graph/node_start", { node: "finalize", turn });
      cb.onEvent?.("graph/node_end", { node: "finalize", turn, ok: true });
      lastReply = content;
      break;
    }

    if (!settings.autoToolCalls) {
      const message = "检测到工具调用，但「自动工具调用」已关闭。请先在设置中开启自动工具调用，或直接给出最终答案。";
      await appendEvent({ sessionId, type: "assistant/message", data: { content: message, thinking: thinking || undefined, turn } });
      cb.onEvent?.("assistant/message", { content: message, thinking: thinking || undefined, turn });
      cb.onEvent?.("graph/node_start", { node: "finalize", turn });
      cb.onEvent?.("graph/node_end", { node: "finalize", turn, ok: true });
      lastReply = message;
      break;
    }

    // 危险工具审批：按每个工具调用逐一判断。
    // 已批准过的相同调用直接放行；已拒绝过的相同调用提示模型换方案。
    cb.onEvent?.("graph/node_start", { node: "tool_node", turn, round });
    const cleanContent = content.replace(/```(?:json)?\s*\{[\s\S]*?"tool"[\s\S]*?\}\s*```/g, "").replace(/```(?:json)?\s*\{[\s\S]*?"name"[\s\S]*?\}\s*```/g, "").trim();
    await appendEvent({ sessionId, type: "assistant/message", data: { content: cleanContent || "", thinking: thinking || undefined, toolCalls: toolCallsFromText, turn } });
    cb.onEvent?.("assistant/message", { content: cleanContent || "", thinking: thinking || undefined, toolCalls: toolCallsFromText, turn });

    let approvalBlocked = false;
    for (const tc of toolCallsFromText) {
      if (cb.shouldStop?.()) { stopped = true; break; }

      if (needsApproval(tc.name, tc.arguments, settings.safetyMode)) {
        const prior = await findPriorApproval(sessionId, tc.name, tc.arguments);
        if (prior?.status === "approved") {
          // 已批准：继续执行
        } else if (prior?.status === "rejected") {
          const message = `工具「${tc.name}」的这次调用已被你拒绝。请换一种实现方式，或先向用户说明需要该工具的理由。`;
          await appendEvent({ sessionId, type: "assistant/message", data: { content: message, turn } });
          cb.onEvent?.("assistant/message", { content: message, turn });
          lastReply = message;
          approvalBlocked = true;
          break;
        } else {
          // 已有未决审批单（上一轮模型重复请求同一工具+参数）→ 复用，避免重复建单堆积
          const pending = prior?.status === "pending" ? prior : null;
          const approvalId = pending?.id || `ap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          if (!pending) {
            await db.toolApproval.create({
              data: {
                id: approvalId,
                sessionId,
                toolCallId: tc.id,
                toolName: tc.name,
                arguments: JSON.stringify(tc.arguments),
                status: "pending",
                riskLevel: "high",
                modeAtRequest: settings.safetyMode,
                triggerMessage: userText.slice(0, 500),
              },
            }).catch(() => {});
          }
          const approvalData = { id: approvalId, sessionId, toolCallId: tc.id, toolName: tc.name, arguments: tc.arguments, status: "pending", riskLevel: "high", modeAtRequest: settings.safetyMode, triggerMessage: userText.slice(0, 500) };
          cb.onEvent?.("tool/approval_request", approvalData);
          await appendEvent({ sessionId, type: "tool/approval_request", data: approvalData }).catch(() => {});
          const message = `需要审批后才能执行工具「${tc.name}」。请在时间轴 → 待审批中批准；批准后我会自动继续执行（无需重发消息）。`;
          await appendEvent({ sessionId, type: "assistant/message", data: { content: message, thinking: thinking || undefined, toolCalls: [tc], turn } });
          cb.onEvent?.("assistant/message", { content: message, thinking: thinking || undefined, toolCalls: [tc], turn });
          lastReply = message;
          approvalBlocked = true;
          break;
        }
      }

      cb.onEvent?.("tool/call", { toolCall: tc, turn });
      await appendEvent({ sessionId, type: "tool/call", data: { toolCall: tc, turn } });
      const tStart = Date.now();
      // 有本地副作用的工具执行前自动创建快照（eventSeq 自动记录），误操作后可回溯。
      // 节流：同一会话 30 秒内最多一次——before_tool 快照会整包备份项目文件，高频工具调用会拖慢执行并堆积磁盘。
      if (tc.name === "pwsh" || tc.name === "write") {
        const lastSnap = await db.snapshot.findFirst({ where: { sessionId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }).catch(() => null);
        if (!lastSnap || Date.now() - lastSnap.createdAt.getTime() > 30_000) {
          await createSnapshot({ sessionId, label: `工具调用前 ${tc.name}`, reason: "before_tool", turn }).catch(() => {});
        }
      }
      const res = await executeTool(tc.name, tc.arguments, settings.enabledTools, {
        mode: settings.safetyMode,
        workspaceRoot: process.cwd(),
        sessionId,
        approved: true, // 走到这里表示默认模式已审批放行，或无限制模式直接放行
      });
      const durationMs = Date.now() - tStart;
      const evtType: EventType = res.status === "error" || res.status === "blocked" ? "tool/error" : "tool/result";
      const payload = { toolCallId: tc.id, name: tc.name, content: res.content, status: res.status, durationMs, turn };
      cb.onEvent?.(evtType, payload);
      await appendEvent({ sessionId, type: evtType, data: payload });

      // 图谱增量维护：写操作成功后，更新对应文件的图谱节点（异步，不阻塞主链路）
      if (res.status === "ok" && ["write", "edit", "str_replace_editor", "pwsh"].includes(tc.name)) {
        const touched = extractTouchedPaths(tc.name, tc.arguments, process.cwd());
        for (const rel of touched) {
          try {
            const abs = path.resolve(process.cwd(), rel);
            const stat = await fs.stat(abs).catch(() => null);
            if (stat) {
              const content = stat.isFile() ? await fs.readFile(abs, "utf8").catch(() => "") : "";
              // 轻量摘要：取文件头部注释/导出名（完整 LLM 归纳在后台批量做）
              const head = content.split("\n").slice(0, 20).join(" ").replace(/\s+/g, " ").slice(0, 200);
              await upsertNodes(sessionId, [{ id: rel, summary: head || "(空或不可读)", kind: "file", loc: content ? content.split("\n").length : 0 }]);
              cb.onEvent?.("graph/node_start", { node: "code_graph_update", turn, file: rel });
            } else {
              await removeNode(sessionId, rel); // 文件被删 → 图谱节点同步移除
            }
          } catch {}
        }
      }
    }
    cb.onEvent?.("graph/node_end", { node: "tool_node", turn, round, ok: !approvalBlocked });
    if (approvalBlocked) break; // 已要求审批：等待用户操作，不再继续烧 LLM 轮次
  }

  if (!lastReply && llmError) {
    lastReply = `出错: ${llmError}`;
    await appendEvent({ sessionId, type: "assistant/message", data: { content: lastReply, turn, error: llmError } });
    cb.onEvent?.("assistant/message", { content: lastReply, turn, error: llmError });
  } else if (!lastReply && !stopped) {
    // 工具轮次耗尽：要求模型基于已获得的工具信息综合作答，而不是空手结束
    // （用户手动停止时跳过——此时不应写入误导性的"已达最大轮次"消息）
    lastReply = "已达到最大工具调用轮次。请基于已获取的工具结果综合回答；如信息仍不足，可调整设置中的「最大工具调用轮次」后继续。";
    await appendEvent({ sessionId, type: "assistant/message", data: { content: lastReply, turn } });
    cb.onEvent?.("assistant/message", { content: lastReply, turn });
  }
  cb.onEvent?.("graph/turn_end", { turn });
  // 自动记忆：每轮结束后异步提炼值得长期记住的事实/偏好。
  // 异步执行不阻塞主链路；失败静默。审批阻塞轮（等待用户操作）不提炼。
  if (settings.autoMemory && lastReply && !llmError && !stopped && !lastReply.startsWith("需要审批")) {
    extractAutoMemory(sessionId, userText, lastReply, settings, provider, activeModel).catch(() => {});
  }
  return { reply: lastReply, error: llmError };
}

// 自动记忆提炼：把本轮对话要点压缩成 key/value 事实写入 auto 命名空间
async function extractAutoMemory(
  sessionId: string,
  userText: string,
  reply: string,
  settings: AgentSettings,
  provider: ModelProvider | null,
  model: ModelConfig | null,
): Promise<void> {
  if (!provider || !model) return;
  const messages: ChatMessage[] = [
    { role: "system", content: "你是长期记忆提取器。从对话中提取值得跨会话长期记住的事实、用户偏好、明确决定（例如：技术选型、用户身份、项目约定、个人偏好）。忽略一次性任务细节。用户明确表达的偏好（回复风格、语言习惯、技术栈偏好、工作方式等）优先提取。严格输出 JSON 数组，每项 {\"key\":\"≤20字标签\",\"value\":\"≤120字事实\",\"pref\":true(仅当这是用户偏好)}，没有可记内容时输出 []，不要任何多余文字。" },
    { role: "user", content: `用户：${userText.slice(0, 500)}\n\n助手：${reply.slice(0, 800)}` },
  ];
  const r = await llmStreamChat(messages, { model: model.name, temperature: 0.2, maxTokens: 500, thinkingEnabled: false, provider });
  let raw = (r.content || "").trim();
  raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = raw.indexOf("["); const end = raw.lastIndexOf("]");
  if (start >= 0 && end > start) raw = raw.slice(start, end + 1);
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return;
  for (const item of parsed.slice(0, 6)) {
    if (!item || typeof item !== "object") continue;
    const key = String(item.key ?? "").trim().slice(0, 40);
    const value = String(item.value ?? "").trim().slice(0, 300);
    if (!key || !value) continue;
    if (item.pref === true || key.startsWith("偏好")) {
      // 用户偏好：存入 prefs 命名空间，注入上下文时优先级最高
      await saveMemory("prefs", key.startsWith("偏好") ? key : `偏好-${key}`, value).catch(() => {});
    } else {
      await saveMemory("auto", key, value).catch(() => {});
    }
  }
}

// ── 上下文构建与贬值压缩 ──────────────────────────────────────────────
// 原始完整会话永远保存在事件流与时间轴快照中；compact 只改变"传给大模型的内容"。

// 粗估 token 数（中英混合每 token 约 2.5 字符）
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2.5) + 8;
}

interface HistoryItem { seq: number; role: "user" | "assistant"; content: string; }

// 读取会话事件流（解析 data JSON）
async function loadEvents(sessionId: string): Promise<{ seq: number; type: string; data: Record<string, any> }[]> {
  const rows = await db.sessionEvent.findMany({ where: { sessionId }, orderBy: { seq: "asc" } });
  return rows.map((r) => ({ seq: r.seq, type: r.type, data: JSON.parse(r.data) }));
}

// 事件流 → 带事件锚点(seq)的对话条目
function projectHistoryItems(events: { seq: number; type: string; data: Record<string, any> }[]): HistoryItem[] {
  const items: HistoryItem[] = [];
  for (const e of events) {
    const data = e.data || {};
    if (e.type === "user/message") items.push({ seq: e.seq, role: "user", content: data.content });
    else if (e.type === "assistant/message") {
      const toolCalls = data.toolCalls as ToolCall[] | undefined;
      if (toolCalls?.length) {
        // 系统注记式表述：避免模型把历史里的调用表示法当成自己的输出复述
        const toolParts = toolCalls.map((tc) => `${tc.name}（参数：${JSON.stringify(tc.arguments).slice(0, 300)}）`).join("；");
        items.push({ seq: e.seq, role: "assistant", content: data.content ? `${data.content}\n[系统注记] 助手此前调用了工具 ${toolParts}，工具结果见下一条消息。` : `[系统注记] 助手此前调用了工具 ${toolParts}，工具结果见下一条消息。` });
      } else items.push({ seq: e.seq, role: "assistant", content: data.content });
    } else if (e.type === "tool/result") items.push({ seq: e.seq, role: "user", content: `[工具结果 ${data.name}] ${data.content}\n\n如果任务尚未完成，请继续调用工具；如果已经完成，请给出最终答案。` });
    else if (e.type === "tool/error") items.push({ seq: e.seq, role: "user", content: `[工具错误 ${data.name}] ${data.content}\n\n请根据错误调整后重试，或者给出最终答案。` });
  }
  return items.filter((i) => typeof i.content === "string" && i.content.length > 0);
}

// 取某类元数据（goal/plan）的最新值；空内容视为已清除
function lastMeta(events: { seq: number; type: string; data: Record<string, any> }[], type: "session/goal" | "session/plan"): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === type) {
      const c = events[i].data?.content;
      return typeof c === "string" && c.trim() ? c : null;
    }
  }
  return null;
}

// 系统提示 = PERSONA + 风格/语言/附加指令 + 会话目标 + 执行计划（全程约束 Agent 行为）
function personaText(settings: AgentSettings | undefined, goal: string | null, plan: string | null): string {
  let persona = PERSONA;
  if (settings?.responseStyle === "concise") persona += "\n\n## 回复风格\n简洁：直接给出答案，不废话，尽量用一句话或列表。";
  else if (settings?.responseStyle === "detailed") persona += "\n\n## 回复风格\n详细：给出完整解释，包含背景、步骤和注意事项。";
  if (settings?.language === "en") persona += "\n\n## 语言\nAlways respond in English.";
  else if (settings?.language === "auto") persona += "\n\n## 语言\nMatch the user's language.";
  if (settings?.systemPromptExtra?.trim()) persona += "\n\n## 附加指令\n" + settings.systemPromptExtra.trim();
  if (goal) persona += `\n\n## 会话总目标（全局约束，所有行为围绕它展开）\n${goal}`;
  if (plan) persona += `\n\n## 执行计划（严格对照推进；完成一项在回复中简要确认）\n${plan}`;
  return persona;
}

// 摘要压缩：老历史 → 高密度摘要（goal/plan/关键工具结果/时间轴锚点必须保留）
// LLM 摘要失败/为空时降级为机械拼接摘要，保证 compact 永不因摘要失败而失效。
async function summarizeItems(provider: ModelProvider | null, model: ModelConfig, items: HistoryItem[], prevSummary: string | null): Promise<string | null> {
  const render = items
    .map((i) => `[#${i.seq}] ${i.role === "user" ? "用户" : "助手"}: ${i.content.slice(0, 2000)}`)
    .join("\n\n")
    .slice(0, 60000);
  const fallback = () => {
    const parts = [prevSummary ? `[此前摘要]\n${prevSummary.slice(0, 800)}` : null, ...items.map((i) => `[#${i.seq}] ${i.role === "user" ? "用户" : "助手"}: ${i.content.slice(0, 260).replace(/\s+/g, " ")}`)];
    return `[机械摘要（LLM 摘要不可用时的降级）]\n` + parts.filter(Boolean).join("\n");
  };
  const messages: ChatMessage[] = [
    { role: "system", content: "你是上下文压缩器。把给定的对话历史压缩成高密度摘要，供后续对话作为早期记忆使用。\n必须保留：①任务目标与关键决策 ②工具调用及其结果要点 ③关键文件路径/数据/结论 ④时间轴锚点（事件#seq，便于回溯）。\n要求：中文，300-600 字，分节列点，不丢事实，不添加未出现的内容。" },
    { role: "user", content: `${prevSummary ? `[上一次压缩的摘要，可合并提炼]\n${prevSummary}\n\n` : ""}[待压缩历史]\n${render}` },
  ];
  try {
    // 思考型模型的思维链也消耗输出 token，预算必须给足
    const r = await llmStreamChat(messages, {
      model: model.name,
      temperature: 0.3,
      maxTokens: 4000,
      thinkingEnabled: false,
      provider,
    });
    return r.content?.trim() || fallback();
  } catch {
    return fallback();
  }
}

// 自动/手动贬值压缩：达到模型配置的告警阈值时后台静默执行
async function maybeAutoCompact(
  sessionId: string,
  settings: AgentSettings,
  provider: ModelProvider | null,
  model: ModelConfig | null,
  cb?: AgentCallbacks,
  force = false,
): Promise<boolean> {
  if (!model || !model.contextWindow || model.contextWindow < 4096) return false;
  const threshold = model.compactThreshold ?? 70;
  if (!force && threshold >= 100) return false; // 100 = 关闭自动压缩

  const events = await loadEvents(sessionId);
  const goal = lastMeta(events, "session/goal");
  const plan = lastMeta(events, "session/plan");
  const persona = personaText(settings, goal, plan);
  const lastCompact = events.filter((e) => e.type === "context/compacted").at(-1);
  const keptFrom = lastCompact?.data?.keptFromSeq ?? 0;
  const recentItems = projectHistoryItems(events).filter((i) => i.seq >= keptFrom);

  const used = estimateTokens(persona)
    + (lastCompact?.data?.summary ? estimateTokens(lastCompact.data.summary) : 0)
    + recentItems.reduce((s, i) => s + estimateTokens(i.content), 0);
  const pct = (used / model.contextWindow) * 100;
  if (!force && pct < threshold) return false;
  if (recentItems.length === 0) return false;

  // 保留集：最新内容约占窗口 45%，其余进入摘要
  const keepBudget = Math.max(Math.floor(model.contextWindow * 0.45) - estimateTokens(persona) - 512, 0);
  const kept: HistoryItem[] = [];
  let keptTokens = 0;
  for (let i = recentItems.length - 1; i >= 0; i--) {
    const cost = estimateTokens(recentItems[i].content);
    if (keptTokens + cost > keepBudget && kept.length > 0) break;
    keptTokens += cost;
    kept.unshift(recentItems[i]);
  }
  const keptFromSeq = kept[0]?.seq ?? (events[events.length - 1]?.seq ?? 0) + 1;
  const toSummarize = recentItems.filter((i) => i.seq < keptFromSeq);
  if (toSummarize.length === 0) return false;

  const summary = await summarizeItems(provider, model, toSummarize, lastCompact?.data?.summary ?? null);
  if (!summary) return false; // 摘要失败就不压缩，保持原上下文重试

  const data = {
    summary,
    keptFromSeq,
    uptoSeq: events[events.length - 1]?.seq ?? 0,
    beforeTokens: used,
    afterTokens: estimateTokens(persona) + estimateTokens(summary) + keptTokens,
    window: model.contextWindow,
    threshold,
    manual: force,
  };
  await appendEvent({ sessionId, type: "context/compacted", data });
  cb?.onEvent?.("context/compacted", data);
  return true;
}

// 手动压缩入口（/compact 与 socket chat:compact）
export async function compactNow(sessionId: string, cb?: AgentCallbacks): Promise<{ ok: boolean; reason?: string }> {
  const settings = await getSettings();
  const provider = resolveProvider(settings);
  const model = activeModelOf(provider);
  if (!provider || !model) return { ok: false, reason: "未配置模型供应商" };
  const ok = await maybeAutoCompact(sessionId, settings, provider, model, cb, true);
  return ok ? { ok: true } : { ok: false, reason: "当前上下文没有可压缩的早期内容" };
}

// 生成执行计划（/plan 与 socket chat:plan）：基于当前上下文 + goal
export async function generatePlan(sessionId: string, cb?: AgentCallbacks): Promise<{ ok: boolean; plan?: string; reason?: string }> {
  const settings = await getSettings();
  const provider = resolveProvider(settings);
  const model = activeModelOf(provider);
  if (!provider || !model) return { ok: false, reason: "未配置模型供应商" };

  const events = await loadEvents(sessionId);
  const goal = lastMeta(events, "session/goal");
  const items = projectHistoryItems(events).slice(-40);
  const transcript = items.map((i) => `${i.role === "user" ? "用户" : "助手"}: ${i.content.slice(0, 1500)}`).join("\n\n").slice(0, 50000);

  const messages: ChatMessage[] = [
    { role: "system", content: "你是规划专家。基于会话目标与已有对话，产出一份结构化执行计划。格式：\n## 目标\n## 阶段（每阶段：任务 / 验收标准）\n## 关键风险与对策\n## 下一步\n中文，markdown，克制务实，可直接执行。" },
    { role: "user", content: `${goal ? `[会话总目标]\n${goal}\n\n` : ""}[会话上下文]\n${transcript || "（暂无对话）"}\n\n请生成执行计划。` },
  ];
  try {
    const r = await llmStreamChat(messages, {
      model: model.name,
      temperature: 0.4,
      maxTokens: 4000,
      thinkingEnabled: false,
      provider,
    });
    const plan = r.content?.trim();
    if (!plan) return { ok: false, reason: "生成结果为空" };
    const data = { content: plan, turn: 0 };
    await appendEvent({ sessionId, type: "session/plan", data });
    cb?.onEvent?.("session/plan", data);
    return { ok: true, plan };
  } catch (err: any) {
    return { ok: false, reason: err?.message || String(err) };
  }
}

// 上下文用量估算（供 UI 展示）：与自动压缩同一套口径
export async function estimateContextUsage(sessionId: string): Promise<{ tokens: number; window: number; pct: number; threshold: number; messageCount: number } | null> {
  const settings = await getSettings();
  const provider = resolveProvider(settings);
  const model = activeModelOf(provider);
  if (!model || !model.contextWindow || model.contextWindow < 4096) return null;
  const events = await loadEvents(sessionId);
  const goal = lastMeta(events, "session/goal");
  const plan = lastMeta(events, "session/plan");
  const persona = personaText(settings, goal, plan);
  const lastCompact = events.filter((e) => e.type === "context/compacted").at(-1);
  const keptFrom = lastCompact?.data?.keptFromSeq ?? 0;
  const recentItems = projectHistoryItems(events).filter((i) => i.seq >= keptFrom);
  const used = estimateTokens(persona)
    + (lastCompact?.data?.summary ? estimateTokens(lastCompact.data.summary) : 0)
    + recentItems.reduce((s, i) => s + estimateTokens(i.content), 0);
  return {
    tokens: used,
    window: model.contextWindow,
    pct: Math.round((used / model.contextWindow) * 1000) / 10,
    threshold: model.compactThreshold ?? 70,
    messageCount: recentItems.length,
  };
}

// 供 runTurn 使用的上下文入口：先做阈值检查/自动压缩，再构建 LLM 消息
async function buildContextHistory(
  sessionId: string,
  settings: AgentSettings,
  provider: ModelProvider | null,
  model: ModelConfig | null,
  cb?: AgentCallbacks,
): Promise<ChatMessage[]> {
  await maybeAutoCompact(sessionId, settings, provider, model, cb).catch(() => {});
  return buildHistory(sessionId, settings, settings.contextWindow || 24, model);
}

async function buildHistory(sessionId: string, settings?: AgentSettings, maxMessages = 24, model?: ModelConfig | null): Promise<ChatMessage[]> {
  const events = await loadEvents(sessionId);
  const goal = lastMeta(events, "session/goal");
  const plan = lastMeta(events, "session/plan");
  // 工作区代码图谱：已建立时注入系统上下文，让模型始终感知项目结构
  let graphCtx = "";
  try {
    const graphNodes = await getGraph(sessionId);
    if (graphNodes.length > 0) graphCtx = graphToContext(graphNodes);
  } catch {}
  // 长期记忆：偏好（prefs，最高优先级）+ 手动（default）+ 自动（auto）三路注入，置顶优先
  let memoryCtx = "";
  try {
    const [prefs, manual, auto] = await Promise.all([recallMemory("prefs"), recallMemory("default"), recallMemory("auto")]);
    const seen = new Set<string>();
    const memories = [...prefs, ...manual, ...auto].filter((m) => {
      if (seen.has(m.key)) return false;
      seen.add(m.key);
      return true;
    }).slice(0, 14);
    if (memories.length > 0) {
      const lines = memories.map((m) => {
        const tag = m.namespace === "prefs" ? "偏好" : m.namespace === "auto" ? "自动" : "手动";
        return `- [${tag}]${m.key}: ${String(m.value).replace(/\s+/g, " ").slice(0, 200)}${m.pinned ? "（置顶）" : ""}`;
      });
      memoryCtx = `\n\n## 长期记忆（${prefs.length} 条偏好 + ${manual.length} 条手动 + ${auto.length} 条自动；偏好优先级最高，请优先遵守；需要时可调用 memory_save/memory_recall 更新或查阅）\n${lines.join("\n")}`;
    }
  } catch {}
  // 最近改动的文件：从工具调用事件提取（write/edit/patch/str_replace_editor），让 Agent 持续感知自己改过什么
  let touchedCtx = "";
  try {
    const touched: string[] = [];
    const evts = events.filter((e) => e.type === "tool/call");
    for (let i = evts.length - 1; i >= 0 && touched.length < 8; i--) {
      const tc = evts[i].data?.toolCall;
      if (!tc) continue;
      if (["write", "edit", "patch", "str_replace_editor", "pwsh"].includes(tc.name)) {
        const paths = extractTouchedPaths(tc.name, tc.arguments || {}, process.cwd());
        for (const rel of paths) {
          if (!touched.includes(rel)) touched.push(rel);
          if (touched.length >= 8) break;
        }
      }
    }
    if (touched.length) {
      touchedCtx = `\n\n## 本会话最近改动的文件（继续修改时优先关注；可先用 read 查看当前内容）\n${touched.map((t) => `- ${t}`).join("\n")}`;
    }
  } catch {}
  const persona = personaText(settings, goal, plan) + graphCtx + memoryCtx + touchedCtx;

  // compact 之后只保留锚点之后的消息，摘要作为首条上下文
  const lastCompact = events.filter((e) => e.type === "context/compacted").at(-1);
  const keptFrom = lastCompact?.data?.keptFromSeq ?? 0;
  const history: ChatMessage[] = projectHistoryItems(events)
    .filter((i) => i.seq >= keptFrom)
    .map((i) => ({ role: i.role, content: i.content }));
  const summaryLead: ChatMessage | null = lastCompact?.data?.summary
    ? { role: "user", content: `[早期对话摘要（事件 #0–#${lastCompact.data.uptoSeq}；原始完整记录保存在时间轴快照，可回溯恢复）]\n${lastCompact.data.summary}` }
    : null;

  // 双重裁剪：① 消息条数（粘性窗口：超过 窗口+8 条才一次性收缩，减少前缀漂移）
  // ② token 预算（按模型配置的上下文窗口，预留系统提示与最大输出）
  // 注意：不能 slice(1) 丢弃摘要后的首条消息——compact 后第一条用户消息会被误删，导致模型看不到用户诉求
  const contextWindow = model?.contextWindow;
  const trimmable = history;
  let kept = trimmable.length <= maxMessages + 8 ? trimmable : trimmable.slice(-maxMessages);
  if (contextWindow && contextWindow >= 4096) {
    const budget = contextWindow - estimateTokens(persona) - (summaryLead ? estimateTokens(summaryLead.content) : 0) - (settings?.maxTokens ?? 4096) - 512;
    if (budget > 0) {
      const out: ChatMessage[] = [];
      let used = 0;
      for (let i = kept.length - 1; i >= 0; i--) {
        const cost = estimateTokens(kept[i].content);
        if (used + cost > budget && out.length > 0) break;
        used += cost;
        out.unshift(kept[i]);
      }
      kept = out;
    }
  }
  return [{ role: "system", content: persona }, ...(summaryLead ? [summaryLead] : []), ...kept];
}
