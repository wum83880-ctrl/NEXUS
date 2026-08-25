import { NextRequest, NextResponse } from "next/server";
import { getEvents } from "@/lib/nexus/events";
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json({ events: await getEvents(id) });
}
