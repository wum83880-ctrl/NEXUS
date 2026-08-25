"use client";
import { create } from "zustand";
import { projectGraph } from "@/lib/nexus/projections";
import type { SessionSummary, ChatMessage, SessionEvent, GraphNode, GraphEdge, DecisionRecord, RunStatus, EventType } from "@/lib/nexus/types";

export type ViewTab = "chat" | "graph" | "timeline" | "codegraph";
export type NavSection = "sessions" | "group" | "skills" | "team" | "memory" | "mcp";

interface NexusState {
  sessions: SessionSummary[];
  activeSessionId: string | null;
  messages: ChatMessage[];
  events: SessionEvent[];
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  decisions: DecisionRecord[];
  sessionTitle: string;
  sessionPinned: boolean;
  sessionTags: string[];
  loadingSession: boolean;
  view: ViewTab;
  navSection: NavSection;
  sidebarCollapsed: boolean;
  detailsOpen: boolean;
  selectedNodeId: string | null;
  selectedDecisionId: string | null;
  // 时间回溯：当前预览的事件游标（null = 实时状态）
  timelineCursor: number | null;
  runStatus: RunStatus;
  runTurn: number;
  socketConnected: boolean;
  reconnecting: boolean;
  lastError: string | null; // 最近一次运行错误（chat:error），供视图展示真实原因
  reconnectAttempt: number;
  send: ((m: any) => void) | null;
  // 委派任务到群聊：跨面板传递 roomId 与待发送消息
  pendingGroupRoomId: string | null;
  pendingGroupMessage: string | null;
  // 排队消息：Agent 运行中输入的消息先入队，本轮完成后自动发送
  queuedMessage: string | null;

  setSessions: (s: SessionSummary[]) => void;
  setActiveSession: (id: string | null) => void;
  loadSession: (id: string, data: any) => void;
  upsertSession: (s: SessionSummary) => void;
  removeSession: (id: string) => void;
  setSessionTitle: (id: string, title: string) => void;
  setSessionPinned: (id: string, pinned: boolean) => void;
  setView: (v: ViewTab) => void;
  setNavSection: (n: NavSection) => void;
  toggleSidebar: () => void;
  setDetailsOpen: (b: boolean) => void;
  selectNode: (id: string | null) => void;
  selectDecision: (id: string | null) => void;
  setTimelineCursor: (seq: number | null) => void;
  openTimelineAt: (seq: number) => void;
  setRunStatus: (s: RunStatus, turn?: number) => void;
  setSocketConnected: (b: boolean) => void;
  setLastError: (e: string | null) => void;
  setReconnecting: (b: boolean) => void;
  setReconnectAttempt: (n: number) => void;
  setSend: (s: ((m: any) => void) | null) => void;
  setPendingGroupRoomId: (id: string | null) => void;
  setPendingGroupMessage: (msg: string | null) => void;
  setQueuedMessage: (msg: string | null) => void;
  applyLiveEvent: (event: { type: EventType; data: Record<string, any>; createdAt: string }) => void;
}

