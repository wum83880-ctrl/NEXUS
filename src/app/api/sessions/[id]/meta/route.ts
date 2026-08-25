import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appendEvent } from "@/lib/nexus/events";

// 会话元数据（goal / plan）设置与清除。
// body: { type: "goal" | "plan", content: string }（content 为空 = 清除）
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const kind = body.type === "plan" ? "plan" : "goal";
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const session = await db.session.findUnique({ where: { id } }).catch(() => null);
  if (!session) return NextResponse.json({ error: "会话不存在" }, { status: 404 });

  const evtType = kind === "goal" ? "session/goal" : "session/plan";
  const event = await appendEvent({
    sessionId: id,
    type: evtType,
    data: { content, cleared: content === "", turn: 0 },
  });
  return NextResponse.json({ ok: true, event, cleared: content === "" });
}
