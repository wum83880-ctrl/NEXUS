// 工作区代码图谱 API：扫描/查询
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { scanWorkspace, getGraph, upsertNodes, graphToContext } from "@/lib/nexus/code-graph";
import { promises as fs } from "fs";
import path from "path";
import { workspaceRoot } from "@/lib/nexus/sandbox";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ error: "缺少 sessionId" }, { status: 400 });
  const nodes = await getGraph(sessionId);
  // 过期检测：节点分析时间 < 文件实际修改时间 → stale（提示重新分析）
  const root = workspaceRoot();
  const withStale = await Promise.all(nodes.map(async (n) => {
    let stale = false;
    try {
      const stat = await fs.stat(path.join(root, n.id));
      if (stat.mtime.getTime() > new Date(n.updatedAt).getTime() + 1000) stale = true;
    } catch {
      // 文件已删除/不存在：同样视为需要更新
      stale = true;
    }
    return { ...n, stale };
  }));
  return NextResponse.json({ nodes: withStale });
}

// POST: 扫描工作区 → 返回文件清单（供 LLM 分析），可选直接写入占位节点
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const sessionId: string = body.sessionId || "";
  if (!sessionId) return NextResponse.json({ error: "缺少 sessionId" }, { status: 400 });

  // 确认会话存在
  const session = await db.session.findUnique({ where: { id: sessionId }, select: { id: true } });
  if (!session) return NextResponse.json({ error: "会话不存在" }, { status: 404 });

  const root = workspaceRoot();
  const files = await scanWorkspace(root);
  return NextResponse.json({
    root,
    files,
    totalFiles: files.length,
    totalLoc: files.reduce((s, f) => s + f.loc, 0),
    hint: "将 files 清单分批交给 LLM 归纳每个文件的职责，然后调 PATCH 写入图谱",
  });
}

// PATCH: 批量更新节点（LLM 分析结果回写）
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const sessionId: string = body.sessionId || "";
  const nodes = Array.isArray(body.nodes) ? body.nodes : [];
  if (!sessionId || nodes.length === 0) {
    return NextResponse.json({ error: "需要 sessionId 和 nodes 数组" }, { status: 400 });
  }
  await upsertNodes(sessionId, nodes);
  const all = await getGraph(sessionId);
  return NextResponse.json({ ok: true, totalNodes: all.length, contextPreview: graphToContext(all).slice(0, 500) });
}
