import { NextRequest, NextResponse } from "next/server";
import { getSettings, isMaskedApiKey } from "@/lib/nexus/settings";
import { activeModelOf } from "@/lib/nexus/provider-utils";
import { normalizeProviderUrl } from "@/lib/nexus/llm-client";
import { catalogForUrl } from "@/lib/nexus/model-catalog";
import { blockedUrlReason } from "@/lib/nexus/sandbox";

// 服务端 Provider 探测：
// - mode "models"：GET /models 拉取模型列表；端点不存在（404/403 等）时回退官方模型目录
// - mode "chat"：发一条最小 chat completion，"测试通过"意味着真的能对话
// 前端传来的 Key 若为空或掩码，自动回填数据库中已保存的真实 Key。
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const mode = body.mode === "models" ? "models" : "chat";
  // 兼容旧值 "openai"
  const protocol = body.protocol === "anthropic" ? "anthropic" : body.protocol === "responses" ? "responses" : "chat-completions";
  let apiBaseUrl: string = body.apiBaseUrl || "";
  let apiKey: string = body.apiKey || "";
  let model: string = body.model || "";
  const providerId: string | undefined = body.providerId;

  // 掩码/空 Key → 用库里存的（连带地址与模型名）
  if ((!apiKey || isMaskedApiKey(apiKey)) && providerId) {
    const settings = await getSettings();
    const stored = settings.providers.find((p) => p.id === providerId);
    if (stored) {
      apiKey = stored.apiKey;
      if (!apiBaseUrl) apiBaseUrl = stored.apiBaseUrl;
      if (!model) model = activeModelOf(stored)?.name || "";
    }
  }
  if (!apiBaseUrl) return NextResponse.json({ error: "缺少 API 地址" }, { status: 400 });
  if (apiBaseUrl.length > 2048) return NextResponse.json({ error: "API 地址过长" }, { status: 400 });
  if (!apiKey) return NextResponse.json({ error: "缺少 API Key（保存过或新填均可）" }, { status: 400 });
  // SSRF 防护：与 http_request 工具同一套地址黑名单
  const blocked = blockedUrlReason(apiBaseUrl);
  if (blocked) return NextResponse.json({ error: `API 地址被安全策略拦截：${blocked}` }, { status: 400 });

  try {
    if (mode === "models") {
      const base = apiBaseUrl.replace(/\/+$/, "").replace(/\/models$/i, "");
      let ids: string[] = [];
      let liveError: string | null = null;
      try {
        const res = await fetch(`${base}/models`, {
          headers: protocol === "anthropic"
            ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
            : { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) {
          liveError = `HTTP ${res.status}`;
        } else {
          const json = await res.json().catch(() => null);
          ids = Array.isArray(json?.data)
            ? json.data.map((m: any) => m.id || m.name).filter(Boolean)
            : Array.isArray(json?.models)
              ? json.models.map((m: any) => m.id || m.name).filter(Boolean)
              : [];
        }
      } catch (e: any) {
        liveError = e?.name === "TimeoutError" ? "超时" : (e?.message || "网络错误");
      }

      // 实时列表为空 → 回退官方目录，保证拉取永远有可用结果
      if (ids.length === 0) {
        const catalog = catalogForUrl(apiBaseUrl);
        if (catalog.length > 0) {
          return NextResponse.json({
            models: catalog,
            source: "catalog",
            note: `该服务不提供模型列表接口（${liveError ?? "返回为空"}），已展示官方常用模型目录`,
          });
        }
        return NextResponse.json({
          models: [],
          source: "none",
          error: liveError ? `拉取失败（${liveError}），且无匹配的官方目录，请手动填写模型名` : "未返回模型，请手动填写模型名",
        });
      }
      return NextResponse.json({ models: ids, source: "live" });
    }

    // 真实对话测试：一条 "ping"，限制 max tokens 控制花费
    if (!model) return NextResponse.json({ error: "请先填写模型名再测试" }, { status: 400 });
    if (protocol === "anthropic") {
      const base = apiBaseUrl.replace(/\/+$/, "").replace(/\/messages$/i, "");
      const res = await fetch(`${base}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 16, messages: [{ role: "user", content: "ping" }] }),
        signal: AbortSignal.timeout(30000),
      });
      const text = await res.text().catch(() => "");
      if (!res.ok) return NextResponse.json({ error: `HTTP ${res.status}: ${text.slice(0, 300)}` }, { status: 502 });
      let reply = "";
      try {
        const json = JSON.parse(text);
        reply = (json?.content || []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("");
      } catch {}
      return NextResponse.json({ ok: true, model, reply: String(reply).slice(0, 60) });
    }
    if (protocol === "responses") {
      const base = apiBaseUrl.replace(/\/+$/, "").replace(/\/responses$/i, "");
      const res = await fetch(`${base}/responses`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, input: [{ role: "user", content: "ping" }], max_output_tokens: 16 }),
        signal: AbortSignal.timeout(30000),
      });
      const text = await res.text().catch(() => "");
      if (!res.ok) return NextResponse.json({ error: `HTTP ${res.status}: ${text.slice(0, 300)}` }, { status: 502 });
      let reply = "";
      try {
        const json = JSON.parse(text);
        reply = (json?.output || [])
          .filter((b: any) => b?.type === "message")
          .flatMap((b: any) => b?.content || [])
          .filter((c: any) => c?.type === "output_text")
          .map((c: any) => c.text)
          .join("");
      } catch {}
      return NextResponse.json({ ok: true, model, reply: String(reply).slice(0, 60) });
    }
    const url = normalizeProviderUrl(apiBaseUrl, "chat/completions");
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 8,
        stream: false,
      }),
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      return NextResponse.json({ error: `HTTP ${res.status}: ${text.slice(0, 300)}` }, { status: 502 });
    }
    let reply = "";
    try { reply = JSON.parse(text)?.choices?.[0]?.message?.content || ""; } catch {}
    return NextResponse.json({ ok: true, model, reply: String(reply).slice(0, 60) });
  } catch (err: any) {
    const msg = err?.name === "TimeoutError" ? "请求超时（15-30s），检查地址是否可达" : err?.message || String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
