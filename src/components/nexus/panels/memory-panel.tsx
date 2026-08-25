"use client";
// NEXUS 记忆面板 — 浏览、检索、置顶、删除跨会话记忆
import { useEffect, useMemo, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain, Plus, Search, Loader2, Pin, PinOff, Trash2, Check, KeyRound, FolderTree,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface MemoryItem {
  id: string;
  namespace: string;
  key: string;
  value: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

const NS_COLORS = ["blue", "emerald", "amber", "purple", "rose", "cyan", "violet", "teal"];
const NS_BG: Record<string, string> = {
  blue: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  emerald: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  amber: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  purple: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  rose: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  cyan: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  violet: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  teal: "bg-teal-500/15 text-teal-400 border-teal-500/30",
};

function colorFor(ns: string) {
  let h = 0;
  for (let i = 0; i < ns.length; i++) h = (h * 31 + ns.charCodeAt(i)) >>> 0;
  return NS_COLORS[h % NS_COLORS.length];
}

export function MemoryPanel() {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [activeNs, setActiveNs] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/memory");
      const data = await res.json();
      setMemories(data.memories || []);
    } catch {
      toast({ title: "加载失败", description: "无法获取记忆", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const namespaces = useMemo(() => {
    const counts = new Map<string, number>();
    memories.forEach((m) => counts.set(m.namespace, (counts.get(m.namespace) || 0) + 1));
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [memories]);

  const filtered = useMemo(() => {
    let list = memories;
    if (activeNs) list = list.filter((m) => m.namespace === activeNs);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (m) => m.key.toLowerCase().includes(q) || m.value.toLowerCase().includes(q) || m.namespace.toLowerCase().includes(q),
      );
    }
    return list;
  }, [memories, activeNs, query]);

  const togglePin = async (m: MemoryItem) => {
    setMemories((prev) => prev.map((x) => x.id === m.id ? { ...x, pinned: !x.pinned } : x));
    try {
      const res = await fetch(`/api/memory/${m.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: !m.pinned }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      setMemories((prev) => prev.map((x) => x.id === m.id ? { ...x, pinned: m.pinned } : x));
      toast({ title: "操作失败", variant: "destructive" });
    }
  };

  const remove = async (m: MemoryItem) => {
    const prev = memories;
    setMemories((arr) => arr.filter((x) => x.id !== m.id));
    try {
      const res = await fetch(`/api/memory/${m.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({ title: "已删除", description: m.key });
    } catch {
      setMemories(prev);
      toast({ title: "删除失败", variant: "destructive" });
    }
  };

  const totalPinned = memories.filter((m) => m.pinned).length;

  return (
    <div className="flex flex-col h-full">
      <header className="shrink-0 border-b border-border bg-card/40 backdrop-blur-sm px-4 sm:px-6 py-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <div className="size-8 rounded-lg nx-brand-grad flex items-center justify-center shrink-0">
              <Brain className="size-4 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground">记忆</h2>
              <p className="text-[11px] text-muted-foreground truncate">
                {memories.length} 条记忆 · {namespaces.length} 个命名空间 · {totalPinned} 置顶
              </p>
            </div>
          </div>
          <Button size="sm" className="nx-brand-grad border-0 text-primary-foreground" onClick={() => setShowCreate(true)}>
            <Plus className="size-3.5" /> 新增记忆
          </Button>
        </div>

        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索键名、内容或命名空间…"
              className="pl-8 h-8 text-xs"
            />
          </div>
        </div>

        {/* 命名空间筛选 */}
        {namespaces.length > 0 && (
          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground mr-1">
              <FolderTree className="size-3" /> 命名空间：
            </div>
            <button
              type="button"
              onClick={() => setActiveNs(null)}
              className={cn(
                "text-[11px] px-2.5 py-1 rounded-full border transition-colors",
                activeNs === null ? "bg-accent border-border text-foreground" : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/50",
              )}
            >
              全部 ({memories.length})
            </button>
            {namespaces.map(([ns, count]) => {
              const c = NS_BG[colorFor(ns)] || NS_BG.blue;
              const active = activeNs === ns;
              return (
                <button
                  key={ns}
                  type="button"
                  onClick={() => setActiveNs(active ? null : ns)}
                  className={cn(
                    "text-[11px] px-2.5 py-1 rounded-full border transition-colors flex items-center gap-1",
                    active ? cn(c, "border-current") : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/50",
                  )}
                >
                  <span className={cn("size-1.5 rounded-full", c.split(" ")[0])} />
                  {ns} ({count})
                </button>
              );
            })}
          </div>
        )}
      </header>

      <ScrollArea className="flex-1 nx-scroll">
        <div className="p-4 sm:p-6 max-w-4xl mx-auto">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-muted-foreground">
              <Loader2 className="size-5 animate-spin mr-2" /> 加载中…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center nx-aurora rounded-xl">
              <div className="size-14 rounded-2xl nx-brand-grad flex items-center justify-center mb-3">
                <Brain className="size-6 text-primary-foreground" />
              </div>
              <p className="text-sm text-foreground font-medium mb-1">
                {memories.length === 0 ? "还没有任何记忆" : "未找到匹配的记忆"}
              </p>
              <p className="text-xs text-muted-foreground mb-3">
                {memories.length === 0 ? "Agent 在对话中保存的事实会出现在这里" : "试试调整搜索或筛选条件"}
              </p>
              {memories.length === 0 && (
                <Button size="sm" className="nx-brand-grad border-0 text-primary-foreground" onClick={() => setShowCreate(true)}>
                  <Plus className="size-3.5" /> 新增第一条记忆
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <AnimatePresence initial={false}>
                {filtered.map((m, idx) => {
                  const c = NS_BG[colorFor(m.namespace)] || NS_BG.blue;
                  return (
                    <motion.div
                      key={m.id}
                      layout
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -12 }}
                      transition={{ duration: 0.2, delay: Math.min(idx * 0.02, 0.2) }}
                      className={cn(
                        "group rounded-xl border bg-card/70 backdrop-blur-sm p-3.5 transition-colors",
                        m.pinned ? "border-nx-brand/40 nx-glow" : "border-border hover:border-nx-brand/30",
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div className={cn("shrink-0 size-9 rounded-lg flex items-center justify-center border", c)}>
                          <KeyRound className="size-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0", c)}>{m.namespace}</Badge>
                            <span className="text-sm font-medium text-foreground truncate">{m.key}</span>
                            {m.pinned && <Pin className="size-3 text-nx-brand shrink-0" />}
                          </div>
                          <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words line-clamp-4">
                            {m.value}
                          </p>
                          <div className="text-[10px] text-muted-foreground mt-1.5">
                            更新于 {new Date(m.updatedAt).toLocaleString("zh-CN")}
                          </div>
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={() => togglePin(m)}
                            title={m.pinned ? "取消置顶" : "置顶"}
                            className="size-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-nx-brand hover:bg-accent transition-colors"
                          >
                            {m.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => remove(m)}
                            title="删除"
                            className="size-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-accent transition-colors"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </div>
      </ScrollArea>

      <CreateMemoryDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreated={() => { setShowCreate(false); load(); }}
      />
    </div>
  );
}

function CreateMemoryDialog({
  open, onOpenChange, onCreated,
}: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const [namespace, setNamespace] = useState("default");
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [pinned, setPinned] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const submit = async () => {
    if (!key.trim() || !value.trim()) {
      toast({ title: "请填写键名和值", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          namespace: namespace.trim() || "default",
          key: key.trim(),
          value: value.trim(),
          pinned,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "保存失败");
      }
      toast({ title: "记忆已保存", description: `${namespace}:${key}` });
      setNamespace("default"); setKey(""); setValue(""); setPinned(false);
      onCreated();
    } catch (err: any) {
      toast({ title: "保存失败", description: err?.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Brain className="size-4 text-nx-brand" /> 新增记忆</DialogTitle>
          <DialogDescription className="sr-only">填写记忆信息</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="grid grid-cols-2 gap-2">
            <Field label="命名空间">
              <Input value={namespace} onChange={(e) => setNamespace(e.target.value)} placeholder="default" className="text-sm h-9" />
            </Field>
            <Field label="键名">
              <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="例如：用户偏好" className="text-sm h-9" />
            </Field>
          </div>
          <Field label="值">
            <Textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="记忆内容…"
              className="text-xs min-h-[100px]"
            />
          </Field>
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
            <button
              type="button"
              onClick={() => setPinned(!pinned)}
              className={cn(
                "size-5 rounded border flex items-center justify-center transition-colors",
                pinned ? "bg-nx-brand border-nx-brand text-primary-foreground" : "border-border text-transparent hover:border-nx-brand/50",
              )}
            >
              <Check className="size-3" />
            </button>
            置顶（优先被 recall 召回）
          </label>
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>取消</Button>
            <Button size="sm" className="nx-brand-grad border-0 text-primary-foreground" onClick={submit} disabled={submitting}>
              {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              保存
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
