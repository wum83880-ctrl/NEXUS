import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const status = body.status;
  if (status !== "approved" && status !== "rejected") {
    return NextResponse.json({ error: "status 必须是 approved 或 rejected" }, { status: 400 });
  }
  const existing = await db.toolApproval.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "审批不存在" }, { status: 404 });
  // 只允许 pending → approved/rejected 单向迁移：已决审批不可重复翻转，保证审计痕迹可信
  if (existing.status !== "pending") {
    return NextResponse.json({ error: `该审批已处理（${existing.status}），不能重复操作` }, { status: 409 });
  }
  const row = await db.toolApproval.update({
    where: { id },
    data: { status, reason: body.reason || null, resolvedAt: new Date() },
  });
  return NextResponse.json({ ok: true, approval: { id: row.id, status: row.status } });
}
