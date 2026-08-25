import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createSnapshot } from "@/lib/nexus/snapshot";

// 时间回溯：把会话事件流回退到 eventSeq。
// 先对"当前状态"做一次保护性快照（reason=before_rewind），误回退也能再回来。
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const eventSeq = Number(body.eventSeq);
  if (!Number.isInteger(eventSeq) || eventSeq < 0) {
    return NextResponse.json({ error: "eventSeq 必须是非负整数" }, { status: 400 });
  }
  const session = await db.session.findUnique({ where: { id } }).catch(() => null);
  if (!session) return NextResponse.json({ error: "会话不存在" }, { status: 404 });

  try {
    // 保护性快照：记录回退前的最新游标（失败不阻断回退，但响应里如实反馈）
    const guard = await createSnapshot({
      sessionId: id,
      label: `回溯前 · 事件 #${eventSeq}`,
      reason: "before_rewind",
    }).catch(() => null);

    // 决策截断基准：取"保留事件中最大的 turn"。
    // 不能用最后一条事件的 turn——compact/approval_request/created 等事件没有 turn 字段，
    // 否则 lastTurn=null 时决策一行都不删，残留已回退轮次的决策。
    const keptEvents = await db.sessionEvent.findMany({ where: { sessionId: id }, select: { data: true } });
    let lastTurn: number | null = null;
    for (const e of keptEvents) {
      try {
        const t = JSON.parse(e.data)?.turn;
        if (typeof t === "number" && (lastTurn == null || t > lastTurn)) lastTurn = t;
      } catch {}
    }
    if (lastTurn == null) {
      const d = await db.decision.aggregate({ where: { sessionId: id }, _max: { turn: true } });
      if (d._max.turn != null) lastTurn = d._max.turn;
    }

    // 事件删除与决策删除放同一事务，避免中途失败留下半回退状态
    const ops: any[] = [db.sessionEvent.deleteMany({ where: { sessionId: id, seq: { gt: eventSeq } } })];
    if (lastTurn != null) ops.push(db.decision.deleteMany({ where: { sessionId: id, turn: { gt: lastTurn } } }));
    const [delEvents, delDecisions] = await db.$transaction(ops);

    return NextResponse.json({
      ok: true,
      sessionId: id,
      eventSeq,
      rolledBackEvents: delEvents.count,
      rolledBackDecisions: delDecisions?.count ?? 0,
      guardSnapshotId: guard?.id ?? null,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
