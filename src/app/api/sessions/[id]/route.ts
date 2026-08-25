import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import { db } from "@/lib/db";
import { getEvents, projectMessages, projectGraph } from "@/lib/nexus/events";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await db.session.findUnique({ where: { id } });
  if (!session) return NextResponse.json({ error: "not found" }, { status: 404 });
  const events = await getEvents(id);
  const messages = projectMessages(events);
  const graph = projectGraph(events);
  const decisions = await db.decision.findMany({ where: { sessionId: id }, orderBy: { turn: "asc" } });
  return NextResponse.json({ session: { id: session.id, title: session.title, pinned: session.pinned, tags: JSON.parse(session.tags || "[]"), createdAt: session.createdAt.toISOString(), updatedAt: session.updatedAt.toISOString() }, events, messages, graph, decisions: decisions.map((d) => ({ id: d.id, sessionId: d.sessionId, turn: d.turn, provider: d.provider, model: d.model, protocol: d.protocol as any, thinking: d.thinking, hasToolCalls: d.hasToolCalls, toolCalls: JSON.parse(d.toolCalls), contextSummary: d.contextSummary, durationMs: d.durationMs, inputTokens: d.inputTokens, outputTokens: d.outputTokens, createdAt: d.createdAt.toISOString() })) });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const data: any = {};
  if (typeof body.title === "string") data.title = body.title.slice(0, 120);
  if (typeof body.pinned === "boolean") data.pinned = body.pinned;
  if (Array.isArray(body.tags)) data.tags = JSON.stringify(body.tags.filter((t: any) => typeof t === "string").slice(0, 10));
  // 空补丁：Prisma 拒绝空 data，先明确返回 400，避免被误报成 404
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 });
  const exists = await db.session.findUnique({ where: { id }, select: { id: true } }).catch(() => null);
  if (!exists) return NextResponse.json({ error: "not found" }, { status: 404 });
  const session = await db.session.update({ where: { id }, data });
  return NextResponse.json({ session });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // 级联清理该会话的快照（Snapshot.sessionId 无 FK 级联），含文件备份目录
  const snaps = await db.snapshot.findMany({ where: { sessionId: id }, select: { fileBackupPath: true } }).catch(() => []);
  await db.session.delete({ where: { id } }).catch(() => {});
  for (const s of snaps) {
    if (s.fileBackupPath) await fs.rm(s.fileBackupPath, { recursive: true, force: true }).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}
