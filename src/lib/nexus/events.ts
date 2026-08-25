// NEXUS event store — append-only session log
import { db } from "@/lib/db";
import type { EventType, SessionEvent } from "./types";
import { projectMessages, projectGraph, deriveTitle } from "./projections";

export { projectMessages, projectGraph, deriveTitle };

export interface AppendInput { sessionId: string; type: EventType; data: Record<string, any>; }

export async function appendEvent(input: AppendInput): Promise<SessionEvent> {
  const { sessionId, type, data } = input;
  const last = await db.sessionEvent.findFirst({ where: { sessionId }, orderBy: { seq: "desc" }, select: { seq: true } });
  const seq = (last?.seq ?? 0) + 1;
  let row;
  try {
    row = await db.sessionEvent.create({ data: { sessionId, seq, type, data: JSON.stringify(data) } });
  } catch (err: any) {
    // 并发下同一会话两个写者可能撞 @@unique([sessionId, seq])（P2002）：重查最新 seq 重试一次
    if (err?.code === "P2002") {
      const again = await db.sessionEvent.findFirst({ where: { sessionId }, orderBy: { seq: "desc" }, select: { seq: true } });
      row = await db.sessionEvent.create({ data: { sessionId, seq: (again?.seq ?? seq - 1) + 1, type, data: JSON.stringify(data) } });
    } else {
      throw err;
    }
  }
  await db.session.update({ where: { id: sessionId }, data: { updatedAt: new Date() } }).catch(() => {});
  return { id: row.id, sessionId, seq: row.seq, type, data, createdAt: row.createdAt.toISOString() };
}

export async function getEvents(sessionId: string): Promise<SessionEvent[]> {
  const rows = await db.sessionEvent.findMany({ where: { sessionId }, orderBy: { seq: "asc" } });
  return rows.map((r) => ({ id: r.id, sessionId: r.sessionId, seq: r.seq, type: r.type as EventType, data: JSON.parse(r.data), createdAt: r.createdAt.toISOString() }));
}
