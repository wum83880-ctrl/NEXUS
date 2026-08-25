import { NextRequest, NextResponse } from "next/server";
import { deleteMemory, toggleMemoryPin } from "@/lib/nexus/memory";
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) { const { id } = await params; await deleteMemory(id); return NextResponse.json({ ok: true }); }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) { const { id } = await params; const body = await req.json().catch(() => ({})); if (typeof body.pinned === "boolean") await toggleMemoryPin(id, body.pinned); return NextResponse.json({ ok: true }); }
