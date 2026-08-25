import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await db.decision.findMany({ where: { sessionId: id }, orderBy: { turn: "asc" } });
  return NextResponse.json({ decisions: rows.map((d) => ({ id: d.id, sessionId: d.sessionId, turn: d.turn, provider: d.provider, model: d.model, protocol: d.protocol as any, thinking: d.thinking, hasToolCalls: d.hasToolCalls, toolCalls: JSON.parse(d.toolCalls), contextSummary: d.contextSummary, durationMs: d.durationMs, inputTokens: d.inputTokens, outputTokens: d.outputTokens, createdAt: d.createdAt.toISOString() })) });
}
