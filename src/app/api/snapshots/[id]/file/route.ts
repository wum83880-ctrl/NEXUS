import { NextRequest, NextResponse } from "next/server";
import { restoreSnapshotFile } from "@/lib/nexus/snapshot";

// 从快照恢复单个文件到工作区
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const path = typeof body.path === "string" ? body.path : "";
  if (!path) return NextResponse.json({ error: "缺少 path" }, { status: 400 });
  const result = await restoreSnapshotFile(id, path);
  if (!result.ok) return NextResponse.json({ error: result.error || "恢复失败" }, { status: 400 });
  return NextResponse.json({ ok: true, path: result.path });
}
