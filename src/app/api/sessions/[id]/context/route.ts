import { NextRequest, NextResponse } from "next/server";
import { estimateContextUsage } from "@/lib/nexus/agent";

// 上下文用量估算：{tokens, window, pct, threshold, messageCount}，供 UI 展示占用率与压缩提示
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const usage = await estimateContextUsage(id).catch(() => null);
  return NextResponse.json({ usage });
}
