import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") || undefined;
  const sessionId = req.nextUrl.searchParams.get("sessionId") || undefined;
  const rows = await db.toolApproval.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(sessionId ? { sessionId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({
    approvals: rows.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      roomId: r.roomId,
      toolCallId: r.toolCallId,
      toolName: r.toolName,
      arguments: (() => { try { return JSON.parse(r.arguments || "{}"); } catch { return {}; } })(),
      status: r.status,
      riskLevel: r.riskLevel,
      modeAtRequest: r.modeAtRequest,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
    })),
  });
}
