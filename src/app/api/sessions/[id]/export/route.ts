import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getEvents } from "@/lib/nexus/events";

// 会话导出：把事件流 + 决策 + 标题/标签打包成 JSON，可下载或复制到其他 NEXUS 实例导入。
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await db.session.findUnique({ where: { id } });
  if (!session) return NextResponse.json({ error: "会话不存在" }, { status: 404 });

  const events = await getEvents(id);
  const decisions = await db.decision.findMany({ where: { sessionId: id }, orderBy: { turn: "asc" } });

  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    session: {
      title: session.title,
      pinned: session.pinned,
      tags: (() => { try { const v = JSON.parse(session.tags || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } })(),
    },
    events: events.map((e) => ({ type: e.type, data: e.data, createdAt: e.createdAt })),
    decisions: decisions.map((d) => ({
      turn: d.turn,
      provider: d.provider,
      model: d.model,
      protocol: d.protocol,
      thinking: d.thinking,
      hasToolCalls: d.hasToolCalls,
      toolCalls: (() => { try { return JSON.parse(d.toolCalls || "[]"); } catch { return []; } })(),
      contextSummary: d.contextSummary,
      durationMs: d.durationMs,
      createdAt: d.createdAt.toISOString(),
    })),
  };

  return NextResponse.json(data);
}
