// NEXUS streaming service — socket.io on port 3003.
import { createServer } from "http";
import { Server } from "socket.io";
import { runTurn, maybeAutoTitle, refineTitleInBackground, compactNow, generatePlan, nextTurn } from "@/lib/nexus/agent";
import { runGroupChat, handleUserMessage } from "@/lib/nexus/group-chat";
import { getSettings, resolveProvider } from "@/lib/nexus/settings";
import { activeModelOf } from "@/lib/nexus/provider-utils";
import { streamChat as llmStreamChat, type ChatMessage } from "@/lib/nexus/llm-client";
import { getEvents } from "@/lib/nexus/events";
import { db } from "@/lib/db";
import { scanWorkspace, upsertNodes, graphToContext, getGraph, removeNode } from "@/lib/nexus/code-graph";
import { workspaceRoot } from "@/lib/nexus/sandbox";
import type { ServerMessage } from "@/lib/nexus/types";

// 工作区锚定：stream 服务可能从任意目录启动，工具的相对路径必须解析到项目根。
// 优先环境变量；编译为 CJS 后 import.meta.url 不可用，改用 process.argv[1] 向上推。
import path from "path";
import { readFileSync, existsSync } from "fs";
import { promises as fsp } from "fs";
let projectRoot = process.env.NEXUS_WORKSPACE;
if (!projectRoot) {
  // 源码 <root>/mini-services/nexus-stream/index.ts → 上推两级；
  // 编译产物 <root>/mini-services/nexus-stream/dist/mini-services/nexus-stream/index.js → 需上推三级（多一层 dist）
  const here = path.dirname(process.argv[1] || "");
  projectRoot = /[\\/]dist[\\/]/.test(process.argv[1] || "") ? path.resolve(here, "../../..") : path.resolve(here, "../..");
}
projectRoot = path.resolve(projectRoot);
process.env.NEXUS_WORKSPACE = process.env.NEXUS_WORKSPACE || projectRoot;

// .env 加载（node 不像 Next/bun 会自动加载）：DATABASE_URL 必须指向主库，
// 否则 Prisma 按 cwd 相对解析会连到另一个空库——双库不一致的根源。
if (!process.env.DATABASE_URL) {
  const envFile = path.join(projectRoot, ".env");
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) {
        let v = m[2].trim();
        // 去行内注释（# 前导空格才算，避免把 URL 里的 # 当注释）
        v = v.replace(/\s+#.*$/, "");
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        process.env[m[1]] = v;
      }
    }
  }
}

const PORT = 3003;
const httpServer = createServer();
const io = new Server(httpServer, { path: "/", cors: { origin: "*", methods: ["GET", "POST"] }, pingTimeout: 60000, pingInterval: 25000 });
// 会话与群聊的停止标志分表存储：共用同一 Map 时，若 sessionId 与 roomId 字符串相同会互相覆盖
const stopFlagsBySession = new Map<string, { stopped: boolean }>();
const stopFlagsByRoom = new Map<string, { stopped: boolean }>();
// 运行锁：同一会话/群聊同时只允许一个 run，杜绝并发 appendEvent 的 seq 冲突与状态串扰。
// （stopFlags 只被单写者使用，不再有"覆盖导致 stop 失效"的问题。）
const runningSessions = new Set<string>();
const runningRooms = new Set<string>();

// 简易内存限流：同一连接 10 秒内最多 5 次主动操作，防止刷接口/费用滥用。
// 键用 socket.id（按连接计），避免同机多标签页/经网关后共享同一 IP 而全局误伤。
const rateMap = new Map<string, number[]>();
function rateLimit(key: string, limit = 5, windowMs = 10000): boolean {
  const now = Date.now();
  const arr = (rateMap.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    rateMap.set(key, arr);
    return false;
  }
  arr.push(now);
  rateMap.set(key, arr);
  return true;
}

function emit(socket: any, msg: ServerMessage) { socket.emit(msg.type, msg); }

