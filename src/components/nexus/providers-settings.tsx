"use client";
// 供应商管理模块：左栏供应商列表 + 右栏编辑表单。
// 每个供应商可配置多个模型；每个模型独立配置：名称 / 上下文窗口上限 / 压缩告警阈值。
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Trash2, Star, StarOff, Eye, EyeOff, Download, Check, Loader2, ChevronDown, Server, Boxes, XCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { THINKING_LEVELS, PROTOCOLS, CONTEXT_LENGTH_PRESETS } from "@/lib/nexus/constants";
import type { AgentSettings, ModelProvider, ModelConfig } from "@/lib/nexus/settings";

// 快速填充预设（协议对齐三选）
const PRESETS: { name: string; protocol: ModelProvider["protocol"]; apiBaseUrl: string; model: string }[] = [
  { name: "SenseNova", protocol: "chat-completions", apiBaseUrl: "https://api.sensenova.cn/compatible-mode/v1", model: "SenseChat-5" },
  { name: "DeepSeek", protocol: "chat-completions", apiBaseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { name: "OpenAI", protocol: "chat-completions", apiBaseUrl: "https://api.openai.com/v1", model: "gpt-4o" },
  { name: "Anthropic", protocol: "anthropic", apiBaseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-5" },
  { name: "智谱", protocol: "chat-completions", apiBaseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4.6" },
  { name: "阿里百炼", protocol: "chat-completions", apiBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  { name: "Moonshot", protocol: "chat-completions", apiBaseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  { name: "OpenRouter", protocol: "chat-completions", apiBaseUrl: "https://openrouter.ai/api/v1", model: "anthropic/claude-3.5-sonnet" },
  { name: "Gemini", protocol: "chat-completions", apiBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.0-flash" },
  { name: "Ollama", protocol: "chat-completions", apiBaseUrl: "http://localhost:11434/v1", model: "llama3.2" },
];

function genId(prefix: string) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`; }

export function ProvidersSettings({
  settings, onChange,
}: {
  settings: AgentSettings;
  onChange: (patch: Partial<AgentSettings>) => void;
}) {
  const [selectedId, setSelectedId] = useState<string>(settings.defaultProviderId || settings.providers[0]?.id || "");
  const [showKey, setShowKey] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchNote, setFetchNote] = useState<{ source: string; note?: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const provider = settings.providers.find((p) => p.id === selectedId) ?? settings.providers[0] ?? null;
  const selectedModel = provider?.models.find((m) => m.id === provider.selectedModelId) ?? provider?.models[0] ?? null;
  const isDefault = provider ? provider.id === settings.defaultProviderId : false;

  const patchProvider = (patch: Partial<ModelProvider>) => {
    if (!provider) return;
    onChange({ providers: settings.providers.map((p) => p.id === provider.id ? { ...p, ...patch } : p) });
  };
  const patchModel = (mid: string, patch: Partial<ModelConfig>) => {
    if (!provider) return;
    patchProvider({ models: provider.models.map((m) => m.id === mid ? { ...m, ...patch } : m) });
  };
  const addProvider = () => {
    const id = genId("prov");
    const p: ModelProvider = {
      id, name: `供应商 ${settings.providers.length + 1}`, protocol: "chat-completions",
      apiBaseUrl: "", apiKey: "", isDefault: settings.providers.length === 0,
      models: [{ id: genId("mdl"), name: "", contextWindow: 131072, compactThreshold: 70 }],
    };
    onChange({
      providers: [...settings.providers.map((x) => ({ ...x, isDefault: false })), p],
      defaultProviderId: settings.providers.length === 0 ? id : settings.defaultProviderId,
    });
    setSelectedId(id);
  };
  const removeProvider = () => {
    if (!provider) return;
    const rest = settings.providers.filter((p) => p.id !== provider.id);
    onChange({
      providers: rest.map((p, i) => ({ ...p, isDefault: p.id === settings.defaultProviderId || (settings.defaultProviderId === provider.id && i === 0) })),
      defaultProviderId: settings.defaultProviderId === provider.id ? (rest[0]?.id ?? "") : settings.defaultProviderId,
    });
    setSelectedId(rest[0]?.id ?? "");
  };
  const addModel = () => {
    if (!provider) return;
    const m: ModelConfig = { id: genId("mdl"), name: "", contextWindow: 131072, compactThreshold: 70 };
    patchProvider({ models: [...provider.models, m], ...(provider.selectedModelId ? {} : { selectedModelId: m.id }) });
  };
  const removeModel = (mid: string) => {
    if (!provider) return;
    const rest = provider.models.filter((m) => m.id !== mid);
    patchProvider({
      models: rest,
      selectedModelId: provider.selectedModelId === mid ? (rest[0]?.id ?? "") : provider.selectedModelId,
    });
  };
  const applyPreset = (preset: typeof PRESETS[number]) => {
    if (!provider) return;
    const existing = provider.models.some((m) => m.name === preset.model);
    patchProvider({
      name: preset.name,
      protocol: preset.protocol,
      apiBaseUrl: preset.apiBaseUrl,
      models: existing ? provider.models : [
        ...provider.models.filter((m) => m.name),
        { id: genId("mdl"), name: preset.model, contextWindow: 131072, compactThreshold: 70 },
      ],
    });
  };

  const fetchModels = async () => {
    if (!provider || !provider.apiBaseUrl) return;
    setFetching(true); setFetchNote(null);
    try {
      const res = await fetch("/api/llm-probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "models", providerId: provider.id, protocol: provider.protocol, apiBaseUrl: provider.apiBaseUrl, apiKey: provider.apiKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const names: string[] = data.models || [];
      setFetchNote({ source: data.source || "live", note: data.note });
      if (names.length) {
        const known = new Set(provider.models.map((m) => m.name).filter(Boolean));
        const fresh = names.filter((n) => !known.has(n)).map((n) => ({ id: genId("mdl"), name: n, contextWindow: 131072, compactThreshold: 70 }));
        const models = [...provider.models.filter((m) => m.name), ...fresh];
        patchProvider({ models, selectedModelId: provider.selectedModelId || models[0]?.id || "" });
      }
    } catch (e: any) {
      setFetchNote({ source: "error", note: e?.message || "拉取失败" });
    } finally {
      setFetching(false);
    }
  };

  const testConnection = async () => {
    if (!provider || !provider.apiBaseUrl) { setTestResult({ ok: false, msg: "请先填写地址" }); return; }
    if (!selectedModel?.name) { setTestResult({ ok: false, msg: "请先填写模型名" }); return; }
    setTesting(true); setTestResult(null);
    try {
      const res = await fetch("/api/llm-probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "chat", providerId: provider.id, protocol: provider.protocol, apiBaseUrl: provider.apiBaseUrl, apiKey: provider.apiKey, model: selectedModel.name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setTestResult({ ok: true, msg: `真实对话成功 · ${data.model}${data.reply ? ` · 「${data.reply}」` : ""}` });
    } catch (e: any) {
      setTestResult({ ok: false, msg: e?.message || "连接失败" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex gap-3 min-h-[420px]">
      {/* ── 左栏：供应商列表 ── */}
      <div className="w-40 shrink-0 flex flex-col border-r border-border pr-3">
        <div className="flex-1 min-h-0 space-y-1 overflow-y-auto nx-scroll">
          {settings.providers.map((p) => {
            const active = p.id === provider?.id;
            return (
              <button
                key={p.id}
                onClick={() => { setSelectedId(p.id); setTestResult(null); setFetchNote(null); }}
                className={cn(
                  "relative w-full text-left rounded-lg px-2.5 py-2 transition-colors",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {active && <motion.span layoutId="nx-prov-active" transition={{ type: "spring", stiffness: 420, damping: 34 }} className="absolute inset-0 rounded-lg bg-accent border border-nx-brand/30" />}
                <div className="relative z-10 flex items-center gap-1.5">
                  <span className={cn("size-1.5 rounded-full shrink-0", p.id === settings.defaultProviderId ? "bg-nx-brand" : "bg-border")} />
                  <span className="text-xs font-medium truncate">{p.name}</span>
                </div>
                <div className="relative z-10 text-[10px] text-muted-foreground mt-0.5 pl-3">
                  {p.models.length} 个模型{p.models.length ? ` · ${p.models.find((m) => m.id === p.selectedModelId)?.name || p.models[0].name}` : ""}
                </div>
              </button>
            );
          })}
          {settings.providers.length === 0 && (
            <div className="text-[11px] text-muted-foreground text-center py-6">暂无供应商</div>
          )}
        </div>
        <Button size="sm" variant="outline" className="w-full h-7 text-[11px] mt-2 shrink-0" onClick={addProvider}>
          <Plus className="size-3" /> 添加供应商
        </Button>
      </div>

      {/* ── 右栏：编辑表单 ── */}
      <div className="flex-1 min-w-0">
        {!provider ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground py-16">
            点击左侧「添加供应商」开始配置
          </div>
        ) : (
          <div className="space-y-3 pr-1">
            {/* 头部 */}
            <div className="flex items-center gap-2">
              <Input value={provider.name} onChange={(e) => patchProvider({ name: e.target.value })} placeholder="供应商名称" className="h-8 text-xs flex-1 font-medium" />
              {isDefault ? (
                <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] text-nx-brand" disabled><Star className="w-3 h-3" fill="currentColor" /> 默认</Button>
              ) : (
                <Button size="sm" variant="outline" className="h-7 px-2 text-[10px]" onClick={() => onChange({ defaultProviderId: provider.id, providers: settings.providers.map((p) => ({ ...p, isDefault: p.id === provider.id })) })}>
                  <StarOff className="w-3 h-3" /> 设为默认
                </Button>
              )}
              <Button size="sm" variant="ghost" className="h-7 px-2 hover:text-destructive" onClick={removeProvider} title="删除供应商"><Trash2 className="w-3.5 h-3.5" /></Button>
            </div>

            {/* 预设快填 */}
            <div className="flex flex-wrap gap-1">
              {PRESETS.map((p) => (
                <button key={p.name} onClick={() => applyPreset(p)} className="px-1.5 py-0.5 rounded text-[9px] border border-border text-muted-foreground hover:border-nx-brand/40 hover:text-nx-brand transition-colors active:scale-95" title={`${p.apiBaseUrl} · ${p.model}`}>
                  {p.name}
                </button>
              ))}
            </div>

            {/* ① 连接 */}
            <div className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground"><Server className="size-3 text-nx-brand" /> 连接</div>
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground">API 协议</label>
                <Select value={provider.protocol || "chat-completions"} onValueChange={(v) => patchProvider({ protocol: v as ModelProvider["protocol"] })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROTOCOLS.map((p) => (
                      <SelectItem key={p.value} value={p.value} className="text-xs">
                        <div>
                          <div className="font-medium">{p.label}</div>
                          <div className="text-[10px] text-muted-foreground">{p.desc}</div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground">Base URL（一般以 /v1 结尾）</label>
                <Input value={provider.apiBaseUrl} onChange={(e) => patchProvider({ apiBaseUrl: e.target.value })} placeholder="https://api.example.com/v1" className="h-8 text-[11px] font-mono" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground">API Key（保存后脱敏，留空保持不变）</label>
                <div className="flex gap-1">
                  <Input type={showKey ? "text" : "password"} value={provider.apiKey} onChange={(e) => patchProvider({ apiKey: e.target.value })} placeholder="留空保持不变，或输入新 Key" className="h-8 text-[11px] font-mono flex-1" />
                  <Button size="sm" variant="outline" className="h-8 px-2" onClick={() => setShowKey((v) => !v)}>{showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}</Button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={testConnection} disabled={testing} className="text-[10px] text-nx-success hover:text-nx-success/80 disabled:opacity-50 flex items-center gap-1 transition-colors active:scale-95">
                  {testing ? <Loader2 className="size-2.5 animate-spin" /> : <Check className="size-2.5" />} 真实对话测试
                </button>
                {testResult && (
                  <motion.span initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} className={cn("text-[10px] flex items-center gap-0.5 truncate", testResult.ok ? "text-nx-success" : "text-nx-error")}>
                    {testResult.ok ? <Check className="size-2.5 shrink-0" /> : <XCircle className="size-2.5 shrink-0" />} {testResult.msg.slice(0, 90)}
                  </motion.span>
                )}
              </div>
            </div>

            {/* ② 模型管理 */}
            <div className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                <Boxes className="size-3 text-nx-brand" /> 模型管理
                <span className="ml-auto flex items-center gap-1.5">
                  <button type="button" onClick={fetchModels} disabled={fetching || !provider.apiBaseUrl} className="text-[10px] text-nx-brand hover:text-nx-brand/80 disabled:opacity-50 flex items-center gap-1 transition-colors active:scale-95">
                    {fetching ? <Loader2 className="size-2.5 animate-spin" /> : <Download className="size-2.5" />} 拉取模型
                  </button>
                  <button type="button" onClick={addModel} className="text-[10px] text-nx-brand hover:text-nx-brand/80 flex items-center gap-0.5 transition-colors active:scale-95">
                    <Plus className="size-2.5" /> 添加模型
                  </button>
                </span>
              </div>
              {fetchNote && (
                <p className="text-[9px] text-muted-foreground">
                  {fetchNote.source === "catalog" ? "该服务不提供模型列表接口，已展示官方常用模型目录" : fetchNote.source === "live" ? "已实时拉取模型列表" : fetchNote.note}
                </p>
              )}
              <AnimatePresence initial={false}>
                {provider.models.map((m) => {
                  const active = m.id === selectedModel?.id;
                  return (
                    <motion.div
                      key={m.id}
                      layout
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.97 }}
                      transition={{ type: "spring", stiffness: 380, damping: 32 }}
                      className={cn("rounded-lg border p-2.5 space-y-2", active ? "border-nx-brand/50 bg-nx-brand/5" : "border-border/60")}
                    >
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => patchProvider({ selectedModelId: m.id })}
                          title={active ? "当前使用" : "设为当前模型"}
                          className={cn("size-4 shrink-0 rounded-full border flex items-center justify-center transition-colors", active ? "border-nx-brand" : "border-border hover:border-nx-brand/50")}
                        >
                          {active && <span className="size-2 rounded-full bg-nx-brand" />}
                        </button>
                        <Input value={m.name} onChange={(e) => patchModel(m.id, { name: e.target.value })} placeholder="模型名称，如 SenseChat-5" className="h-7 text-[11px] font-mono flex-1" />
                        <Button size="sm" variant="ghost" className="h-7 px-1.5 hover:text-destructive" onClick={() => removeModel(m.id)} title="删除模型"><Trash2 className="w-3 h-3" /></Button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="text-[10px] text-muted-foreground">上下文窗口（token 上限）</label>
                          <Input type="number" min={4096} step={1024} value={m.contextWindow} onChange={(e) => patchModel(m.id, { contextWindow: Math.max(0, Number(e.target.value) || 0) })} placeholder="1048576" className="h-7 text-[11px] font-mono" />
                          <div className="flex flex-wrap gap-1">
                            {CONTEXT_LENGTH_PRESETS.map((c) => (
                              <button key={c.value} onClick={() => patchModel(m.id, { contextWindow: c.value })} className={cn("px-1.5 py-0.5 rounded text-[9px] border transition-all active:scale-90", m.contextWindow === c.value ? "border-nx-brand bg-nx-brand/10 text-nx-brand" : "border-border text-muted-foreground hover:border-nx-brand/40")}>{c.label}</button>
                            ))}
                          </div>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] text-muted-foreground">上下文占用告警阈值（%）</label>
                          <Input type="number" min={0} max={100} value={m.compactThreshold} onChange={(e) => { const v = Math.min(100, Math.max(0, Number(e.target.value) || 0)); patchModel(m.id, { compactThreshold: v }); }} placeholder="70" className="h-7 text-[11px] font-mono" />
                          <p className="text-[9px] text-muted-foreground leading-relaxed">
                            上下文占窗口达到该比例自动压缩（保留目标/计划/最新内容，老旧消息转摘要，原始记录永远在快照）。
                          </p>
                          {m.compactThreshold >= 100 && (
                            <p className="text-[9px] text-nx-warn">当前 = 100：已关闭自动压缩，仅允许手动 /compact</p>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
              {provider.models.length === 0 && <div className="text-[11px] text-muted-foreground text-center py-2">点击「添加模型」或「拉取模型」</div>}
            </div>

            {/* 思考强度 */}
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">思考强度（仅非「关闭」时下发 thinking 字段，避免严格 API 报错）</label>
              <div className="flex flex-wrap gap-1">
                {THINKING_LEVELS.map((t) => (
                  <button key={t.value} onClick={() => patchProvider({ thinkingLevel: t.value })} className={cn("px-1.5 py-0.5 rounded text-[9px] border transition-all active:scale-90", (provider.thinkingLevel || "none") === t.value ? "border-purple-500/40 bg-purple-500/10 text-purple-400" : "border-border text-muted-foreground hover:border-purple-400/40")} title={t.desc}>{t.label}</button>
                ))}
              </div>
            </div>

            {/* 高级参数 */}
            <div>
              <button onClick={() => setAdvanced((v) => !v)} className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                <motion.span animate={{ rotate: advanced ? 180 : 0 }} transition={{ duration: 0.2 }}><ChevronDown className="w-3 h-3" /></motion.span>
                高级参数
              </button>
              <AnimatePresence initial={false}>
                {advanced && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: "easeOut" }} className="overflow-hidden">
                    <div className="space-y-2 pt-2 border-t border-border mt-1">
                      <label className="flex items-center justify-between gap-3 cursor-pointer">
                        <span className="text-[10px] text-muted-foreground">前缀缓存优化（prompt_cache_key，提高命中、降低成本）</span>
                        <Switch checked={!!provider.promptCache} onCheckedChange={(v) => patchProvider({ promptCache: v })} />
                      </label>
                      <label className="flex items-center justify-between gap-3 cursor-pointer" title="GLM 系扩展字段，严格校验的 OpenAI 兼容网关会 400 拒绝；默认关闭即可兼容 DeepSeek/OpenAI/Qwen 等">
                        <span className="text-[10px] text-muted-foreground">发送 GLM thinking 字段（仅智谱/GLM 兼容网关）</span>
                        <Switch checked={!!provider.glmThinking} onCheckedChange={(v) => patchProvider({ glmThinking: v })} />
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="space-y-1">
                          <label className="text-[10px] text-muted-foreground">Top P</label>
                          <Input type="number" step="0.05" min="0" max="1" value={provider.topP ?? ""} onChange={(e) => patchProvider({ topP: e.target.value ? parseFloat(e.target.value) : undefined })} placeholder="1.0" className="h-7 text-[11px] font-mono" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] text-muted-foreground">频率惩罚</label>
                          <Input type="number" step="0.1" min="-2" max="2" value={provider.frequencyPenalty ?? ""} onChange={(e) => patchProvider({ frequencyPenalty: e.target.value ? parseFloat(e.target.value) : undefined })} placeholder="0" className="h-7 text-[11px] font-mono" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] text-muted-foreground">存在惩罚</label>
                          <Input type="number" step="0.1" min="-2" max="2" value={provider.presencePenalty ?? ""} onChange={(e) => patchProvider({ presencePenalty: e.target.value ? parseFloat(e.target.value) : undefined })} placeholder="0" className="h-7 text-[11px] font-mono" />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-muted-foreground">停止序列（可选）</label>
                        <Input value={provider.stop ?? ""} onChange={(e) => patchProvider({ stop: e.target.value || undefined })} placeholder="如 <|end|>" className="h-7 text-[11px] font-mono" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-muted-foreground">自定义参数（JSON，覆盖以上任意字段）</label>
                        <Input value={provider.customParams ?? ""} onChange={(e) => patchProvider({ customParams: e.target.value || undefined })} placeholder='{"response_format":{"type":"json_object"}}' className="h-7 text-[10px] font-mono" />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
