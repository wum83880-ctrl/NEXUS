import { NextRequest, NextResponse } from "next/server";
import { listSnapshotFiles } from "@/lib/nexus/snapshot";

// 列出快照备份中的文件（供单文件恢复选择）
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const files = await listSnapshotFiles(id);
  return NextResponse.json({ files, total: files.length });
}
