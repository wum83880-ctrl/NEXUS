import { NextRequest, NextResponse } from "next/server";
import { listRooms, createRoom, type GroupMember } from "@/lib/nexus/group-chat";
export async function GET() { return NextResponse.json({ rooms: await listRooms() }); }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!Array.isArray(body.members) || body.members.length === 0) return NextResponse.json({ error: "至少需要一个成员" }, { status: 400 });
  return NextResponse.json({ room: await createRoom(String(body.name || "新建群聊"), body.members as GroupMember[], String(body.task || "")) });
}
