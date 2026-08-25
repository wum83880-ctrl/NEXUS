import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appendEvent } from "@/lib/nexus/events";
import type { EventType } from "@/lib/nexus/types";

// 合法的会话事件类型白名单（导入时过滤未知/不合法类型，防止脏数据注入）
const VALID_EVENT_TYPES = new Set<EventType>([
  "session/created", "user/message", "assistant/message", "assistant/chunk",
  "assistant/thinking", "assistant/thinking_chunk", "tool/call", "tool/result",
  "tool/error", "tool/approval_request", "graph/node_start", "graph/node_end",
  "graph/turn_start", "graph/turn_end", "decision/record", "evidence/added",
  "error", "session/goal", "session/plan", "context/compacted",
]);

// 会话导入：按导出格式重建会话（事件按原顺序重放、决策重建）。
// body: { data: <export JSON> } 或直接传 { session, events, decisions }。
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const data = body.data && typeof body.data === "object" ? body.data : body;
  const events = Array.isArray(data?.events) ? data.events : [];
  const decisions = Array.isArray(data?.decisions) ? data.decisions : [];
  if (events.length === 0) {
    return NextResponse.json({ error: "导入数据中没有事件（events 为空数组）" }, { status: 400 });
  }

  const title = typeof data?.session?.title === "string" && data.session.title.trim()
    ? data.session.title.trim().slice(0, 120)
    : "导入会话";
  const session = await db.session.create({
    data: {
      title,
      pinned: !!data?.session?.pinned,
      tags: JSON.stringify(Array.isArray(data?.session?.tags) ? data.session.tags.filter((t: unknown) => typeof t === "string").slice(0, 10) : []),
    },
  });

  // 事件按原顺序重放（appendEvent 负责 seq 分配）
  let replayed = 0;
  for (const e of events) {
    if (!e || typeof e !== "object") continue;
    const type = e.type as EventType;
    if (!VALID_EVENT_TYPES.has(type)) continue;
    const payload = e.data && typeof e.data === "object" ? e.data : {};
    try {
      await appendEvent({ sessionId: session.id, type, data: { ...payload } });
      replayed++;
    } catch {
      // 单条失败跳过，不中断导入
    }
  }
  if (replayed === 0) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return NextResponse.json({ error: "没有可导入的合法事件" }, { status: 400 });
  }

  // 决策重建（按 turn 排序）
  let restoredDecisions = 0;
  for (const d of decisions) {
    if (!d || typeof d !== "object") continue;
    try {
      await db.decision.create({
        data: {
          sessionId: session.id,
          turn: Number(d.turn) || 0,
          provider: String(d.provider || ""),
          model: String(d.model || ""),
          protocol: d.protocol === "text" ? "text" : "native",
          thinking: String(d.thinking ?? ""),
          hasToolCalls: !!d.hasToolCalls,
          toolCalls: JSON.stringify(Array.isArray(d.toolCalls) ? d.toolCalls : []),
          contextSummary: String(d.contextSummary ?? ""),
          durationMs: Number(d.durationMs) || 0,
        },
      });
      restoredDecisions++;
    } catch {}
  }

  return NextResponse.json({
    ok: true,
    session: { id: session.id, title: session.title },
    replayedEvents: replayed,
    restoredDecisions,
  });
}
