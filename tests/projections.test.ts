/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { projectGraph, projectMessages } from "../src/lib/nexus/projections";
import type { SessionEvent } from "../src/lib/nexus/types";

function evt(partial: Partial<SessionEvent> & Pick<SessionEvent, "type" | "data" | "seq">): SessionEvent {
  return {
    id: `e-${partial.seq}`,
    sessionId: "s1",
    createdAt: new Date().toISOString(),
    ...partial,
  } as SessionEvent;
}

describe("projectGraph", () => {
  test("builds topology for one turn", () => {
    const events = [
      evt({ seq: 1, type: "graph/turn_start", data: { turn: 1 } }),
      evt({ seq: 2, type: "user/message", data: { content: "hi", turn: 1 } }),
      evt({ seq: 3, type: "assistant/message", data: { content: "hello", turn: 1 } }),
      evt({ seq: 4, type: "graph/turn_end", data: { turn: 1 } }),
    ];
    const graph = projectGraph(events);
    expect(graph.currentTurn).toBe(1);
    expect(graph.nodes.length).toBeGreaterThanOrEqual(3);
    expect(graph.edges.length).toBeGreaterThanOrEqual(2);
  });

  test("records tool node metadata", () => {
    const events = [
      evt({ seq: 1, type: "graph/turn_start", data: { turn: 1 } }),
      evt({ seq: 2, type: "tool/call", data: { toolCall: { id: "c1", name: "echo", arguments: { text: "x" } }, turn: 1 } }),
      evt({ seq: 3, type: "tool/result", data: { toolCallId: "c1", name: "echo", content: "x", turn: 1 } }),
    ];
    const graph = projectGraph(events);
    const toolNode = graph.nodes.find((n) => n.kind === "tool");
    expect(toolNode).toBeDefined();
    expect((toolNode as any).meta?.args?.text).toBe("x");
    expect((toolNode as any).meta?.result).toBe("x");
  });
});

describe("projectMessages", () => {
  test("maps user/assistant and tool results", () => {
    const events = [
      evt({ seq: 1, type: "user/message", data: { content: "hi" } }),
      evt({ seq: 2, type: "assistant/message", data: { content: "", toolCalls: [{ id: "c1", name: "echo", arguments: {} }] } }),
      evt({ seq: 3, type: "tool/result", data: { toolCallId: "c1", name: "echo", content: "hi", status: "ok", durationMs: 1 } }),
    ];
    const messages = projectMessages(events);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].toolResults?.[0]?.content).toBe("hi");
  });
});