export const useNexus = create<NexusState>((set, get) => ({
  sessions: [], activeSessionId: null, messages: [], events: [], graphNodes: [], graphEdges: [],
  decisions: [], sessionTitle: "新建会话", sessionPinned: false, sessionTags: [], loadingSession: false,
  view: "chat", navSection: "sessions", sidebarCollapsed: false, detailsOpen: false,
  selectedNodeId: null, selectedDecisionId: null, timelineCursor: null,
  runStatus: "idle", runTurn: 0, socketConnected: false, reconnecting: false, reconnectAttempt: 0, send: null, lastError: null,
  pendingGroupRoomId: null, pendingGroupMessage: null, queuedMessage: null,

  setSessions: (s) => set({ sessions: s }),
  setActiveSession: (id) => set({ activeSessionId: id }),
  loadSession: (id, data) => set({
    activeSessionId: id, messages: data.messages, events: data.events,
    graphNodes: data.graph.nodes, graphEdges: data.graph.edges, decisions: data.decisions,
    sessionTitle: data.title, sessionPinned: data.pinned, sessionTags: data.tags || [],
    runStatus: "idle", runTurn: 0, selectedNodeId: null, selectedDecisionId: null, timelineCursor: null,
  }),
  upsertSession: (s) => set((st) => {
    const idx = st.sessions.findIndex((x) => x.id === s.id);
    const sessions = [...st.sessions];
    if (idx >= 0) sessions[idx] = s; else sessions.unshift(s);
    return { sessions };
  }),
  removeSession: (id) => set((st) => ({ sessions: st.sessions.filter((s) => s.id !== id), activeSessionId: st.activeSessionId === id ? null : st.activeSessionId })),
  setSessionTitle: (id, title) => set((st) => ({ sessions: st.sessions.map((s) => s.id === id ? { ...s, title } : s), sessionTitle: st.activeSessionId === id ? title : st.sessionTitle })),
  setSessionPinned: (id, pinned) => set((st) => ({ sessions: st.sessions.map((s) => s.id === id ? { ...s, pinned } : s), sessionPinned: st.activeSessionId === id ? pinned : st.sessionPinned })),
  setView: (v) => set({ view: v }),
  setNavSection: (n) => set({ navSection: n }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setDetailsOpen: (b) => set({ detailsOpen: b }),
  selectNode: (id) => set({ selectedNodeId: id, detailsOpen: id ? true : get().detailsOpen }),
  selectDecision: (id) => set({ selectedDecisionId: id, detailsOpen: id ? true : get().detailsOpen }),
  setTimelineCursor: (seq) => set({ timelineCursor: seq }),
  openTimelineAt: (seq) => set({ timelineCursor: seq, view: "timeline", navSection: "sessions" }),
  setRunStatus: (s, turn) => set((st) => ({ runStatus: s, runTurn: turn ?? st.runTurn })),
  setSocketConnected: (b) => set({ socketConnected: b }),
  setLastError: (e) => set({ lastError: e }),
  setReconnecting: (b) => set({ reconnecting: b }),
  setReconnectAttempt: (n) => set({ reconnectAttempt: n }),
  setSend: (s) => set({ send: s }),
  setPendingGroupRoomId: (id) => set({ pendingGroupRoomId: id }),
  setPendingGroupMessage: (msg) => set({ pendingGroupMessage: msg }),
  setQueuedMessage: (msg) => set({ queuedMessage: msg }),

  applyLiveEvent: (event) => {
    const { type, data, createdAt } = event;
    set((s) => {
      const liveEvent: SessionEvent = { id: `live-${Date.now()}-${s.events.length}`, sessionId: s.activeSessionId ?? "", seq: -1, type, data, createdAt };
      const events = [...s.events, liveEvent];
      const graph = projectGraph(events);
      return { events, graphNodes: graph.nodes, graphEdges: graph.edges };
    });

    if (type === "decision/record") {
      set((s) => {
        const id = data.id || `live-decision-${Date.now()}-${s.decisions.length}`;
        if (s.decisions.some((d) => d.id === id)) return {};
        const decision: DecisionRecord = {
          id,
          sessionId: s.activeSessionId ?? "",
          turn: data.turn || 0,
          provider: data.provider || "",
          model: data.model || "",
          protocol: data.protocol || "native",
          thinking: data.thinking || "",
          hasToolCalls: !!data.hasToolCalls,
          toolCalls: data.toolCalls || [],
          contextSummary: data.contextSummary || "",
          durationMs: data.durationMs || 0,
          inputTokens: data.inputTokens || 0,
          outputTokens: data.outputTokens || 0,
          createdAt,
        };
        return { decisions: [...s.decisions, decision] };
      });
    }

    if (type === "user/message") {
      // id 用 m-live- 前缀：避免被 chat-view 的 /^m-(\d+)$/ 误解析成事件 seq
      set((s) => ({ messages: [...s.messages, { id: `m-live-${Date.now()}`, role: "user", content: data.content, createdAt }] }));
    } else if (type === "assistant/message") {
      set((s) => {
        const messages = [...s.messages];
        const last = messages[messages.length - 1];
        // 最终消息替换流式占位时，必须保留此前已附着的工具结果（tool/result 事件写在上一条 assistant 消息上），
        // 否则多轮调用时工具卡片会在每轮收口后消失（直到 chat:done 重载才恢复）。
        const prevResults = last?.role === "assistant" ? last.toolResults : undefined;
        const merged: ChatMessage = { id: `m-live-${Date.now()}`, role: "assistant", content: data.content, thinking: data.thinking, toolCalls: data.toolCalls, createdAt, streaming: false };
        if (last && last.role === "assistant" && last.streaming) {
          messages[messages.length - 1] = { ...merged, toolResults: prevResults || data.toolResults };
        } else {
          messages.push({ ...merged, toolResults: data.toolResults });
        }
        return { messages };
      });
    } else if (type === "assistant/chunk") {
      set((s) => {
        const messages = [...s.messages];
        const last = messages[messages.length - 1];
        if (last && last.role === "assistant" && last.streaming) {
          messages[messages.length - 1] = { ...last, content: last.content + data.delta };
        } else {
          messages.push({ id: `m-stream-${Date.now()}`, role: "assistant", content: data.delta, createdAt, streaming: true });
        }
        return { messages };
      });
    } else if (type === "assistant/thinking_chunk") {
      set((s) => {
        const messages = [...s.messages];
        const last = messages[messages.length - 1];
        if (last && last.role === "assistant" && last.streaming) {
          messages[messages.length - 1] = { ...last, thinking: (last.thinking || "") + data.delta };
        } else {
          messages.push({ id: `m-stream-${Date.now()}`, role: "assistant", content: "", thinking: data.delta, createdAt, streaming: true });
        }
        return { messages };
      });
    } else if (type === "tool/call") {
      set((s) => {
        const messages = [...s.messages];
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === "assistant") {
            const tc = data.toolCall;
            if (!(messages[i].toolCalls || []).some((x) => x.id === tc.id)) {
              messages[i] = { ...messages[i], toolCalls: [...(messages[i].toolCalls || []), tc] };
            }
            break;
          }
        }
        return { messages };
      });
    } else if (type === "tool/result" || type === "tool/error") {
      set((s) => {
        const messages = [...s.messages];
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === "assistant") {
            if (!(messages[i].toolResults || []).some((x) => x.toolCallId === data.toolCallId)) {
              messages[i] = { ...messages[i], toolResults: [...(messages[i].toolResults || []), { toolCallId: data.toolCallId, name: data.name, content: data.content, status: data.status || (type === "tool/error" ? "error" : "ok"), durationMs: data.durationMs || 0 }] };
            }
            break;
          }
        }
        return { messages };
      });
    }
  },
}));
