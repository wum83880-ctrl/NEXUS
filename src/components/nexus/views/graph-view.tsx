"use client";
// NEXUS Graph 架构可视化 — 展示 Agent 的 DAG 执行图架构
// 创新功能：实时展示对话的图执行过程 + 可视化节点关系
import { motion, AnimatePresence } from "framer-motion";
import { useNexus } from "@/hooks/nexus/use-nexus";
import { GitBranch, Zap, Brain, Wrench, Flag, User, ArrowRight, Circle, Check, X, Loader2, Network } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

const NODE_ICONS: Record<string, any> = {
  user_input: User,
  llm_call: Brain,
  tool_node: Wrench,
  finalize: Flag,
  tool: Wrench,
  decision: Brain,
};

const STATUS_STYLES = {
  idle: { border: "border-border", bg: "bg-card/40", text: "text-muted-foreground", icon: Circle },
  running: { border: "border-nx-brand", bg: "bg-nx-brand/10", text: "text-nx-brand", icon: Loader2 },
  done: { border: "border-nx-success/40", bg: "bg-nx-success/5", text: "text-nx-success", icon: Check },
  error: { border: "border-destructive/40", bg: "bg-destructive/5", text: "text-destructive", icon: X },
};

export function GraphView() {
  const nodes = useNexus((s) => s.graphNodes);
  const edges = useNexus((s) => s.graphEdges);
  const events = useNexus((s) => s.events);
  const decisions = useNexus((s) => s.decisions);
  const selectNode = useNexus((s) => s.selectNode);
  const selectDecision = useNexus((s) => s.selectDecision);
  const selectedNodeId = useNexus((s) => s.selectedNodeId);
  const selectedDecisionId = useNexus((s) => s.selectedDecisionId);

  // 按 turn 分组
  const turns = new Map<number, typeof nodes>();
  for (const n of nodes) {
    const m = n.id.match(/^t(\d+)-/);
    const turn = m ? parseInt(m[1], 10) : 0;
    if (!turns.has(turn)) turns.set(turn, []);
    turns.get(turn)!.push(n);
  }
  const turnEntries = Array.from(turns.entries()).sort((a, b) => a[0] - b[0]);

  if (nodes.length === 0) {
    return (
      <div className="h-full flex items-center justify-center nx-aurora">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-card border border-border mb-4">
            <Network className="w-6 h-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">执行图将在这里实时呈现</p>
          <p className="text-xs text-muted-foreground/70 mt-1">每次对话都会生成一个 DAG</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto nx-scroll nx-grid-bg">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* 架构概览 */}
        <div className="rounded-xl border border-border bg-card/40 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Network className="w-4 h-4 text-nx-brand" />
            <h3 className="text-sm font-medium">图架构概览</h3>
            <span className="text-[10px] text-muted-foreground ml-auto">{nodes.length} 节点 · {edges.length} 边 · {turnEntries.length} 轮</span>
          </div>
          {/* 执行统计：图驱动可观测性，从节点聚合得出 */}
          <GraphStats nodes={nodes} />
          {/* 架构示意 */}
          <div className="flex items-center gap-2 flex-wrap text-[10px]">
            {[
              { label: "user_input", icon: User, color: "text-blue-400" },
              { label: "llm_call", icon: Brain, color: "text-purple-400" },
              { label: "tool_node", icon: Wrench, color: "text-amber-400" },
              { label: "finalize", icon: Flag, color: "text-nx-success" },
            ].map((n, i) => {
              const Icon = n.icon;
              return (
                <div key={n.label} className="flex items-center gap-1">
                  <div className={cn("flex items-center gap-1 px-2 py-1 rounded-md bg-background/60 border border-border", n.color)}>
                    <Icon className="w-3 h-3" />
                    <span className="font-mono">{n.label}</span>
                  </div>
                  {i < 3 && <ArrowRight className="w-3 h-3 text-muted-foreground/40" />}
                </div>
              );
            })}
            <span className="text-muted-foreground ml-2">→ 条件分支 → END</span>
          </div>
        </div>

        {/* 按 turn 展示 */}
        {turnEntries.map(([turn, turnNodes]) => {
          const ordered = [...turnNodes].sort((a, b) => {
            const order: Record<string, number> = { user_input: 0, llm_call: 1, tool: 2, tool_node: 2, finalize: 99 };
            return (order[a.kind] ?? 50) - (order[b.kind] ?? 50);
          });
          const running = turnNodes.filter((n) => n.status === "running").length;
          const done = turnNodes.filter((n) => n.status === "done").length;
          const error = turnNodes.filter((n) => n.status === "error").length;
          const total = turnNodes.length;
          const allDone = done + error === total && total > 0;

          return (
            <motion.div
              key={turn}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl border border-border bg-card/30 backdrop-blur-sm overflow-hidden"
            >
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-md bg-nx-brand/15 text-nx-brand text-[10px] font-mono flex items-center justify-center">{turn}</div>
                  <span className="text-xs font-medium">第 {turn} 轮</span>
                  {running > 0 && <span className="flex items-center gap-1 text-[10px] text-nx-brand"><Loader2 className="w-2.5 h-2.5 animate-spin" />{running} 个运行中</span>}
                </div>
                <div className="flex items-center gap-2 text-[10px]">
                  {done > 0 && <span className="flex items-center gap-0.5 text-nx-success"><Check className="w-2.5 h-2.5" />{done}</span>}
                  {error > 0 && <span className="flex items-center gap-0.5 text-destructive"><X className="w-2.5 h-2.5" />{error}</span>}
                  {allDone && <span className="text-muted-foreground">已完成</span>}
                </div>
              </div>
              <div className="p-4 overflow-x-auto nx-scroll">
                <div className="flex items-center gap-3 min-w-max">
                  <AnimatePresence>
                    {ordered.map((n, i) => {
                      const Icon = NODE_ICONS[n.kind] || GitBranch;
                      const style = STATUS_STYLES[n.status] || STATUS_STYLES.idle;
                      const StatusIcon = style.icon;
                      const isSelected = selectedNodeId === n.id;
                      return (
                        <div key={n.id} className="flex items-center gap-3">
                          <motion.button
                            layout
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            whileHover={{ scale: 1.04 }}
                            whileTap={{ scale: 0.97 }}
                            onClick={() => {
                              if (n.kind === "decision") {
                                // 决策节点 → 打开对应决策详情（按轮次+索引匹配）
                                const meta = (n.meta || {}) as any;
                                const turn = Number(n.id.match(/^t(\d+)-/)?.[1] || 0);
                                const candidates = decisions.filter((d) => d.turn === turn);
                                const d = candidates[Number(meta.decisionIndex) || 0];
                                if (d) { selectDecision(isSelected ? null : d.id); return; }
                              }
                              selectNode(isSelected ? null : n.id);
                            }}
                            className={cn(
                              "relative shrink-0 rounded-xl border px-3 py-2.5 min-w-[130px] text-left transition-colors",
                              style.border, style.bg,
                              isSelected && "ring-2 ring-nx-brand ring-offset-2 ring-offset-background",
                              n.status === "running" && "nx-pulse"
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <div className={cn("w-6 h-6 rounded-md flex items-center justify-center shrink-0", style.bg)}>
                                {n.status === "running" ? <StatusIcon className="w-3 h-3 animate-spin" /> : <Icon className={cn("w-3 h-3", style.text)} />}
                              </div>
                              <div className="min-w-0">
                                <div className="text-[11px] font-mono font-medium truncate">{n.label}</div>
                                <div className="text-[9px] text-muted-foreground">{n.kind}{n.durationMs ? ` · ${n.durationMs}ms` : ""}</div>
                              </div>
                            </div>
                          </motion.button>
                          {i < ordered.length - 1 && <Arrow />}
                        </div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function Arrow() {
  return (
    <div className="flex items-center gap-0.5 shrink-0">
      <div className="h-px w-5 bg-border" />
      <div className="w-0 h-0 border-y-[3px] border-y-transparent border-l-[5px] border-l-border" />
    </div>
  );
}


function GraphStats({ nodes }: { nodes: { kind: string; status: string; durationMs?: number; meta?: any }[] }) {
  const toolNodes = nodes.filter((n) => n.kind === "tool" || n.kind === "tool_node");
  const decisionNodes = nodes.filter((n) => n.kind === "decision");
  const errors = nodes.filter((n) => n.status === "error").length;
  const running = nodes.filter((n) => n.status === "running").length;
  const durations = toolNodes.map((n) => n.durationMs).filter((d): d is number => typeof d === "number" && Number.isFinite(d));
  const avgTool = durations.length ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length) : null;
  const totalTime = durations.reduce((s, d) => s + d, 0);
  const fmt = (ms: number) => (ms >= 1000 ? (ms / 1000).toFixed(1) + "s" : ms + "ms");
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-[11px]">
      {[
        { label: "工具调用", value: String(toolNodes.length), tone: "text-nx-warn" },
        { label: "LLM 决策", value: String(decisionNodes.length), tone: "text-nx-brand-2" },
        { label: "错误 / 运行中", value: `${errors} / ${running}`, tone: errors ? "text-nx-error" : "text-muted-foreground" },
        { label: "工具总耗时", value: durations.length ? fmt(totalTime) + (avgTool ? `（均 ${fmt(avgTool)}）` : "") : "—", tone: "text-nx-success" },
      ].map((s) => (
        <div key={s.label} className="rounded-lg border border-border/60 bg-background/40 px-2.5 py-1.5">
          <div className="text-[9px] text-muted-foreground uppercase tracking-wider">{s.label}</div>
          <div className={cn("font-mono text-xs mt-0.5", s.tone)}>{s.value}</div>
        </div>
      ))}
    </div>
  );
}
