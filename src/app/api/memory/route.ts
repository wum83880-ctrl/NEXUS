import { NextRequest, NextResponse } from "next/server";
import { listMemory, saveMemory } from "@/lib/nexus/memory";
export async function GET(req: NextRequest) { return NextResponse.json({ memories: await listMemory(req.nextUrl.searchParams.get("namespace") || undefined) }); }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!body.key || body.value === undefined) return NextResponse.json({ error: "缺少 key 或 value" }, { status: 400 });
  // pinned 只接受真正的布尔值：字符串 "false" 不应变成 true
  const pinned = typeof body.pinned === "boolean" ? body.pinned : false;
  return NextResponse.json({ memory: await saveMemory(String(body.namespace || "default"), String(body.key), String(body.value), pinned) });
}
