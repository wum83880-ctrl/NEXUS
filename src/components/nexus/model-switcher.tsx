"use client";
// 主界面模型切换器：不动设置就能切模型、调思考强度。
// 数据流：GET /api/settings（脱敏）→ 本地操作 → PATCH /api/settings（空/掩码 Key 服务端自动保留）。
import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, ChevronDown, Cpu, Loader2, RefreshCw, Settings2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentSettings, ModelProvider } from "@/lib/nexus/settings";
import { resolveProvider, activeModelOf } from "@/lib/nexus/provider-utils";
import { THINKING_LEVELS } from "@/lib/nexus/constants";

interface ModelRow { provider: ModelProvider; modelId: string; name: string; contextWindow: number; compactThreshold: number; }

export function ModelSwitcher() {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      setSettings(data.settings);
    } catch {}
  }, []);

  // 挂载时拉一次（按钮初始就显示当前模型），每次打开时刷新
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (open) load(); }, [open, load]);

  const patch = async (patchBody: Partial<AgentSettings>) => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patchBody) });
      const data = await res.json();
      if (res.ok) setSettings(data.settings);
    } catch {} finally { setSaving(false); }
  };

  const defaultProvider = settings ? resolveProvider(settings) : null;
  const defaultModel = activeModelOf(defaultProvider);

  // 选模型 = 设为该供应商的选中模型 + 设为默认供应商
  const pickModel = (providerId: string, modelId: string) => {
    if (!settings) return;
    patch({
      defaultProviderId: providerId,
      providers: settings.providers.map((p) => p.id === providerId ? { ...p, selectedModelId: modelId, isDefault: true } : { ...p, isDefault: false }),
    });
  };

  const setThinking = (level: string) => {
    if (!settings || !defaultProvider) return;
    patch({
      providers: settings.providers.map((p) => p.id === defaultProvider.id ? { ...p, thinkingLevel: level } : p),
    });
  };

  // 供应商没有配置模型时，在线拉取并写入配置
  const fetchModels = async (p: ModelProvider) => {
    setFetching(p.id);
    try {
      const res = await fetch("/api/llm-probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "models", providerId: p.id, protocol: p.protocol, apiBaseUrl: p.apiBaseUrl, apiKey: p.apiKey }),
      });
      const data = await res.json();
      if (!res.ok || !settings) return;
      const names: string[] = data.models || [];
      if (!names.length) return;
      const known = new Set(p.models.map((m) => m.name).filter(Boolean));
      const fresh = names.filter((n) => !known.has(n)).map((n) => ({ id: `mdl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: n, contextWindow: 131072, compactThreshold: 70 }));
      patch({
        providers: settings.providers.map((x) => x.id === p.id
          ? { ...x, models: [...x.models.filter((m) => m.name), ...fresh], selectedModelId: x.selectedModelId || fresh[0]?.id || "" }
          : x),
      });
    } catch {} finally { setFetching(null); }
  };

  // 展开视图：按供应商分组列出全部已配置模型
  const rows: { group: ModelProvider; items: ModelRow[] }[] = (settings?.providers ?? []).map((p) => ({
    group: p,
    items: p.models.map((m) => ({ provider: p, modelId: m.id, name: m.name, contextWindow: m.contextWindow, compactThreshold: m.compactThreshold })),
  }));
  const activeKey = defaultProvider && defaultModel ? `${defaultProvider.id}:${defaultModel.id}` : "";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="切换模型 / 思考强度"
          className="h-7 px-2 inline-flex items-center gap-1.5 rounded-lg border border-border bg-card/60 text-[11px] text-muted-foreground hover:text-foreground hover:border-nx-brand/40 transition-colors active:scale-95"
        >
          <Cpu className="size-3 text-nx-brand" />
          <span className="max-w-[180px] truncate font-mono">
            {defaultModel ? (defaultModel.name || "未选模型") : "未配置模型"}
          </span>
          {defaultModel && defaultModel.compactThreshold < 100 && (
            <span className="text-[9px] text-muted-foreground hidden sm:inline">{(defaultModel.contextWindow / 1024).toFixed(0)}K·{defaultModel.compactThreshold}%</span>
          )}
          {saving ? <Loader2 className="size-3 animate-spin" /> : <ChevronDown className="size-3" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0" aria-describedby={undefined}>
        <div className="p-3 space-y-3">
          {/* 思考强度 */}
          {defaultProvider && (
            <div>
              <div className="flex items-center gap-1 mb-1.5">
                <Sparkles className="size-3 text-nx-brand" />
                <span className="text-[11px] font-medium">思考强度</span>
                {saving && <Loader2 className="size-3 animate-spin ml-auto text-muted-foreground" />}
              </div>
              <div className="flex gap-1">
                {THINKING_LEVELS.map((t) => {
                  const active = (defaultProvider.thinkingLevel || "none") === t.value;
                  return (
                    <button
                      key={t.value}
                      onClick={() => setThinking(t.value)}
                      title={t.desc}
                      className={cn(
                        "relative flex-1 py-1 rounded-md text-[10px] transition-colors",
                        active ? "text-nx-brand" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {t.label}
                      {active && <motion.span layoutId="nx-think-pill" transition={{ type: "spring", stiffness: 420, damping: 32 }} className="absolute inset-0 -z-10 rounded-md border border-nx-brand/40 bg-nx-brand/10" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 模型列表（按供应商分组） */}
          <div>
            <div className="flex items-center gap-1 mb-1.5">
              <Cpu className="size-3 text-nx-brand" />
              <span className="text-[11px] font-medium">模型</span>
              <span className="ml-auto text-[9px] text-muted-foreground">窗口/压缩阈值标注在模型右侧</span>
            </div>
            {!settings || settings.providers.length === 0 ? (
              <div className="text-[11px] text-muted-foreground py-3 text-center">
                还没有配置供应商，请到 <Settings2 className="inline size-3" /> 设置 → 模型 中添加。
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto nx-scroll -mx-1 px-1">
                {rows.map(({ group, items }) => (
                  <div key={group.id}>
                    <div className="flex items-center gap-1 px-1">
                      <span className={cn("size-1.5 rounded-full", group.id === defaultProvider?.id ? "bg-nx-brand" : "bg-border")} />
                      <span className="text-[10px] font-medium text-muted-foreground truncate">{group.name}</span>
                      {(items.length === 0 || !items.some((i) => i.name)) && (
                        <button type="button" onClick={() => fetchModels(group)} disabled={fetching === group.id} className="ml-auto text-[9px] text-nx-brand hover:text-nx-brand/80 disabled:opacity-50 inline-flex items-center gap-0.5 active:scale-95">
                          {fetching === group.id ? <Loader2 className="size-2.5 animate-spin" /> : <RefreshCw className="size-2.5" />} 拉取
                        </button>
                      )}
                    </div>
                    <div className="mt-0.5 space-y-0.5">
                      {items.filter((i) => i.name).map((item) => {
                        const active = `${item.provider.id}:${item.modelId}` === activeKey;
                        return (
                          <button
                            key={item.modelId}
                            type="button"
                            onClick={() => pickModel(item.provider.id, item.modelId)}
                            className={cn(
                              "w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-left transition-colors",
                              active ? "bg-nx-brand/10 text-nx-brand" : "text-muted-foreground hover:text-foreground hover:bg-accent"
                            )}
                          >
                            {active ? <Check className="size-3 shrink-0" /> : <span className="size-3 shrink-0" />}
                            <span className="text-[11px] font-mono truncate flex-1">{item.name}</span>
                            <span className="text-[9px] text-muted-foreground shrink-0 font-mono">{(item.contextWindow / 1024).toFixed(0)}K</span>
                            <span className={cn("text-[9px] shrink-0 font-mono", item.compactThreshold >= 100 ? "text-muted-foreground/60" : "text-nx-warn/80")}>·{item.compactThreshold}%</span>
                          </button>
                        );
                      })}
                      {items.length === 0 && (
                        <p className="text-[10px] text-muted-foreground px-2 py-1">无模型，点击上方「拉取」或到设置中添加</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
