import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// 全局消息搜索：在会话事件流（user/assistant 消息）中全文检索内容。
// 全局消息搜索：返回 { sessionId, title, seq, type, snippet }。
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  if (!q) return NextResponse.json({ results: [] });
  if (q.length > 100) return NextResponse.json({ error: "查询过长" }, { status: 400 });

  try {
    const rows = await db.sessionEvent.findMany({
      where: {
        type: { in: ["user/message", "assistant/message"] },
        data: { contains: q },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { sessionId: true, seq: true, type: true, data: true, createdAt: true },
    });
    const ids = [...new Set(rows.map((r) => r.sessionId))];
    const sessions = await db.session.findMany({
      where: { id: { in: ids } },
      select: { id: true, title: true },
    });
    const titleMap = new Map(sessions.map((s) => [s.id, s.title]));
    const results = rows.map((r) => {
      let content = "";
      try { content = String(JSON.parse(r.data)?.content || ""); } catch {}
      const idx = content.toLowerCase().indexOf(q.toLowerCase());
      const start = Math.max(0, idx - 30);
      const snippet = content.slice(start, start + 140);
      return {
        sessionId: r.sessionId,
        title: titleMap.get(r.sessionId) || "（未知会话）",
        seq: r.seq,
        type: r.type,
        snippet: (idx >= 0 ? (start > 0 ? "…" : "") + snippet : content.slice(0, 140)) + (content.length > start + 140 ? "…" : ""),
        createdAt: r.createdAt.toISOString(),
      };
    });
    return NextResponse.json({ results, total: results.length });
  } catch {
    return NextResponse.json({ results: [] });
  }
}
