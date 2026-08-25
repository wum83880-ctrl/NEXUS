import { NextRequest, NextResponse } from "next/server";
import { deleteSnapshot } from "@/lib/nexus/snapshot";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteSnapshot(id);
  return NextResponse.json({ ok: true });
}
