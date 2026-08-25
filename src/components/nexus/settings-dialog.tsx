"use client";
// NEXUS 设置 — 模型（供应商管理模块）/ 行为 / 工具
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Settings, Loader2, Check, RotateCcw, Sliders, Wrench, Sparkles, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentSettings } from "@/lib/nexus/settings";
import { activeModelOf, resolveProvider } from "@/lib/nexus/provider-utils";
import { ProvidersSettings } from "./providers-settings";

const ALL_TOOLS = [
  "read", "write", "edit", "patch", "str_replace_editor", "glob", "grep", "read_image", "pwsh", "web_search",
  "memory_save", "memory_recall", "calculator", "current_time", "echo", "http_request",
  "page_reader", "run_tests", "workspace_info", "delegate",
  "create_goal", "get_goal", "update_goal", "todo_write", "workflow", "ralph",
  "subagent", "subagent_fork", "send_message", "list_agents", "interrupt_agent",
  "job_list", "job_output", "job_kill",
  "ask_user_question", "skill",
];
const TABS = [
  { id: "model", label: "模型", icon: Sliders },
  { id: "behavior", label: "行为", icon: Sparkles },
  { id: "tools", label: "工具", icon: Wrench },
] as const;

export function SettingsDialog() {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<typeof TABS[number]["id"]>("model");
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = async () => { try { const res = await fetch("/api/settings"); const data = await res.json(); setSettings(data.settings); } catch {} };
  useEffect(() => { if (open) load(); }, [open]);

  const update = (patch: Partial<AgentSettings>) => { setSettings((s) => s ? { ...s, ...patch } : s); setSaved(false); };
  const toggleTool = (name: string) => {
    if (!settings) return;
    // 语义修正：enabledTools 为空 = 全部启用（服务端约定）。
    // 在"全部启用"态关闭一个工具 → 白名单 = 除它以外全部；否则开关直接增删名单。
    if (settings.enabledTools.length === 0) {
      update({ enabledTools: ALL_TOOLS.filter((t) => t !== name) });
    } else if (settings.enabledTools.includes(name)) {
      update({ enabledTools: settings.enabledTools.filter((t) => t !== name) });
    } else {
      update({ enabledTools: [...settings.enabledTools, name] });
    }
  };
  const save = async () => {
    if (!settings) return;
    setSaving(true); setSaveError(null);
    try {
      const res = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
      if (!res.ok) throw new Error(`保存失败 (HTTP ${res.status})`);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) { setSaveError(e.message || "保存失败"); } finally { setSaving(false); }
  };
  const reset = () => {
    setSettings({ providers: [], defaultProviderId: "", temperature: 0.6, maxTokens: 4096, systemPromptExtra: "", enabledTools: [], thinkingEnabled: true, autoToolCalls: true, contextWindow: 24, maxToolRounds: 5, responseStyle: "balanced", language: "zh", safetyMode: "default", autoMemory: false });
    setSaved(false);
  };

  const defaultProvider = settings ? resolveProvider(settings) : null;
  const defaultModel = activeModelOf(defaultProvider);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <span className="p-2 rounded-md hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-foreground transition-colors cursor-pointer inline-flex" title="设置">
          <Settings className="w-4 h-4" />
        </span>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl max-h-[88vh] overflow-hidden nx-scroll" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Settings className="w-4 h-4 text-nx-brand" /> NEXUS 设置
            {settings && defaultProvider && defaultModel && (
              <Badge variant="outline" className="text-[9px] ml-2 font-mono">
                {defaultProvider.name} · {defaultModel.name} · {(defaultModel.contextWindow / 1024).toFixed(0)}K · 压缩@{defaultModel.compactThreshold}%
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>
        {!settings ? <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div> : (
          <div className="flex flex-col" style={{ maxHeight: "72vh" }}>
            {/* Tab 导航 */}
            <div className="flex items-center gap-1 border-b border-border px-1 mb-3">
              {TABS.map((t) => {
                const Icon = t.icon;
                return (
                  <button key={t.id} onClick={() => setActiveTab(t.id)} className={cn("relative px-3 py-2 text-xs font-medium flex items-center gap-1.5 transition-colors", activeTab === t.id ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
                    <Icon className={cn("w-3.5 h-3.5 transition-transform", activeTab === t.id && "text-nx-brand scale-110")} /> {t.label}
                    {activeTab === t.id && <motion.div layoutId="nx-settings-tab" className="absolute left-2 right-2 -bottom-px h-0.5 nx-brand-grad rounded-full" transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
                  </button>
                );
              })}
            </div>

            <div className="flex-1 overflow-y-auto nx-scroll px-1 pb-2">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={activeTab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18, ease: "easeOut" }}>
                  {/* === 模型 Tab：供应商管理模块 === */}
                  {activeTab === "model" && <ProvidersSettings settings={settings} onChange={update} />}

                  {/* === 行为 Tab === */}
                  {activeTab === "behavior" && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                        <div><Label className="text-xs">推理思考流</Label><p className="text-[10px] text-muted-foreground mt-0.5">展示模型思维链（模型不支持时自动忽略）</p></div>
                        <Switch checked={settings.thinkingEnabled} onCheckedChange={(v) => update({ thinkingEnabled: v })} />
                      </div>
                      <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                        <div><Label className="text-xs">自动记忆</Label><p className="text-[10px] text-muted-foreground mt-0.5">每轮结束后自动提炼值得记住的事实/偏好存入记忆（命名空间 auto，消耗少量额外 token）</p></div>
                        <Switch checked={!!settings.autoMemory} onCheckedChange={(v) => update({ autoMemory: v })} />
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1"><Label className="text-xs">温度（创造性）</Label><span className="text-xs font-mono text-nx-brand">{settings.temperature.toFixed(2)}</span></div>
                        <Slider value={[settings.temperature]} onValueChange={([v]) => update({ temperature: v })} min={0} max={1.5} step={0.05} />
                        <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>精确</span><span>平衡</span><span>创意</span></div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1"><Label className="text-xs">最大输出长度</Label><span className="text-xs font-mono text-nx-brand">{settings.maxTokens}</span></div>
                        <Slider value={[settings.maxTokens]} onValueChange={([v]) => update({ maxTokens: v })} min={512} max={16384} step={512} />
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1"><Label className="text-xs">上下文窗口（条数上限）</Label><span className="text-xs font-mono text-nx-brand">{settings.contextWindow} 条</span></div>
                        <Slider value={[settings.contextWindow]} onValueChange={([v]) => update({ contextWindow: v })} min={4} max={60} step={2} />
                        <p className="text-[10px] text-muted-foreground mt-0.5">与模型 token 窗口预算双重生效（模型窗口在供应商 → 模型管理中配置）</p>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1"><Label className="text-xs">最大工具调用轮次</Label><span className="text-xs font-mono text-nx-brand">{settings.maxToolRounds}</span></div>
                        <Slider value={[settings.maxToolRounds]} onValueChange={([v]) => update({ maxToolRounds: v })} min={1} max={10} step={1} />
                      </div>
                      <div>
                        <Label className="text-xs mb-1.5 block">回复风格</Label>
                        <div className="flex gap-1">
                          {[{id:"concise",label:"简洁"},{id:"balanced",label:"平衡"},{id:"detailed",label:"详细"}].map((o) => (
                            <button key={o.id} onClick={() => update({ responseStyle: o.id as any })} className={cn("flex-1 py-1.5 rounded text-[10px] border transition-all duration-150 active:scale-95", settings.responseStyle === o.id ? "border-nx-brand bg-nx-brand/10 text-nx-brand" : "border-border text-muted-foreground hover:border-nx-brand/40")}>{o.label}</button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs mb-1.5 block">语言偏好</Label>
                        <div className="flex gap-1">
                          {[{id:"zh",label:"中文"},{id:"en",label:"英文"},{id:"auto",label:"自动"}].map((o) => (
                            <button key={o.id} onClick={() => update({ language: o.id as any })} className={cn("flex-1 py-1.5 rounded text-[10px] border transition-all duration-150 active:scale-95", settings.language === o.id ? "border-nx-brand bg-nx-brand/10 text-nx-brand" : "border-border text-muted-foreground hover:border-nx-brand/40")}>{o.label}</button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs mb-1.5 block">附加系统指令</Label>
                        <Textarea value={settings.systemPromptExtra} onChange={(e) => update({ systemPromptExtra: e.target.value })} placeholder="给 Agent 的额外指令，如：回答要简洁；总是用中文…" className="text-xs min-h-[60px]" />
                      </div>
                    </div>
                  )}

                  {/* === 工具 Tab === */}
                  {activeTab === "tools" && (
                    <div className="space-y-3">
                      <div className="rounded-lg border border-border p-3">
                        <div className="flex items-center gap-1.5 mb-2">
                          <ShieldCheck className="size-3.5 text-nx-brand" />
                          <Label className="text-xs">工具安全模式</Label>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => update({ safetyMode: "default" })}
                            className={cn("rounded-lg border px-3 py-2 text-left transition-all duration-150 active:scale-[0.98]", (settings.safetyMode ?? "default") === "default" ? "border-nx-brand bg-nx-brand/10" : "border-border hover:border-nx-brand/40")}
                          >
                            <div className="text-[11px] font-medium">默认（安全）</div>
                            <p className="text-[10px] text-muted-foreground mt-0.5">高风险操作（rm -rf、脚本执行、越权写文件等）先拦截并要求审批</p>
                          </button>
                          <button
                            type="button"
                            onClick={() => update({ safetyMode: "unrestricted" })}
                            className={cn("rounded-lg border px-3 py-2 text-left transition-all duration-150 active:scale-[0.98]", (settings.safetyMode ?? "default") === "unrestricted" ? "border-nx-brand bg-nx-brand/10" : "border-border hover:border-nx-brand/40")}
                          >
                            <div className="text-[11px] font-medium">无限制</div>
                            <p className="text-[10px] text-muted-foreground mt-0.5">跳过常规审批；但删除系统/格式化/关机等破坏性操作仍会被底层拦截</p>
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                        <div><Label className="text-xs">自动工具调用</Label><p className="text-[10px] text-muted-foreground mt-0.5">允许 Agent 自主调用工具（高风险操作按上方安全模式处理）</p></div>
                        <Switch checked={settings.autoToolCalls} onCheckedChange={(v) => update({ autoToolCalls: v })} />
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <Label className="text-xs">工具白名单</Label>
                          <span className="text-[10px] text-muted-foreground">{settings.enabledTools.length === 0 ? "全部启用" : `${settings.enabledTools.length} / ${ALL_TOOLS.length}`}</span>
                        </div>
                        <div className="space-y-1">
                          {ALL_TOOLS.map((t) => {
                            const enabled = settings.enabledTools.length === 0 || settings.enabledTools.includes(t);
                            return (
                              <div
                                  key={t}
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => toggleTool(t)}
                                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleTool(t); } }}
                                  className={cn("w-full flex items-center justify-between rounded-lg border px-3 py-2 transition-all duration-150 active:scale-[0.99] cursor-pointer select-none", enabled ? "border-nx-brand/30 bg-nx-brand/5" : "border-border opacity-50")}
                                >
                                <code className="text-[11px] font-mono">{t}</code>
                                <Switch checked={enabled} />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* 底部操作栏 */}
            <div className="flex items-center gap-2 pt-3 border-t border-border mt-2">
              <Button onClick={save} disabled={saving} className="flex-1 nx-brand-grad border-0 text-white active:scale-[0.98] transition-transform">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <Check className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
                {saving ? "保存中…" : saved ? "已保存" : "保存"}
              </Button>
              <Button onClick={reset} variant="outline" size="icon" title="重置默认" className="active:scale-95 transition-transform"><RotateCcw className="w-3.5 h-3.5" /></Button>
            </div>
            <AnimatePresence>
              {saveError && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <p className="text-[10px] text-nx-error pt-1.5">⚠ {saveError}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
