import { NextRequest, NextResponse } from "next/server";
import { getRoomMessages, addMessage } from "@/lib/nexus/group-chat";
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) { const { id } = await params; return NextResponse.json({ messages: await getRoomMessages(id) }); }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) { const { id } = await params; const body = await req.json().catch(() => ({})); return NextResponse.json({ message: await addMessage({ roomId: id, senderId: "user", senderName: body.name || "我", senderRole: "用户", color: "zinc", content: String(body.content || ""), thinking: "", round: body.round || 0 }) }); }
