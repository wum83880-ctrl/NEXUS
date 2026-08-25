// NEXUS 纯前端/纯函数投影：把事件流投影成消息、图、标题。
// 这个文件不依赖 Prisma/DB，可以在客户端安全引用。
import type { SessionEvent, ChatMessage, GraphNode, GraphEdge, ToolCall, ToolResult } from "./types";

export function projectMessages(events: SessionEvent[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const toolResultsByCallId = new Map<string, ToolResult>();
  for (const e of events) {
    if (e.type === "tool/result" || e.type === "tool/error") {
      toolResultsByCallId.set(e.data.toolCallId, { toolCallId: e.data.toolCallId, name: e.data.name, content: e.data.content, status: e.type === "tool/error" ? "error" : (e.data.status as any) || "ok", durationMs: e.data.durationMs || 0 });
    }
  }
  for (const e of events) {
    if (e.type === "user/message") {
      messages.push({ id: `m-${e.seq}`, role: "user", content: e.data.content, createdAt: e.createdAt });
    } else if (e.type === "assistant/message") {
      const toolCalls = (e.data.toolCalls as ToolCall[]) || [];
      const toolResults = toolCalls.map((tc) => toolResultsByCallId.get(tc.id)).filter(Boolean) as ToolResult[];
      messages.push({ id: `m-${e.seq}`, role: "assistant", content: e.data.content, thinking: e.data.thinking, toolCalls: toolCalls.length ? toolCalls : undefined, toolResults: toolResults.length ? toolResults : undefined, createdAt: e.createdAt });
    }
  }
  return messages;
}

export function projectGraph(events: SessionEvent[]): { nodes: GraphNode[]; edges: GraphEdge[]; currentTurn: number } {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  let currentTurn = 0;
  const decisionCounts = new Map<number, number>();
  const ensureNode = (id: string, kind: GraphNode["kind"], label: string, meta?: Record<string, any>): GraphNode => {
    if (!nodes.has(id)) nodes.set(id, { id, kind, label, status: "idle", ...(meta ? { meta } : {}) });
    return nodes.get(id)!;
  };
  const ensureTopology = (turn: number) => {
    const p = `t${turn}-`;
    ensureNode(`${p}user_input`, "user_input", "user_input");
    ensureNode(`${p}llm_call`, "llm_call", "llm_call");
    ensureNode(`${p}finalize`, "finalize", "finalize");
    edges.push({ id: `e-${p}u-l`, from: `${p}user_input`, to: `${p}llm_call`, kind: "edge" });
    edges.push({ id: `e-${p}l-f`, from: `${p}llm_call`, to: `${p}finalize`, kind: "conditional" });
  };
  for (const e of events) {
    if (e.type === "graph/turn_start") {
      currentTurn = (e.data.turn as number) || currentTurn + 1;
      ensureTopology(currentTurn);
      const p = `t${currentTurn}-`;
      const u = nodes.get(`${p}user_input`)!; u.status = "running"; u.startedAt = new Date(e.createdAt).getTime();
    } else if (e.type === "graph/node_start") {
      const node = e.data.node as string; const turn = (e.data.turn as number) || currentTurn;
      const p = `t${turn}-`; const id = /^t\d+-/.test(node) ? node : `${p}${node}`;
      const kind = node.startsWith("tool:") ? "tool" : (node as any);
      const n = ensureNode(id, kind, node); n.status = "running"; n.startedAt = new Date(e.createdAt).getTime();
      if (kind === "tool") { edges.push({ id: `e-${id}-in`, from: `${p}llm_call`, to: id, kind: "conditional" }); edges.push({ id: `e-${id}-out`, from: id, to: `${p}llm_call`, kind: "edge" }); }
    } else if (e.type === "graph/node_end") {
      const node = e.data.node as string; const turn = (e.data.turn as number) || currentTurn;
      const p = `t${turn}-`; const id = /^t\d+-/.test(node) ? node : `${p}${node}`;
      const n = nodes.get(id);
      if (n) {
        n.status = e.data.ok === false ? "error" : "done";
        n.endedAt = new Date(e.createdAt).getTime();
        n.durationMs = n.startedAt && Number.isFinite(n.startedAt) ? n.endedAt - n.startedAt : undefined;
      }
    } else if (e.type === "tool/call") {
      const tc = e.data.toolCall as ToolCall; const turn = (e.data.turn as number) || currentTurn;
      const p = `t${turn}-`; const id = `${p}tool:${tc.name}:${tc.id}`;
      const n = ensureNode(id, "tool", `tool:${tc.name}`, { args: tc.arguments, toolCallId: tc.id } as any);
      n.status = "running"; n.startedAt = new Date(e.createdAt).getTime();
      edges.push({ id: `e-${id}-in`, from: `${p}llm_call`, to: id, kind: "conditional" });
      edges.push({ id: `e-${id}-out`, from: id, to: `${p}llm_call`, kind: "edge" });
    } else if (e.type === "tool/result" || e.type === "tool/error") {
      const tcId = e.data.toolCallId; const turn = (e.data.turn as number) || currentTurn;
      const p = `t${turn}-`;
      for (const n of nodes.values()) {
        if (n.kind === "tool" && (n.meta as any)?.toolCallId === tcId) {
          n.status = e.type === "tool/error" ? "error" : "done";
          n.endedAt = new Date(e.createdAt).getTime();
          n.durationMs = n.startedAt && Number.isFinite(n.startedAt) ? n.endedAt - n.startedAt : undefined;
          n.meta = { ...n.meta, result: e.data.content };
          break;
        }
      }
    } else if (e.type === "decision/record") {
      // 每次 LLM 决策成为执行图上的一个可点击节点（点开即见思维链/工具调用）
      const turn = (e.data.turn as number) || currentTurn;
      const p = `t${turn}-`;
      const idx = decisionCounts.get(turn) || 0;
      decisionCounts.set(turn, idx + 1);
      const id = `${p}decision:${idx}`;
      const n = ensureNode(id, "decision", `decision:${idx}`, { decisionIndex: idx, hasToolCalls: !!e.data.hasToolCalls, protocol: e.data.protocol || "native" } as any);
      n.status = "done";
      const ts = new Date(e.createdAt).getTime();
      n.startedAt = ts; n.endedAt = ts;
      edges.push({ id: `e-${id}-in`, from: `${p}llm_call`, to: id, kind: "edge" });
      edges.push({ id: `e-${id}-out`, from: id, to: `${p}llm_call`, kind: "edge" });
    } else if (e.type === "graph/turn_end") {
      const turn = (e.data.turn as number) || currentTurn; const p = `t${turn}-`;
      const f = nodes.get(`${p}finalize`);
      if (f) { f.status = "done"; f.endedAt = new Date(e.createdAt).getTime(); }
      // 兜底：该轮仍处于 running 的节点（缺 node_end 事件）统一置 done，
      // 避免执行图上的节点永久卡在"运行中"。
      const ts = new Date(e.createdAt).getTime();
      for (const n of nodes.values()) {
        if (n.id.startsWith(p) && n.status === "running") {
          n.status = "done";
          n.endedAt = n.endedAt ?? ts;
          n.durationMs = n.startedAt ? (n.endedAt - n.startedAt) : undefined;
        }
      }
    }
  }
  const edgeMap = new Map<string, GraphEdge>();
  for (const ed of edges) edgeMap.set(ed.id, ed);
  return { nodes: Array.from(nodes.values()), edges: Array.from(edgeMap.values()), currentTurn };
}

export function deriveTitle(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "新建会话";
  // 用码点而非 UTF-16 码元截断，避免代理对（emoji/生僻字）在 42 边界被劈开
  const chars = Array.from(clean);
  return chars.length > 42 ? chars.slice(0, 42).join("") + "…" : clean;
}
