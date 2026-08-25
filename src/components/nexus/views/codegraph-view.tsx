"use client";
// NEXUS 代码图谱视图 — 智能感知工作区结构：进入即自动分析（嵌入底层），无需手动按钮；
// 未配置供应商时给出优雅引导；分析进度与失败可见。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Network, Loader2, RefreshCw, Sparkles, FileCode2, FileJson2, FolderTree,
  Search, Hash, ArrowRight, Wrench, Zap, Wand2, Settings2, ChevronDown, CircleAlert,
} from "lucide-react";
import { useNexus } from "@/hooks/nexus/use-nexus";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface GraphNode {
  id: string;
  summary: string;
  kind: string;
  ext: string;
  loc: number;
  imports: string[];
  updatedAt: string;
  stale?: boolean;
}

const KIND_LABEL: Record<string, string> = { file: "源码", config: "配置", dir: "目录" };

// 让 Agent 分析指定文件（复用会话通道）
function analyzeFile(filePath: string) {
  const st = useNexus.getState();
  const sid = st.activeSessionId;
  const send = st.send;
  if (!sid || !send) return;
  send({ type: "chat:run", sessionId: sid, message: `请读取并分析这个文件，说明它的职责、关键实现、依赖关系与可改进点：${filePath}`, turn: st.runTurn + 1 });
  st.setNavSection("sessions");
}

function copyPath(filePath: string) {
  navigator.clipboard.writeText(filePath).catch(() => {});
}

