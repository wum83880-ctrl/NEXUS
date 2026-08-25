import { NextRequest, NextResponse } from "next/server";
import { getSettings, resolveProvider, activeModelOf } from "@/lib/nexus/settings";
import { streamChat } from "@/lib/nexus/llm-client";
import type { ChatMessage } from "@/lib/nexus/llm-client";

// 优化提示词：模型预处理，不写入任何会话上下文。
// 输出三个版本：精准结构化 / 极简指令 / 补充细节。
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "输入为空" }, { status: 400 });
  // 输入长度上限：超大文本会直接触发高额 LLM 调用
  if (text.length > 20000) return NextResponse.json({ error: "输入过长（上限 20000 字符）" }, { status: 400 });

  const settings = await getSettings();
  const provider = resolveProvider(settings);
  const model = activeModelOf(provider);
  if (!provider || !model) {
    return NextResponse.json({ error: "未配置模型供应商，请先在设置中添加" }, { status: 400 });
  }

  const messages: ChatMessage[] = [
    { role: "system", content: `你是提示词改写引擎。把用户输入改写为三个版本，严格输出 JSON（不要任何多余文字，不要 markdown 代码块包裹）：
{"structured":"...","minimal":"...","detailed":"..."}

- structured（精准结构化版）：拆分为 目标 / 约束 / 输出格式 三段，适配 Agent 直接执行
- minimal（极简指令版）：极度精简，节约 token，保留全部必要信息
- detailed（补充细节版）：自动补全合理的边界条件、验收标准与异常处理要求

全部使用中文（保留必要的技术术语原文）。` },
    { role: "user", content: text },
  ];

  try {
    const r = await streamChat(messages, {
      model: model.name,
      temperature: 0.5,
      maxTokens: 4000,
      thinkingEnabled: false,
      provider,
    });
    let raw = (r.content || "").trim();
    // 剥离可能的 ```json 围栏
    raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) raw = raw.slice(start, end + 1);
    let parsed: any = null;
    try { parsed = JSON.parse(raw); } catch {}
    if (!parsed || typeof parsed !== "object") {
      return NextResponse.json({ error: "模型未返回有效结果，请重试" }, { status: 502 });
    }
    const pick = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : "");
    const versions = {
      structured: pick(parsed.structured),
      minimal: pick(parsed.minimal),
      detailed: pick(parsed.detailed),
    };
    if (!versions.structured && !versions.minimal && !versions.detailed) {
      return NextResponse.json({ error: "模型未返回有效结果，请重试" }, { status: 502 });
    }
    return NextResponse.json({ ok: true, versions });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 502 });
  }
}
