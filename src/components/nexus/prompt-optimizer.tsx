"use client";
// 优化提示词：模型预处理（不写入会话上下文），输出三个版本可直接替换输入框。
// 偏好学习：记录用户常选的版本并优先展示；支持重置。localStorage: nx-optimize-pref
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Wand2, Loader2, XCircle, Check, RotateCcw, Crosshair, Zap, ListPlus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type VersionKey = "structured" | "minimal" | "detailed";
const VERSION_META: { key: VersionKey; title: string; desc: string; icon: any }[] = [
  { key: "structured", title: "精准结构化版", desc: "目标 + 约束 + 输出格式，适配 Agent 直接执行", icon: Crosshair },
  { key: "minimal", title: "极简指令版", desc: "极度精简，节约 token", icon: Zap },
  { key: "detailed", title: "补充细节版", desc: "自动补全边界条件与验收标准", icon: ListPlus },
];

const PREF_KEY = "nx-optimize-pref";
interface Pref { counts: Record<VersionKey, number>; lastChosen: VersionKey | null; uses: number }
function loadPref(): Pref {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return { counts: { structured: 0, minimal: 0, detailed: 0, ...(p.counts || {}) }, lastChosen: p.lastChosen ?? null, uses: p.uses ?? 0 };
    }
  } catch {}
  return { counts: { structured: 0, minimal: 0, detailed: 0 }, lastChosen: null, uses: 0 };
}
function savePref(p: Pref) { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch {} }

export function PromptOptimizer({
  text, onApply,
}: {
  text: string;
  onApply: (newText: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [versions, setVersions] = useState<Partial<Record<VersionKey, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [pref, setPref] = useState<Pref>(loadPref);
  const { toast } = useToast();

  const optimize = async () => {
    if (!text.trim()) { toast({ title: "输入框为空", description: "先写下原始提示词再优化", variant: "destructive" }); return; }
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/optimize-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setVersions(data.versions || {});
    } catch (e: any) {
      setError(e?.message || "优化失败");
    } finally {
      setLoading(false);
    }
  };

  // 按使用次数排序（次数相同保持默认顺序），常用版本优先展示并带「常用」标记
  const ordered = [...VERSION_META].sort((a, b) => (pref.counts[b.key] || 0) - (pref.counts[a.key] || 0));
  const topKey = ordered[0].key;

  const pick = (key: VersionKey) => {
    const v = versions[key];
    if (!v) return;
    const next: Pref = { counts: { ...pref.counts, [key]: (pref.counts[key] || 0) + 1 }, lastChosen: key, uses: pref.uses + 1 };
    setPref(next);
    savePref(next);
    onApply(v);
    setOpen(false);
    toast({ title: "已替换输入框", description: `${VERSION_META.find((x) => x.key === key)?.title} · 可继续二次编辑` });
  };

  const resetPref = () => {
    const fresh = { counts: { structured: 0, minimal: 0, detailed: 0 }, lastChosen: null, uses: 0 };
    setPref(fresh);
    savePref(fresh);
    toast({ title: "偏好已重置" });
  };

  return (
    <>
      <motion.button
        type="button"
        onClick={optimize}
        whileTap={{ scale: 0.85 }}
        whileHover={{ scale: 1.06 }}
        transition={{ type: "spring", stiffness: 500, damping: 25 }}
        title="优化提示词（生成三个版本，不写入会话）"
        className="size-8 shrink-0 inline-flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-nx-brand hover:border-nx-brand/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        disabled={!text.trim()}
      >
        <Wand2 className="size-3.5" />
      </motion.button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-hidden flex flex-col" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm"><Wand2 className="size-4 text-nx-brand" /> 优化提示词</DialogTitle>
            <DialogDescription className="text-[11px]">模型预处理，不写入会话上下文。点击版本直接替换输入框，可继续编辑。</DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin mr-2" /> 正在生成三个版本…
            </div>
          ) : error ? (
            <div className="py-8 text-center space-y-2">
              <XCircle className="size-6 text-nx-error mx-auto" />
              <p className="text-xs text-nx-error">{error}</p>
              <Button size="sm" variant="outline" onClick={optimize}>重试</Button>
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto nx-scroll space-y-2">
              <AnimatePresence initial={false}>
                {ordered.map((meta, i) => {
                  const v = versions[meta.key];
                  const Icon = meta.icon;
                  return (
                    <motion.button
                      key={meta.key}
                      layout
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05, type: "spring", stiffness: 360, damping: 30 }}
                      onClick={() => pick(meta.key)}
                      disabled={!v}
                      className="w-full text-left rounded-lg border border-border p-3 hover:border-nx-brand/50 hover:bg-nx-brand/5 transition-colors disabled:opacity-40 group"
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <Icon className="size-3.5 text-nx-brand" />
                        <span className="text-xs font-medium">{meta.title}</span>
                        {meta.key === topKey && pref.uses > 0 && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-nx-brand/10 text-nx-brand border border-nx-brand/30">常用 · 已选 {pref.counts[meta.key]} 次</span>
                        )}
                        <span className="ml-auto text-[9px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-0.5">
                          <Check className="size-2.5" /> 替换输入框
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground mb-1">{meta.desc}</p>
                      <p className="text-[11px] text-foreground/85 whitespace-pre-wrap line-clamp-6 font-mono bg-muted/30 rounded p-2 border border-border/50">{v || "（未生成）"}</p>
                    </motion.button>
                  );
                })}
              </AnimatePresence>
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-border">
            <span className="text-[10px] text-muted-foreground">
              {pref.uses > 0 ? `已学习你的偏好（累计 ${pref.uses} 次选择），常用版本优先展示` : "选择版本会逐渐学习你的偏好"}
            </span>
            <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={resetPref}>
              <RotateCcw className="size-2.5" /> 重置偏好
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