export function CodeGraphView() {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [providerReady, setProviderReady] = useState<boolean | null>(null);
  const [analyzeFailed, setAnalyzeFailed] = useState(false);
  const sessionId = useNexus((s) => s.activeSessionId);
  const send = useNexus((s) => s.send);
  const runStatus = useNexus((s) => s.runStatus);
  const lastError = useNexus((s) => s.lastError);
  const autoAnalyzed = useRef(false);

  const load = useCallback(async () => {
    if (!sessionId) { setNodes([]); setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/code-graph?sessionId=${encodeURIComponent(sessionId)}`);
      const data = await res.json();
      setNodes(Array.isArray(data.nodes) ? data.nodes : []);
    } catch { setNodes([]); } finally { setLoading(false); }
  }, [sessionId]);

  // 供应商检测（决定能否自动分析）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings");
        const data = await res.json();
        if (!cancelled) setProviderReady(!!data.settings && data.settings.providers.length > 0);
      } catch { if (!cancelled) setProviderReady(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  // 进入视图自动分析：图谱为空且已配置供应商 → 无需任何按钮，智能嵌入
  useEffect(() => {
    if (!sessionId || autoAnalyzed.current) return;
    if (providerReady === true && !loading && nodes.length === 0) {
      autoAnalyzed.current = true;
      send?.({ type: "chat:graph", sessionId });
    }
  }, [sessionId, providerReady, loading, nodes.length, send]);

  // 分析状态跟踪：失败可见
  const prevStatus = useRef(runStatus);
  const wasRunning = useRef(false);
  useEffect(() => {
    if (prevStatus.current === "running") wasRunning.current = true;
    if (prevStatus.current === "running" && runStatus === "idle") { load(); wasRunning.current = false; }
    if (prevStatus.current === "running" && runStatus === "error") { load(); setAnalyzeFailed(true); wasRunning.current = false; }
    prevStatus.current = runStatus;
  }, [runStatus, load]);

  const analyzing = runStatus === "running";

  const analyze = () => {
    if (!sessionId || !send) return;
    setAnalyzeFailed(false);
    send({ type: "chat:graph", sessionId });
  };
  const organize = () => {
    const st = useNexus.getState();
    if (!st.activeSessionId || !st.send) return;
    if (!window.confirm("让大模型分析项目结构并自动整理（仅移动/改名，绝不删除任何文件）。确认继续？")) return;
    st.send({ type: "chat:organize", sessionId: st.activeSessionId });
  };

  const groups = useMemo(() => {
    let list = nodes;
    if (kindFilter !== "all") list = list.filter((n) => n.kind === kindFilter);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter((n) => n.id.toLowerCase().includes(q) || n.summary.toLowerCase().includes(q) || (n.imports || []).some((i) => i.toLowerCase().includes(q)));
    }
    const byDir = new Map<string, GraphNode[]>();
    for (const n of list) {
      const idx = n.id.lastIndexOf("/");
      const dir = idx > 0 ? n.id.slice(0, idx) : "（根目录）";
      if (!byDir.has(dir)) byDir.set(dir, []);
      byDir.get(dir)!.push(n);
    }
    return Array.from(byDir.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [nodes, kindFilter, query]);

  const kinds = useMemo(() => { const s = new Set<string>(); nodes.forEach((n) => s.add(n.kind)); return Array.from(s); }, [nodes]);
  const toggle = (id: string) => {
    setExpanded((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const totalLoc = nodes.reduce((s, n) => s + (n.loc || 0), 0);
  const staleCount = nodes.filter((n) => n.stale).length;

  return (
    <div className="h-full overflow-y-auto nx-scroll">
      <div className="max-w-5xl mx-auto px-4 py-5 space-y-4">
        {/* ── 头部：克制优雅，智能自动 ── */}
        <div className="rounded-xl border border-border bg-card/50 backdrop-blur-sm overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="size-9 rounded-lg nx-brand-grad flex items-center justify-center shrink-0 nx-glow">
              <Network className="size-4 text-primary-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground">工作区代码图谱</h3>
                <AnimatePresence mode="wait">
                  {analyzing ? (
                    <motion.span key="a" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-1 text-[10px] text-nx-brand">
                      <Loader2 className="size-2.5 animate-spin" /> AI 正在分析…
                    </motion.span>
                  ) : analyzeFailed ? (
                    <motion.span key="f" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-1 text-[10px] text-nx-error" title={lastError || undefined}>
                      <CircleAlert className="size-2.5" /> 分析失败{lastError ? `：${lastError.slice(0, 60)}` : providerReady === false ? "（未配置模型供应商）" : ""}
                    </motion.span>
                  ) : null}
                </AnimatePresence>
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                <span className="font-mono">{nodes.length} 文件 · {totalLoc.toLocaleString()} 行</span>
                {staleCount > 0 && <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-amber-500 border-amber-500/40 bg-amber-500/10">已变更 {staleCount}</Badge>}
                {providerReady === false && (
                  <button type="button" onClick={() => useNexus.getState().setDetailsOpen(false)} className="text-nx-brand hover:underline inline-flex items-center gap-0.5">
                    <Settings2 className="size-2.5" /> 配置供应商后自动分析
                  </button>
                )}
              </div>
            </div>
            {/* 克制的小图标操作 */}
            <div className="flex items-center gap-0.5 shrink-0">
              <button type="button" onClick={analyze} disabled={!sessionId || analyzing} title={nodes.length ? "重新分析" : "分析图谱"} className="size-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-nx-brand hover:bg-accent/60 transition-colors disabled:opacity-40">
                <Sparkles className="size-3.5" />
              </button>
              <button type="button" onClick={organize} disabled={!sessionId || analyzing} title="智能整理（仅移动/改名，绝不删除）" className="size-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-nx-brand hover:bg-accent/60 transition-colors disabled:opacity-40">
                <Wand2 className="size-3.5" />
              </button>
              <button type="button" onClick={load} disabled={loading} title="刷新" className="size-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-nx-brand hover:bg-accent/60 transition-colors disabled:opacity-40">
                <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
              </button>
            </div>
          </div>
          {/* 分析进度条 */}
          <AnimatePresence>{analyzing && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-0.5 nx-brand-grad relative">
              <motion.span animate={{ x: ["-100%", "100%"] }} transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }} className="absolute inset-y-0 w-1/2 bg-white/70 rounded-full" />
            </motion.div>
          )}</AnimatePresence>
        </div>

        {/* 空状态：智能引导 */}
        {!loading && nodes.length === 0 && !analyzing && (
          <div className="rounded-xl border border-dashed border-border/70 py-12 px-6 text-center">
            <div className="inline-flex items-center justify-center size-12 rounded-2xl nx-brand-grad nx-glow mb-3">
              <Network className="size-5 text-primary-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground">{providerReady === false ? "配置供应商后自动分析" : "还没有代码图谱"}</p>
            <p className="text-xs text-muted-foreground mt-1 mb-4">
              {providerReady === false
                ? "我会在添加模型供应商后自动扫描并归纳项目结构，无需手动操作。"
                : "进入此页面时会自动分析；也可点击右上角 ✨ 立即分析。"}
            </p>
            {providerReady === false ? (
              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => useNexus.getState().setDetailsOpen(false)}>
                <Settings2 className="size-3" /> 去设置添加供应商
              </Button>
            ) : (
              <Button size="sm" className="h-7 text-[11px] nx-brand-grad border-0 text-primary-foreground" onClick={analyze} disabled={!sessionId}>
                <Sparkles className="size-3" /> 立即分析
              </Button>
            )}
          </div>
        )}

        {/* 工具条（有数据时） */}
        {nodes.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索文件路径、职责或依赖…" className="pl-8 h-8 text-xs" />
            </div>
            <div className="flex items-center gap-1">
              <Badge variant={kindFilter === "all" ? "default" : "outline"} className={cn("text-[10px] px-2 py-0.5 cursor-pointer", kindFilter === "all" && "bg-accent text-foreground")} onClick={() => setKindFilter("all")}>全部</Badge>
              {kinds.map((k) => (
                <Badge key={k} variant={kindFilter === k ? "default" : "outline"} className={cn("text-[10px] px-2 py-0.5 cursor-pointer", kindFilter === k && "bg-accent text-foreground")} onClick={() => setKindFilter(k === kindFilter ? "all" : k)}>
                  {KIND_LABEL[k] || k}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* 节点列表 */}
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="size-5 animate-spin mr-2" /> 加载图谱…
          </div>
        ) : nodes.length > 0 && groups.length === 0 ? (
          <div className="rounded-xl border border-border py-12 text-center text-sm text-muted-foreground">未找到匹配节点</div>
        ) : nodes.length > 0 ? (
          <div className="space-y-3">
            {groups.map(([dir, items]) => (
              <div key={dir} className="rounded-xl border border-border bg-card/30 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card/50">
                  <FolderTree className="size-3.5 text-muted-foreground" />
                  <span className="text-xs font-mono text-foreground/80 truncate">{dir}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground shrink-0">{items.length} 个文件</span>
                </div>
                <div className="divide-y divide-border/50">
                  <AnimatePresence initial={false}>
                    {items.map((n) => {
                      const open = expanded.has(n.id);
                      const isConfig = n.kind === "config";
                      return (
                        <motion.div key={n.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="px-3 py-2">
                          <button type="button" onClick={() => toggle(n.id)} className="w-full text-left flex items-center gap-2">
                            {isConfig ? <FileJson2 className="size-3.5 text-nx-warn shrink-0" /> : <FileCode2 className="size-3.5 text-nx-cyan shrink-0" />}
                            <span className="text-xs font-mono text-foreground truncate flex-1">{n.id}</span>
                            <span className="text-[10px] text-muted-foreground shrink-0 font-mono">{n.loc}行</span>
                            <Badge variant="outline" className="text-[9px] px-1.5 py-0 shrink-0">{KIND_LABEL[n.kind] || n.kind}</Badge>
                            {n.stale && (
                              <Badge variant="outline" className="text-[9px] px-1.5 py-0 shrink-0 text-amber-500 border-amber-500/40" title="文件在分析后已修改，建议重新分析">已过期</Badge>
                            )}
                            <ChevronDown className={cn("size-3 text-muted-foreground shrink-0 transition-transform", open && "rotate-180")} />
                          </button>
                          <AnimatePresence initial={false}>
                            {open && (
                              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden">
                                <div className="mt-1.5 ml-5 space-y-1">
                                  <p className="text-[11px] text-foreground/80 leading-relaxed">{n.summary || "（无摘要）"}</p>
                                  {(n.imports || []).length > 0 && (
                                    <div className="flex items-start gap-1.5 flex-wrap">
                                      <span className="text-[10px] text-muted-foreground shrink-0 inline-flex items-center gap-1 mt-0.5">
                                        <ArrowRight className="size-2.5" /> 依赖：
                                      </span>
                                      {n.imports.slice(0, 12).map((imp) => (
                                        <button key={imp} type="button" onClick={(e) => { e.stopPropagation(); setQuery(imp.replace(" (alias)", "")); }} title={`在列表中定位：${imp}`}>
                                          <Badge variant="secondary" className="text-[9px] px-1.5 py-0 font-mono cursor-pointer hover:border-nx-brand/50 hover:text-nx-brand transition-colors">{imp}</Badge>
                                        </button>
                                      ))}
                                      {n.imports.length > 12 && <span className="text-[10px] text-muted-foreground">+{n.imports.length - 12}</span>}
                                    </div>
                                  )}
                                  <div className="flex items-center gap-2 mt-1.5">
                                    <button type="button" onClick={(e) => { e.stopPropagation(); analyzeFile(n.id); }} className="text-[10px] text-nx-brand hover:text-nx-brand/80 inline-flex items-center gap-0.5 transition-colors active:scale-95" title="让 Agent 读取并分析这个文件">
                                      <Wrench className="size-2.5" /> 让 Agent 分析此文件
                                    </button>
                                    <button type="button" onClick={(e) => { e.stopPropagation(); copyPath(n.id); }} className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 transition-colors active:scale-95" title="复制文件路径">
                                      <Hash className="size-2.5" /> 复制路径
                                    </button>
                                  </div>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
