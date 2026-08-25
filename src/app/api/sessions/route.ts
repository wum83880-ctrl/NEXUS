import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appendEvent } from "@/lib/nexus/events";
import type { SessionSummary } from "@/lib/nexus/types";

export async function GET() {
  const sessions = await db.session.findMany({ orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }], take: 200 });
  const ids = sessions.map((s) => s.id);
  const lastEvents = await db.sessionEvent.findMany({ where: { sessionId: { in: ids }, type: { in: ["user/message", "assistant/message"] } }, orderBy: [{ sessionId: "asc" }, { seq: "desc" }] });
  const lastBySession = new Map<string, string>();
  for (const e of lastEvents) { if (!lastBySession.has(e.sessionId)) { try { lastBySession.set(e.sessionId, JSON.parse(e.data).content || ""); } catch {} } }
  const counts = await db.sessionEvent.groupBy({ by: ["sessionId"], where: { sessionId: { in: ids }, type: { in: ["user/message", "assistant/message"] } }, _count: { _all: true } });
  const countBySession = new Map<string, number>();
  for (const c of counts) countBySession.set(c.sessionId, c._count._all);
  const summaries: SessionSummary[] = sessions.map((s) => {
    let tags: string[] = [];
    try { const p = JSON.parse(s.tags || "[]"); if (Array.isArray(p)) tags = p.filter((t: any) => typeof t === "string"); } catch {}
    return { id: s.id, title: s.title, pinned: s.pinned, tags, createdAt: s.createdAt.toISOString(), updatedAt: s.updatedAt.toISOString(), messageCount: countBySession.get(s.id) ?? 0, lastMessage: lastBySession.get(s.id)?.slice(0, 120) };
  });
  return NextResponse.json({ sessions: summaries });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const title = typeof body?.title === "string" ? body.title.slice(0, 120) : "新建会话";
  const session = await db.session.create({ data: { title } });
  await appendEvent({ sessionId: session.id, type: "session/created", data: { id: session.id } });
  return NextResponse.json({ session });
}
