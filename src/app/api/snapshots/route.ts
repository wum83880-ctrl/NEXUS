import { NextRequest, NextResponse } from "next/server";
import { createSnapshot, listSnapshots, recommendSnapshot } from "@/lib/nexus/snapshot";
import { promises as fs } from "fs";
import path from "path";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId") || undefined;
  const roomId = req.nextUrl.searchParams.get("roomId") || undefined;
  const snapshots = await listSnapshots({ sessionId, roomId });
  // 完整性标记：文件备份目录还在才算"可完整恢复"（事件回滚始终可用）
  const withHealth = await Promise.all(snapshots.map(async (s) => {
    let restorable = false;
    if (s.fileBackupPath) {
      restorable = await fs.stat(path.join(s.fileBackupPath, "files")).then(() => true).catch(() => false);
    }
    return { ...s, restorable };
  }));
  // 智能推荐：回溯界面默认选中的最佳恢复点
  const recommended = sessionId ? await recommendSnapshot(sessionId) : null;
  return NextResponse.json({ snapshots: withHealth, recommended });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!body.sessionId && !body.roomId) {
    return NextResponse.json({ error: "缺少 sessionId 或 roomId" }, { status: 400 });
  }
  // 校验 eventSeq/turn 边界：非法值会导致 restore 时误删/越界（如 -1 删光全部事件）
  const eventSeq = body.eventSeq === undefined || body.eventSeq === null ? undefined : Number(body.eventSeq);
  const turn = body.turn === undefined || body.turn === null ? undefined : Number(body.turn);
  if (eventSeq !== undefined && (!Number.isInteger(eventSeq) || eventSeq < 0)) {
    return NextResponse.json({ error: "eventSeq 必须是非负整数" }, { status: 400 });
  }
  if (turn !== undefined && (!Number.isInteger(turn) || turn < 0)) {
    return NextResponse.json({ error: "turn 必须是非负整数" }, { status: 400 });
  }
  try {
    const snapshot = await createSnapshot({
      sessionId: body.sessionId,
      roomId: body.roomId,
      label: body.label || "手动快照",
      reason: body.reason || "manual",
      turn,
      eventSeq,
    });
    return NextResponse.json({ snapshot });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