// LLM 调用重试：SERVICE_BUSY/5xx 等瞬时故障重试 2 次（3s/6s 退避），其余直接抛
async function llmWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < 3; i++) {
    try { return await fn(); } catch (err: any) {
      lastErr = err;
      const msg = String(err?.message || "");
      const retryable = /503|SERVICE_BUSY|502|504|429|超时|ECONNRESET|socket hang up/i.test(msg);
      if (!retryable || i === 2) throw err;
      await new Promise((r) => setTimeout(r, (i + 1) * 3000));
    }
  }
  throw lastErr;
}
function emitGroup(socket: any, event: string, data: any) { socket.emit(event, data); }

io.on("connection", async (socket) => {
  // 同源校验：浏览器跨站连接直接断开。
  // 本地开发例外：页面跑在 :3000、socket 直连 :3003，源端口必然不同，放行 localhost/127.0.0.1。
  const origin = socket.handshake.headers.origin as string | undefined;
  const host = socket.handshake.headers.host as string | undefined;
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host) {
        const isLocalDev = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(originHost) && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
        if (!isLocalDev) {
          socket.disconnect(true);
          return;
        }
      }
    } catch {
      socket.disconnect(true);
      return;
    }
  }

  // 可选访问令牌：设置 NEXUS_ACCESS_TOKEN 后，Socket 连接必须携带该令牌。
  const accessToken = process.env.NEXUS_ACCESS_TOKEN;
  if (accessToken) {
    const authToken = socket.handshake.auth?.token || socket.handshake.query?.token || "";
    if (authToken !== accessToken) {
      socket.disconnect(true);
      return;
    }
  }

  console.log(`[nexus-stream] connected: ${socket.id}`);
  const send: (m: ServerMessage) => void = (m) => emit(socket, m);
  // 上报真实配置的默认 Provider 与当前模型
  try {
    const settings = await getSettings();
    const provider = resolveProvider(settings);
    const activeModel = activeModelOf(provider);
    send({ type: "hello", provider: provider?.name || "未配置", model: activeModel?.name || "" });
  } catch {
    send({ type: "hello", provider: "未配置", model: "" });
  }
  const ping = setInterval(() => send({ type: "ping", t: Date.now() }), 20000);

  socket.on("chat:run", async (data: { sessionId: string; message: string; turn: number }) => {
    try {
    const { sessionId, message, turn } = data;
    if (!sessionId || !message) { console.error("[chat:run] 缺参数:", JSON.stringify(data).slice(0, 100)); return; }
    if (!rateLimit(`chat:${socket.id}`)) {
      send({ type: "chat:error", sessionId, turn, error: "请求过于频繁，请稍后再试" });
      return;
    }
    if (runningSessions.has(sessionId)) {
      send({ type: "chat:error", sessionId, turn, error: "该会话正在运行中，请等待完成或先停止" });
      return;
    }
    runningSessions.add(sessionId);
    const flag = { stopped: false };
    stopFlagsBySession.set(sessionId, flag);
    // 权威轮次：客户端 turn 可能因刷新/重连从 1 重新计，与历史冲突；服务端按事件流计算
    const actualTurn = await nextTurn(sessionId).catch(() => (Number.isInteger(turn) && turn > 0 ? turn : 1));
    send({ type: "chat:started", sessionId, turn: actualTurn });
    const newTitle = await maybeAutoTitle(sessionId, message).catch(() => null);
    if (newTitle) send({ type: "session:updated", sessionId, title: newTitle });
    // 后台智能标题：不阻塞回合，完成后推送标题更新
    refineTitleInBackground(sessionId, message).then((t) => {
      if (t) send({ type: "session:updated", sessionId, title: t });
    }).catch(() => {});
    try {
      const result = await runTurn({
        sessionId, userText: message, turn: actualTurn,
        cb: {
          shouldStop: () => flag.stopped,
          onToken: (delta) => send({ type: "event", sessionId, event: { seq: -1, type: "assistant/chunk", data: { delta, turn: actualTurn }, createdAt: new Date().toISOString() } }),
          onThinking: (delta) => send({ type: "event", sessionId, event: { seq: -1, type: "assistant/thinking_chunk", data: { delta, turn: actualTurn }, createdAt: new Date().toISOString() } }),
          onEvent: (type, eventData) => send({ type: "event", sessionId, event: { seq: -1, type, data: eventData, createdAt: new Date().toISOString() } }),
        },
      });
      if (flag.stopped) send({ type: "chat:stopped", sessionId, turn: actualTurn });
      else send({ type: "chat:done", sessionId, turn: actualTurn, reply: result.reply });
    } catch (err: any) {
      console.error("[chat:run] runTurn 异常:", err?.stack || err?.message || err);
      send({ type: "chat:error", sessionId, turn: actualTurn, error: err?.message || String(err) });
    } finally { stopFlagsBySession.delete(sessionId); runningSessions.delete(sessionId); }
    } catch (outerErr: any) {
      // handler 外层兜底：前置逻辑（nextTurn/maybeAutoTitle 等）抛错时也能反馈给前端
      console.error("[chat:run] handler 异常:", outerErr?.stack || outerErr?.message || outerErr);
      send({ type: "chat:error", sessionId: data?.sessionId, turn: data?.turn, error: `服务内部错误: ${outerErr?.message || outerErr}` });
    }
  });

  socket.on("chat:stop", (data: { sessionId: string }) => {
    if (!data || typeof data !== "object" || !data.sessionId) return;
    const flag = stopFlagsBySession.get(data.sessionId);
    if (flag) flag.stopped = true;
  });

  // 审批后自动续跑：批准/拒绝工具后重发上一条用户消息，让 Agent 直接继续执行
  // （审批通过时 findPriorApproval 会命中已批准记录，不再重复弹审批）
  socket.on("chat:rerun", async (data: { sessionId: string }) => {
    if (!data || typeof data !== "object" || !data.sessionId) return;
    const { sessionId } = data;
    if (!rateLimit(`rerun:${socket.id}`)) {
      send({ type: "chat:error", sessionId, turn: 0, error: "请求过于频繁，请稍后再试" });
      return;
    }
    if (runningSessions.has(sessionId)) {
      send({ type: "chat:error", sessionId, turn: 0, error: "该会话正在运行中，请等待完成或先停止" });
      return;
    }
    // 优先用"审批触发消息"（最近一条已批准审批的 triggerMessage）精确回放；
    // 兜底用事件流最近一条用户消息。
    let lastUser: string | null = null;
    const approved = await db.toolApproval.findFirst({
      where: { sessionId, status: "approved", triggerMessage: { not: "" } },
      orderBy: { resolvedAt: "desc" },
      select: { triggerMessage: true },
    }).catch(() => null);
    if (approved?.triggerMessage) {
      lastUser = approved.triggerMessage;
    } else {
      const events = await getEvents(sessionId).catch(() => []);
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].type === "user/message" && typeof events[i].data?.content === "string") {
          lastUser = events[i].data.content;
          break;
        }
      }
    }
    if (!lastUser) {
      send({ type: "chat:error", sessionId, turn: 0, error: "没有可重放的上一条用户消息" });
      return;
    }
    runningSessions.add(sessionId);
    const flag = { stopped: false };
    stopFlagsBySession.set(sessionId, flag);
    const actualTurn = await nextTurn(sessionId).catch(() => 1);
    send({ type: "chat:started", sessionId, turn: actualTurn });
    try {
      const result = await runTurn({
        sessionId, userText: lastUser, turn: actualTurn,
        cb: {
          shouldStop: () => flag.stopped,
          onToken: (delta) => send({ type: "event", sessionId, event: { seq: -1, type: "assistant/chunk", data: { delta, turn: actualTurn }, createdAt: new Date().toISOString() } }),
          onThinking: (delta) => send({ type: "event", sessionId, event: { seq: -1, type: "assistant/thinking_chunk", data: { delta, turn: actualTurn }, createdAt: new Date().toISOString() } }),
          onEvent: (type, eventData) => send({ type: "event", sessionId, event: { seq: -1, type, data: eventData, createdAt: new Date().toISOString() } }),
        },
      });
      if (flag.stopped) send({ type: "chat:stopped", sessionId, turn: actualTurn });
      else send({ type: "chat:done", sessionId, turn: actualTurn, reply: result.reply });
    } catch (err: any) {
      console.error("[chat:rerun] runTurn 异常:", err?.stack || err?.message || err);
      send({ type: "chat:error", sessionId, turn: actualTurn, error: err?.message || String(err) });
    } finally {
      stopFlagsBySession.delete(sessionId);
      runningSessions.delete(sessionId);
    }
  });

  // 基于上下文+目标生成执行计划（/plan）
  socket.on("chat:plan", async (data: { sessionId: string }) => {
    if (!data || typeof data !== "object") return;
    const { sessionId } = data;
    if (!sessionId) return;
    if (!rateLimit(`plan:${socket.id}`)) { send({ type: "chat:error", sessionId, turn: 0, error: "请求过于频繁，请稍后再试" }); return; }
    send({ type: "event", sessionId, event: { seq: -1, type: "graph/turn_start", data: { turn: 0, note: "生成执行计划" }, createdAt: new Date().toISOString() } });
    const result = await generatePlan(sessionId, {
      onEvent: (type, eventData) => send({ type: "event", sessionId, event: { seq: -1, type, data: eventData, createdAt: new Date().toISOString() } }),
    }).catch((err: any) => ({ ok: false, reason: err?.message || String(err) }));
    if (result.ok) send({ type: "chat:done", sessionId, turn: 0, reply: "执行计划已生成并存入会话元数据。" });
    else send({ type: "chat:error", sessionId, turn: 0, error: `计划生成失败：${result.reason}` });
  });

  // 手动贬值压缩上下文（/compact）：原始记录仍完整保留在事件流与快照
  socket.on("chat:compact", async (data: { sessionId: string }) => {
    if (!data || typeof data !== "object") return;
    const { sessionId } = data;
    if (!sessionId) return;
    if (!rateLimit(`compact:${socket.id}`)) { send({ type: "chat:error", sessionId, turn: 0, error: "请求过于频繁，请稍后再试" }); return; }
    const result = await compactNow(sessionId, {
      onEvent: (type, eventData) => send({ type: "event", sessionId, event: { seq: -1, type, data: eventData, createdAt: new Date().toISOString() } }),
    }).catch((err: any) => ({ ok: false, reason: err?.message || String(err) }));
    if (result.ok) send({ type: "chat:done", sessionId, turn: 0, reply: "上下文已压缩：早期历史转为摘要，原始记录完整保留在时间轴快照。" });
    else send({ type: "chat:error", sessionId, turn: 0, error: `压缩未执行：${result.reason}` });
  });

  // 代码图谱分析（/graph）：扫描工作区 → LLM 分批归纳文件职责 → 写入图谱并注入后续上下文
  socket.on("chat:graph", async (data: { sessionId: string }) => {
    if (!data || typeof data !== "object") return;
    const { sessionId } = data;
    if (!sessionId) return;
    if (!rateLimit(`graph:${socket.id}`)) { send({ type: "chat:error", sessionId, turn: 0, error: "请求过于频繁，请稍后再试" }); return; }
    if (runningSessions.has(sessionId)) {
      send({ type: "chat:error", sessionId, turn: 0, error: "该会话正在运行中，请等待完成或先停止" });
      return;
    }
    runningSessions.add(sessionId);
    const settings = await getSettings().catch(() => null);
    const provider = resolveProvider((settings || ({ providers: [], defaultProviderId: "" } as any)));
    const model = activeModelOf(provider);
    if (!provider || !model) {
      send({ type: "chat:error", sessionId, turn: 0, error: "未配置模型供应商，请先在设置中添加" });
      return;
    }
    send({ type: "chat:started", sessionId, turn: 0 });
    send({ type: "event", sessionId, event: { seq: -1, type: "graph/turn_start", data: { turn: 0, note: "分析工作区代码图谱" }, createdAt: new Date().toISOString() } });
    try {
      const files = await scanWorkspace(workspaceRoot(), 300);
      if (files.length === 0) {
        send({ type: "chat:error", sessionId, turn: 0, error: "工作区没有可分析的代码文件" });
        return;
      }
      send({ type: "event", sessionId, event: { seq: -1, type: "assistant/chunk", data: { delta: `已扫描 ${files.length} 个文件，开始分批归纳…\n`, turn: 0 }, createdAt: new Date().toISOString() } });
      const allNodes: { id: string; summary: string; kind?: string; loc: number; imports: string[] }[] = [];
      const CHUNK = 25;
      for (let i = 0; i < files.length; i += CHUNK) {
        const chunk = files.slice(i, i + CHUNK);
        send({ type: "event", sessionId, event: { seq: -1, type: "graph/node_start", data: { node: "code_graph_analyze", turn: 0, file: chunk[0]?.rel }, createdAt: new Date().toISOString() } });
        const list = chunk.map((f, j) => `${i + j + 1}. ${f.rel}（${f.loc}行${f.imports.length ? `，依赖: ${f.imports.slice(0, 5).join(", ")}` : ""}）`).join("\n");
        const prompt: ChatMessage[] = [
          { role: "system", content: "你是代码仓库分析师。把每个文件归纳成一句话职责说明（中文 ≤ 40 字），并按内容给出 kind（源码文件=file、配置文件/清单=config、目录聚合=dir）。严格输出 JSON 数组，不要任何多余文字：\n[{\"id\":\"相对路径\",\"summary\":\"一句话职责\",\"kind\":\"file\"}]" },
          { role: "user", content: `文件清单：\n${list}` },
        ];
        try {
          const r = await llmWithRetry(() => llmStreamChat(prompt, { model: model.name, temperature: 0.2, maxTokens: 4000, thinkingEnabled: false, provider }));
          let raw = (r.content || "").trim();
          raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
          const start = raw.indexOf("["); const end = raw.lastIndexOf("]");
          if (start >= 0 && end > start) raw = raw.slice(start, end + 1);
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            for (const p of parsed) {
              if (p && typeof p.id === "string" && typeof p.summary === "string") {
                const orig = chunk.find((f) => f.rel === p.id);
                allNodes.push({ id: p.id, summary: p.summary, kind: p.kind === "config" ? "config" : "file", loc: orig?.loc || 0, imports: orig?.imports || [] });
              }
            }
          }
        } catch {
          // 单批失败跳过，不中断整体分析
        }
        send({ type: "event", sessionId, event: { seq: -1, type: "assistant/chunk", data: { delta: `第 ${Math.floor(i / CHUNK) + 1}/${Math.ceil(files.length / CHUNK)} 批完成（${allNodes.length} 个节点）\n`, turn: 0 }, createdAt: new Date().toISOString() } });
      }
      if (allNodes.length === 0) {
        // 模型不可用/余额不足等：降级写入基础结构节点，至少让用户看到项目文件树
        for (const f of files.slice(0, 300)) {
          allNodes.push({ id: f.rel, summary: "（模型暂不可用，未能生成职责摘要；供应商恢复后可重新分析）", kind: "file", loc: f.loc, imports: f.imports || [] });
        }
      }
      await upsertNodes(sessionId, allNodes);
      const nodes = await getGraph(sessionId);
      const ctx = graphToContext(nodes);
      send({ type: "event", sessionId, event: { seq: -1, type: "assistant/chunk", data: { delta: `✅ 代码图谱已建立：${nodes.length} 个节点，后续对话将自动注入项目结构认知。\n`, turn: 0 }, createdAt: new Date().toISOString() } });
      send({ type: "chat:done", sessionId, turn: 0, reply: `代码图谱分析完成：${nodes.length} 个文件节点。${ctx.slice(0, 300)}\n…` });
    } catch (err: any) {
      console.error("[chat:graph] 异常:", err?.message || err);
      send({ type: "chat:error", sessionId, turn: 0, error: `代码图谱分析失败: ${err?.message || String(err)}` });
    } finally {
      runningSessions.delete(sessionId);
    }
  });

  // 智能整理项目（/organize）：同意后让 LLM 规划并在工作区内执行安全的整理（仅移动/改名，绝不删除）
  socket.on("chat:organize", async (data: { sessionId: string }) => {
    if (!data || typeof data !== "object") return;
    const { sessionId } = data;
    if (!sessionId) return;
    if (!rateLimit(`organize:${socket.id}`)) { send({ type: "chat:error", sessionId, turn: 0, error: "请求过于频繁，请稍后再试" }); return; }
    if (runningSessions.has(sessionId)) {
      send({ type: "chat:error", sessionId, turn: 0, error: "该会话正在运行中，请等待完成或先停止" });
      return;
    }
    runningSessions.add(sessionId);
    const settings = await getSettings().catch(() => null);
    const provider = resolveProvider((settings || ({ providers: [], defaultProviderId: "" } as any)));
    const model = activeModelOf(provider);
    if (!provider || !model) {
      send({ type: "chat:error", sessionId, turn: 0, error: "未配置模型供应商，请先在设置中添加" });
      runningSessions.delete(sessionId);
      return;
    }
    send({ type: "chat:started", sessionId, turn: 0 });
    send({ type: "event", sessionId, event: { seq: -1, type: "assistant/chunk", data: { delta: "🔍 开始分析项目结构…\n", turn: 0 }, createdAt: new Date().toISOString() } });
    const root = workspaceRoot();
    const SKIP = new Set(["node_modules", ".next", ".git", ".nexus", "dist", "out", "build", ".cache", ".turbo"]);
    try {
      const files = await scanWorkspace(root, 500);
      send({ type: "event", sessionId, event: { seq: -1, type: "assistant/chunk", data: { delta: `已扫描 ${files.length} 个文件，正在制定整理方案…\n`, turn: 0 }, createdAt: new Date().toISOString() } });
      const list = files.map((f) => f.rel).join("\n");
      const prompt: ChatMessage[] = [
        { role: "system", content: "你是项目结构整理专家。分析给定文件清单，规划项目整理方案。规则：①只允许将文件移动到更合理的目录（含新建目录），禁止删除/覆盖任何文件；②目标路径必须仍在项目内；③node_modules/.next/.git/.nexus/dist/out/build 等自动生成目录内的文件不处理；④保持移动后 import 相对路径尽量稳定（同目录批量移动优先）；⑤方案要克制，只有明显不合理的结构才动。严格输出 JSON 数组，不要任何多余文字：[{\"action\":\"move\",\"from\":\"原相对路径\",\"to\":\"目标相对路径\",\"reason\":\"一句话理由\"}]，没有需要整理的内容时输出 []。" },
        { role: "user", content: `项目文件清单（相对路径）：\n${list.slice(0, 20000)}` },
      ];
      const r = await llmWithRetry(() => llmStreamChat(prompt, { model: model.name, temperature: 0.2, maxTokens: 4000, thinkingEnabled: false, provider }));
      let raw = (r.content || "").trim();
      raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
      const start = raw.indexOf("["); const end = raw.lastIndexOf("]");
      if (start >= 0 && end > start) raw = raw.slice(start, end + 1);
      let plan: any[] = [];
      try { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) plan = parsed; } catch { plan = []; }
      // 过滤合法操作
      const valid: { from: string; to: string; reason: string }[] = [];
      const seen = new Set<string>();
      for (const p of plan.slice(0, 50)) {
        if (!p || typeof p !== "object") continue;
        const from = String(p.from || "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
        const to = String(p.to || "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
        if (!from || !to || from === to) continue;
        const fromAbs = path.resolve(root, from);
        const toAbs = path.resolve(root, to);
        const inside = (p: string) => { const rel = path.relative(root, p); return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel); };
        if (!inside(fromAbs) || !inside(toAbs)) continue;
        const inSkip = (rel: string) => { const seg = rel.split("/")[0]; return SKIP.has(seg); };
        if (inSkip(from) || inSkip(to)) continue;
        if (seen.has(from)) continue;
        seen.add(from);
        valid.push({ from, to, reason: String(p.reason || "").slice(0, 80) });
      }
      if (valid.length === 0) {
        send({ type: "event", sessionId, event: { seq: -1, type: "assistant/chunk", data: { delta: "✅ 项目结构已合理，无需整理。\n", turn: 0 }, createdAt: new Date().toISOString() } });
        send({ type: "chat:done", sessionId, turn: 0, reply: "智能整理完成：项目结构已经比较合理，没有需要移动的文件。" });
        runningSessions.delete(sessionId);
        return;
      }
      send({ type: "event", sessionId, event: { seq: -1, type: "assistant/chunk", data: { delta: `📋 整理方案：${valid.length} 项移动\n`, turn: 0 }, createdAt: new Date().toISOString() } });
      // 记录旧节点摘要（用于图谱迁移）
      const graphNodes = await getGraph(sessionId).catch(() => []);
      const summaryByPath = new Map<string, string>(graphNodes.map((n) => [n.id, n.summary] as [string, string]));
      let moved = 0, failed = 0;
      for (const item of valid) {
        const fromAbs = path.resolve(root, item.from);
        const toAbs = path.resolve(root, item.to);
        try {
          const stat = await fsp.stat(fromAbs).catch(() => null);
          if (!stat || !stat.isFile()) { failed++; continue; }
          await fsp.mkdir(path.dirname(toAbs), { recursive: true });
          await fsp.rename(fromAbs, toAbs);
          moved++;
          send({ type: "event", sessionId, event: { seq: -1, type: "assistant/chunk", data: { delta: `  ✓ ${item.from} → ${item.to}${item.reason ? `（${item.reason}）` : ""}\n`, turn: 0 }, createdAt: new Date().toISOString() } });
          // 图谱迁移：旧节点删除，新节点沿用摘要并重新提取依赖
          await removeNode(sessionId, item.from).catch(() => {});
          await upsertNodes(sessionId, [{ id: item.to, summary: summaryByPath.get(item.from) || `（已从 ${item.from} 移动）`, kind: "file" }]).catch(() => {});
        } catch (err: any) {
          failed++;
          send({ type: "event", sessionId, event: { seq: -1, type: "assistant/chunk", data: { delta: `  ✗ ${item.from} → ${item.to}（${err?.message || "失败"}）\n`, turn: 0 }, createdAt: new Date().toISOString() } });
        }
      }
      send({ type: "event", sessionId, event: { seq: -1, type: "assistant/chunk", data: { delta: `✅ 整理完成：成功 ${moved} 项${failed ? `，失败 ${failed} 项` : ""}。\n`, turn: 0 }, createdAt: new Date().toISOString() } });
      send({ type: "chat:done", sessionId, turn: 0, reply: `智能整理完成：成功移动 ${moved} 个文件${failed ? `，${failed} 个失败` : ""}。可在代码图谱视图中重新分析查看最新结构。` });
    } catch (err: any) {
      console.error("[chat:organize] 异常:", err?.message || err);
      send({ type: "chat:error", sessionId, turn: 0, error: `智能整理失败: ${err?.message || String(err)}` });
    } finally {
      runningSessions.delete(sessionId);
    }
  });

  // 群聊
  socket.on("group:run", async (data: { roomId: string; task: string; rounds: number }) => {
    if (!data || typeof data !== "object") return;
    const { roomId, task, rounds } = data;
    if (!roomId || !task) return;
    if (!rateLimit(`group:${socket.id}`)) {
      emitGroup(socket, "group:error", { roomId, error: "请求过于频繁，请稍后再试" });
      return;
    }
    if (runningRooms.has(roomId)) {
      emitGroup(socket, "group:error", { roomId, error: "该群聊正在运行中，请等待完成或先停止" });
      return;
    }
    runningRooms.add(roomId);
    const flag = { stopped: false };
    stopFlagsByRoom.set(roomId, flag);
    emitGroup(socket, "group:started", { roomId });
    try {
      await runGroupChat(roomId, task, Math.min(Math.max(rounds || 2, 1), 5), {
        shouldStop: () => flag.stopped,
        onRoundStart: (round) => emitGroup(socket, "group:round_start", { roomId, round }),
        onRoundEnd: (round) => emitGroup(socket, "group:round_end", { roomId, round }),
        onMessageStart: (msg) => emitGroup(socket, "group:message_start", { roomId, message: msg }),
        onMessageChunk: (msgId, delta) => emitGroup(socket, "group:message_chunk", { roomId, msgId, delta }),
        onMessageDone: (msg) => emitGroup(socket, "group:message_done", { roomId, message: msg }),
        onAllDone: () => emitGroup(socket, "group:done", { roomId }),
      });
      if (flag.stopped) emitGroup(socket, "group:stopped", { roomId });
    } catch (err: any) {
      emitGroup(socket, "group:error", { roomId, error: err?.message || String(err) });
    } finally { stopFlagsByRoom.delete(roomId); runningRooms.delete(roomId); }
  });

  // 群聊：用户发消息，每个 agent 回应（像真人群聊）
  socket.on("group:message", async (data: { roomId: string; message: string }) => {
    if (!data || typeof data !== "object") return;
    const { roomId, message } = data;
    if (!roomId || !message) return;
    if (!rateLimit(`group:${socket.id}`)) {
      emitGroup(socket, "group:error", { roomId, error: "请求过于频繁，请稍后再试" });
      return;
    }
    if (runningRooms.has(roomId)) {
      emitGroup(socket, "group:error", { roomId, error: "该群聊正在运行中，请等待完成或先停止" });
      return;
    }
    runningRooms.add(roomId);
    const flag = { stopped: false };
    stopFlagsByRoom.set(roomId, flag);
    emitGroup(socket, "group:started", { roomId });
    try {
      await handleUserMessage(roomId, message, {
        shouldStop: () => flag.stopped,
        onMessageStart: (msg) => emitGroup(socket, "group:message_start", { roomId, message: msg }),
        onMessageChunk: (msgId, delta) => emitGroup(socket, "group:message_chunk", { roomId, msgId, delta }),
        onMessageDone: (msg) => emitGroup(socket, "group:message_done", { roomId, message: msg }),
        onAllDone: () => emitGroup(socket, "group:done", { roomId }),
      });
      if (flag.stopped) emitGroup(socket, "group:stopped", { roomId });
    } catch (err: any) {
      emitGroup(socket, "group:error", { roomId, error: err?.message || String(err) });
    } finally { stopFlagsByRoom.delete(roomId); runningRooms.delete(roomId); }
  });

  socket.on("group:stop", (data: { roomId: string }) => {
    if (!data || typeof data !== "object" || !data.roomId) return;
    const flag = stopFlagsByRoom.get(data.roomId);
    if (flag) flag.stopped = true;
  });

  socket.on("disconnect", () => {
    clearInterval(ping);
    // 限流桶随连接释放，避免 socket.id 键永久驻留造成内存缓慢泄漏
    rateMap.delete(`chat:${socket.id}`);
    rateMap.delete(`group:${socket.id}`);
    rateMap.delete(`plan:${socket.id}`);
    rateMap.delete(`compact:${socket.id}`);
    rateMap.delete(`graph:${socket.id}`);
    rateMap.delete(`rerun:${socket.id}`);
  });
});

// 只绑定本机回环：默认不向局域网暴露 LLM 调用/文件工具能力。
// 如需局域网访问：改为 0.0.0.0 并务必设置 NEXUS_ACCESS_TOKEN（前端 NEXT_PUBLIC_NEXUS_ACCESS_TOKEN）。
// 监听地址：默认回环；NEXUS_BIND=0.0.0.0 可暴露到局域网（务必配合 NEXUS_ACCESS_TOKEN）
const BIND = process.env.NEXUS_BIND || "127.0.0.1";
httpServer.listen(PORT, BIND, () => { console.log(`[nexus-stream] listening on ${BIND}:${PORT}`); });
process.on("SIGTERM", () => { httpServer.close(() => process.exit(0)); });
process.on("SIGINT", () => { httpServer.close(() => process.exit(0)); });

// 全局错误兜底：单个未捕获的异步拒绝/异常只记录日志，绝不杀死整个服务（否则前端永久"已断开"）
process.on("unhandledRejection", (reason) => {
  console.error("[nexus-stream] unhandledRejection:", reason instanceof Error ? (reason.stack || reason.message) : String(reason));
});
process.on("uncaughtException", (err) => {
  console.error("[nexus-stream] uncaughtException:", err?.stack || err?.message || err);
});
