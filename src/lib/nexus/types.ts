// NEXUS shared types
export type EventType =
  | "session/created" | "user/message" | "assistant/message"
  | "assistant/chunk" | "assistant/thinking" | "assistant/thinking_chunk"
  | "tool/call" | "tool/result" | "tool/error" | "tool/approval_request"
  | "graph/node_start" | "graph/node_end" | "graph/turn_start" | "graph/turn_end"
  | "decision/record" | "evidence/added" | "error"
  | "session/goal" | "session/plan" | "context/compacted";

export interface SessionEvent {
  id: string; sessionId: string; seq: number; type: EventType;
  data: Record<string, any>; createdAt: string;
}

export interface ToolCall { id: string; name: string; arguments: Record<string, any>; }
export interface ToolResult { toolCallId: string; name: string; content: string; status: "ok" | "error"; durationMs: number; }

export interface ChatMessage {
  id: string; role: "user" | "assistant" | "system"; content: string;
  thinking?: string; toolCalls?: ToolCall[]; toolResults?: ToolResult[];
  createdAt: string; streaming?: boolean;
}

export type NodeKind = "user_input" | "llm_call" | "tool_node" | "finalize" | "tool" | "decision";
export type NodeStatus = "idle" | "running" | "done" | "error";

export interface GraphNode {
  id: string; kind: NodeKind; label: string; status: NodeStatus;
  startedAt?: number; endedAt?: number; durationMs?: number; meta?: Record<string, any>;
}
export interface GraphEdge { id: string; from: string; to: string; kind: "edge" | "conditional"; }

export interface DecisionRecord {
  id: string; sessionId: string; turn: number; provider: string; model: string;
  protocol: "native" | "text"; thinking: string; hasToolCalls: boolean;
  toolCalls: ToolCall[]; contextSummary: string; durationMs: number; createdAt: string;
  inputTokens?: number; outputTokens?: number;
}

export type ClientMessage =
  | { type: "hello"; sessionId: string }
  | { type: "chat:run"; sessionId: string; message: string; turn: number }
  | { type: "chat:stop"; sessionId: string }
  | { type: "chat:plan"; sessionId: string }
  | { type: "chat:compact"; sessionId: string }
  | { type: "chat:rerun"; sessionId: string }
  | { type: "chat:graph"; sessionId: string }
  | { type: "chat:organize"; sessionId: string };

export type ServerMessage =
  | { type: "hello"; provider: string; model: string }
  | { type: "session:updated"; sessionId: string; title: string }
  | { type: "ping"; t: number }
  | { type: "chat:started"; sessionId: string; turn: number }
  | { type: "chat:done"; sessionId: string; turn: number; reply: string }
  | { type: "chat:error"; sessionId: string; turn: number; error: string }
  | { type: "chat:stopped"; sessionId: string; turn: number }
  | { type: "event"; sessionId: string; event: Omit<SessionEvent, "id" | "sessionId" | "createdAt"> & { createdAt: string } };

export interface ToolExecutionContext {
  mode?: "default" | "unrestricted";
  workspaceRoot?: string;
  sessionId?: string;
  roomId?: string;
  approved?: boolean;
}

export interface ToolDefinition {
  name: string; description: string; parameters: Record<string, any>;
  handler: (args: Record<string, any>, ctx?: ToolExecutionContext) => Promise<string>;
  requiresApproval?: boolean;
}
export interface ToolSchema { type: "function"; function: { name: string; description: string; parameters: Record<string, any>; } }

export interface SessionSummary {
  id: string; title: string; pinned: boolean; tags: string[];
  createdAt: string; updatedAt: string; messageCount: number; lastMessage?: string;
}

export type RunStatus = "idle" | "running" | "error" | "stopped";
