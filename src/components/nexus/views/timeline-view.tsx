"use client";
// NEXUS 时间轴 · 时间回溯：把事件、工具调用、快照统一成一条可拖动回看的时间线。
// 拖动/点击检查点 → 纯前端预览该时刻的对话 → 一键回溯（服务端先做保护性快照再回滚事件）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Camera, History, User, Brain, Wrench, CheckCircle2, XCircle, GitBranch,
  Loader2, RotateCcw, Plus, Flag, CircleDot, ShieldCheck, Check, X,
  Trash2, ChevronLeft, ChevronRight, Rewind, Zap, Target, ListChecks, Archive, FileDown, Search,
} from "lucide-react";
import { useNexus } from "@/hooks/nexus/use-nexus";
import { projectMessages } from "@/lib/nexus/projections";
import { selectSession } from "../app-frame";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const EVENT_META: Record<string, { label: string; icon: any; tone: string }> = {
  "session/created": { label: "会话创建", icon: CircleDot, tone: "text-muted-foreground" },
  "user/message": { label: "用户消息", icon: User, tone: "text-nx-cyan" },
  "assistant/message": { label: "助手消息", icon: Brain, tone: "text-nx-brand" },
  "tool/call": { label: "工具调用", icon: Wrench, tone: "text-nx-warn" },
  "tool/result": { label: "工具结果", icon: CheckCircle2, tone: "text-nx-success" },
  "tool/error": { label: "工具错误", icon: XCircle, tone: "text-nx-error" },
  "tool/approval_request": { label: "工具审批", icon: Wrench, tone: "text-nx-warn" },
  "graph/node_start": { label: "节点开始", icon: GitBranch, tone: "text-muted-foreground" },
  "graph/node_end": { label: "节点结束", icon: GitBranch, tone: "text-muted-foreground" },
  "graph/turn_start": { label: "回合开始", icon: Flag, tone: "text-nx-brand" },
  "graph/turn_end": { label: "回合结束", icon: Flag, tone: "text-nx-success" },
  "decision/record": { label: "决策记录", icon: Brain, tone: "text-nx-brand-2" },
  "evidence/added": { label: "证据追加", icon: CircleDot, tone: "text-muted-foreground" },
  "session/goal": { label: "会话目标", icon: Target, tone: "text-nx-cyan" },
  "session/plan": { label: "执行计划", icon: ListChecks, tone: "text-nx-cyan" },
  "context/compacted": { label: "上下文压缩", icon: Archive, tone: "text-nx-warn" },
  error: { label: "错误", icon: XCircle, tone: "text-nx-error" },
};

const FILTERS: { id: string; label: string; match: (t: string) => boolean }[] = [
  { id: "all", label: "全部", match: () => true },
  { id: "messages", label: "消息", match: (t) => t === "user/message" || t === "assistant/message" },
  { id: "tools", label: "工具", match: (t) => t.startsWith("tool/") },
  { id: "system", label: "系统", match: (t) => t.startsWith("graph/") || t === "decision/record" || t === "session/created" || t === "session/goal" || t === "session/plan" || t === "context/compacted" || t === "error" },
];

function summarizeEvent(e: { type: string; data: Record<string, any> }): string {
  const d = e.data || {};
  if (e.type === "user/message" || e.type === "assistant/message") return String(d.content || "").slice(0, 140);
  if (e.type === "session/goal") return d.cleared ? "（已清除目标）" : String(d.content || "").slice(0, 140);
  if (e.type === "session/plan") return "结构化执行计划已生成（展开查看）";
  if (e.type === "context/compacted") return `压缩 ${d.beforeTokens ?? "?"}→${d.afterTokens ?? "?"} tokens · 保留事件 #${d.keptFromSeq ?? "?"} 之后${d.manual ? " · 手动" : ""}`;
  if (e.type === "tool/call") return `${d.toolCall?.name ?? ""} ${JSON.stringify(d.toolCall?.arguments ?? {}).slice(0, 100)}`;
  if (e.type === "tool/result" || e.type === "tool/error") return String(d.content || "").slice(0, 140);
  if (e.type === "decision/record") return `${d.provider ?? ""} ${d.model ?? ""} · ${d.hasToolCalls ? "含工具调用" : "直接回答"}`;
  return JSON.stringify(d).slice(0, 140);
}

interface SnapshotItem {
  id: string;
  label: string;
  reason: string;
  turn: number | null;
  eventSeq: number | null;
  createdAt: string;
  restorable?: boolean;
}

interface ApprovalItem {
  id: string;
  sessionId: string;
  toolName: string;
  arguments: Record<string, any>;
  status: string;
  riskLevel?: string;
  modeAtRequest?: string;
  createdAt: string;
}

const spring = { type: "spring" as const, stiffness: 380, damping: 32 };

export function TimelineView() {
  const events = useNexus((s) => s.events);
  const sessionId = useNexus((s) => s.activeSessionId);
  const runStatus = useNexus((s) => s.runStatus);
  const cursor = useNexus((s) => s.timelineCursor);
  const setCursor = useNexus((s) => s.setTimelineCursor);
  const send = useNexus((s) => s.send);

  const [snapshots, setSnapshots] = useState<SnapshotItem[]>([]);
  const [loadingSnapshots, setLoadingSnapshots] = useState(false);
  const [creating, setCreating] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [pruneFiles, setPruneFiles] = useState(false);
  const [rewinding, setRewinding] = useState(false);
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [thumbActive, setThumbActive] = useState(false);
  const [fileRestoreFor, setFileRestoreFor] = useState<SnapshotItem | null>(null);
  const { toast } = useToast();

  const persisted = useMemo(() => events.filter((e) => e.seq >= 0), [events]);
  const maxSeq = persisted.length ? persisted[persisted.length - 1].seq : 0;
  const checkpoints = useMemo(
    () => persisted.filter((e) => e.type === "user/message").map((e) => ({ seq: e.seq, content: String(e.data?.content || ""), createdAt: e.createdAt })),
    [persisted],
  );
  const cursorSeq = cursor ?? maxSeq;
  const previewing = cursor != null && cursor < maxSeq;
  const droppedCount = previewing ? persisted.filter((e) => e.seq > cursorSeq).length : 0;
  const previewMessages = useMemo(
    () => (previewing ? projectMessages(persisted.filter((e) => e.seq <= cursorSeq)) : []),
    [previewing, persisted, cursorSeq],
  );

  const loadSnapshots = useCallback(async () => {
    if (!sessionId) return;
    setLoadingSnapshots(true);
    try {
      const res = await fetch(`/api/snapshots?sessionId=${encodeURIComponent(sessionId)}`);
      const data = await res.json();
      setSnapshots(data.snapshots || []);
    } catch {
      toast({ title: "加载快照失败", variant: "destructive" });
    } finally {
      setLoadingSnapshots(false);
    }
  }, [sessionId, toast]);

  const loadApprovals = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/tool-approvals?status=pending&sessionId=${encodeURIComponent(sessionId)}`);
      const data = await res.json();
      setApprovals(data.approvals || []);
    } catch {
      // 审批列表加载失败不阻塞时间轴
    }
  }, [sessionId]);

  // 快照：挂载时 + 运行状态变化时刷新（去掉单独挂载 effect，避免重复请求）
  useEffect(() => { if (runStatus !== "running") loadSnapshots(); }, [runStatus, sessionId, loadSnapshots]);
  // 审批：运行状态变化时刷新（不再按 events.length——流式期间每个 chunk 都会触发一次请求）
  useEffect(() => { loadApprovals(); }, [loadApprovals, runStatus, sessionId]);

  const create = async () => {
    if (!sessionId || creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, label: "时间轴快照", reason: "timeline" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "创建失败");
      toast({ title: "快照已创建", description: `事件 #${data.snapshot?.eventSeq ?? "—"}` });
      await loadSnapshots();
    } catch (err: any) {
      toast({ title: "创建快照失败", description: err?.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  // 时间回溯：服务端先做保护性快照，再回滚事件流；随后前端就地重载会话
  const rewindHere = async () => {
    if (!sessionId || !previewing || rewinding) return;
    setRewinding(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/rewind`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventSeq: cursorSeq }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "回溯失败");
      toast({ title: "已回溯", description: `移除 ${data.rolledBackEvents} 条事件 · 已自动保护性快照` });
      setCursor(null);
      await selectSession(sessionId);
      await loadSnapshots();
    } catch (err: any) {
      toast({ title: "回溯失败", description: err?.message, variant: "destructive" });
    } finally {
      setRewinding(false);
    }
  };

  const restore = async (s: SnapshotItem) => {
    if (!confirm(`恢复到「${s.label}」？会话事件将回滚到 #${s.eventSeq ?? "—"}${pruneFiles ? "，并删除快照后新增的文件" : ""}。`)) return;
    setRestoringId(s.id);
    try {
      const res = await fetch(`/api/snapshots/${s.id}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pruneFiles }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "恢复失败");
      toast({
        title: data.fileRestoreBlocked ? "部分恢复" : "已恢复",
        variant: data.fileRestoreBlocked ? "destructive" : undefined,
        description: data.fileRestoreBlocked
          ? `${data.rolledBackEvents ?? 0} 条事件已回滚，但${data.fileRestoreBlocked}`
          : `回滚 ${data.rolledBackEvents ?? 0} 条事件 · 还原 ${data.restoredFiles ?? 0} 个文件${data.prunedFiles ? ` · 清理 ${data.prunedFiles} 个新增文件` : ""}`,
      });
      setCursor(null);
      if (sessionId) await selectSession(sessionId);
      await loadSnapshots();
    } catch (err: any) {
      toast({ title: "恢复失败", description: err?.message, variant: "destructive" });
    } finally {
      setRestoringId(null);
    }
  };

  const removeSnapshot = async (s: SnapshotItem) => {
    if (!confirm(`删除快照「${s.label}」？`)) return;
    try {
      const res = await fetch(`/api/snapshots/${s.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("删除失败");
      toast({ title: "快照已删除" });
      await loadSnapshots();
    } catch (err: any) {
      toast({ title: "删除失败", description: err?.message, variant: "destructive" });
    }
  };

  const resolveApproval = async (approval: ApprovalItem, status: "approved" | "rejected") => {
    setResolvingId(approval.id);
    try {
      const res = await fetch(`/api/tool-approvals/${approval.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "操作失败");
      toast({
        title: status === "approved" ? "已批准，正在自动继续执行" : "已拒绝",
        description: status === "approved" ? `${approval.toolName} · Agent 将自动重放上一条消息` : approval.toolName,
      });
      await loadApprovals();
      // 批准后自动续跑：服务端重放最近一条用户消息（已批准的相同调用不再弹审批）
      if (status === "approved" && approval.sessionId && send) {
        send({ type: "chat:rerun", sessionId: approval.sessionId });
      }
    } catch (err: any) {
      toast({ title: "操作失败", description: err?.message, variant: "destructive" });
    } finally {
      setResolvingId(null);
    }
  };

  const stepCursor = (dir: 1 | -1) => {
    const seqs = [0, ...checkpoints.map((c) => c.seq), maxSeq].sort((a, b) => a - b);
    const idx = seqs.findIndex((s) => s >= cursorSeq);
    const next = dir === 1 ? seqs[Math.min(idx + 1, seqs.length - 1)] : seqs[Math.max(idx - 1, 0)];
    setCursor(next >= maxSeq ? null : next);
  };

  const railRef = useRef<HTMLDivElement>(null);
  const pct = maxSeq > 0 ? (cursorSeq / maxSeq) * 100 : 100;

  const visibleEvents = useMemo(() => {
    const f = FILTERS.find((x) => x.id === filter) ?? FILTERS[0];
    return persisted.filter((e) => f.match(e.type));
  }, [persisted, filter]);

  return (
    <div className="h-full overflow-y-auto nx-scroll relative">
      <div className="max-w-4xl mx-auto px-4 py-5 space-y-4 pb-40">
        {/* ── 回溯 Scrubber ── */}
        <div className="rounded-xl border border-border bg-card/40 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Rewind className="size-4 text-nx-brand" />
            <h3 className="text-sm font-medium">时间回溯</h3>
            <span className="text-[10px] text-muted-foreground ml-auto">
              {checkpoints.length} 个检查点 · 事件 #{maxSeq}
            </span>
          </div>

          {checkpoints.length === 0 ? (
            <div className="text-xs text-muted-foreground py-3 text-center">发送一条消息后，这里会出现可回溯的检查点。</div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => stepCursor(-1)} className="size-7 shrink-0 inline-flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-nx-brand/40 transition-colors active:scale-90" title="上一个检查点">
                  <ChevronLeft className="size-4" />
                </button>
                <div ref={railRef} className="relative flex-1 h-9 flex items-center">
                  {/* 轨道 */}
                  <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-border overflow-hidden">
                    <motion.div
                      className="h-full nx-brand-grad rounded-full"
                      animate={{ width: `${pct}%` }}
                      transition={spring}
                    />
                  </div>
                  {/* 检查点刻度 */}
                  {checkpoints.map((c) => (
                    <button
                      key={c.seq}
                      type="button"
                      title={`#${c.seq} · ${c.content.slice(0, 50)}`}
                      onClick={() => setCursor(c.seq >= maxSeq ? null : c.seq)}
                      style={{ left: `${maxSeq > 0 ? (c.seq / maxSeq) * 100 : 100}%` }}
                      className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 size-2.5 rounded-full border border-border bg-card hover:scale-125 hover:border-nx-brand transition-transform z-10"
                    />
                  ))}
                  {/* 拖动游标 */}
                  <motion.div
                    animate={{ left: `${pct}%`, scale: thumbActive ? 1.25 : 1 }}
                    transition={spring}
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 size-5 rounded-full nx-brand-grad nx-glow z-20 pointer-events-none flex items-center justify-center"
                  >
                    <Zap className="size-2.5 text-primary-foreground" />
                  </motion.div>
                  {/* 原生 range 叠加：负责拖动/键盘可达性 */}
                  <input
                    type="range"
                    min={0}
                    max={Math.max(maxSeq, 1)}
                    step={1}
                    value={cursorSeq}
                    onFocus={() => setThumbActive(true)}
                    onBlur={() => setThumbActive(false)}
                    onPointerDown={() => setThumbActive(true)}
                    onPointerUp={() => setThumbActive(false)}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setCursor(v >= maxSeq ? null : v);
                    }}
                    className="absolute inset-0 w-full opacity-0 cursor-pointer z-30"
                    aria-label="时间回溯游标"
                  />
                </div>
                <button type="button" onClick={() => stepCursor(1)} className="size-7 shrink-0 inline-flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-nx-brand/40 transition-colors active:scale-90" title="下一个检查点">
                  <ChevronRight className="size-4" />
                </button>
              </div>
              <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>会话开始</span>
                <AnimatePresence mode="wait">
                  <motion.span key={cursorSeq} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="font-mono text-nx-brand">
                    {previewing ? `预览中 · 保留到 #${cursorSeq}` : "当前（实时）"}
                  </motion.span>
                </AnimatePresence>
                <span>现在</span>
              </div>
            </>
          )}
        </div>

        {/* ── 待审批工具 ── */}
        {approvals.length > 0 && (
          <motion.div layout className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
            <div className="flex items-center gap-2 mb-3">
              <ShieldCheck className="size-4 text-nx-warn" />
              <h3 className="text-sm font-medium">待审批工具</h3>
              <span className="text-[10px] text-muted-foreground ml-auto">{approvals.length} 个 · 批准后重发上一条消息即可继续</span>
            </div>
            <div className="space-y-2">
              {approvals.map((a) => (
                <div key={a.id} className="rounded-lg border border-border/60 bg-background/40 p-2.5">
                  <div className="flex items-center gap-2 text-xs">
                    <Wrench className="size-3.5 text-nx-warn" />
                    <span className="font-medium">{a.toolName}</span>
                    {a.riskLevel && (
                      <Badge variant="outline" className={cn("text-[9px] px-1 py-0", a.riskLevel === "system_critical" ? "text-nx-error border-nx-error/40" : "text-nx-warn border-amber-500/40")}>
                        {a.riskLevel === "system_critical" ? "系统保护" : a.riskLevel === "high" ? "高风险" : "低风险"}
                      </Badge>
                    )}
                    <span className="ml-auto text-[10px] text-muted-foreground">{new Date(a.createdAt).toLocaleString("zh-CN")}</span>
                  </div>
                  <pre className="mt-1 text-[10px] font-mono text-muted-foreground whitespace-pre-wrap break-words bg-muted/30 rounded p-1.5">
                    {JSON.stringify(a.arguments, null, 2)}
                  </pre>
                  <div className="flex items-center gap-2 mt-2">
                    <Button size="sm" className="h-6 text-[10px]" onClick={() => resolveApproval(a, "approved")} disabled={resolvingId === a.id}>
                      {resolvingId === a.id ? <Loader2 className="size-2.5 animate-spin" /> : <Check className="size-2.5" />}
                      批准
                    </Button>
                    <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => resolveApproval(a, "rejected")} disabled={resolvingId === a.id}>
                      <X className="size-2.5" />
                      拒绝
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* ── 快照区 ── */}
        <div className="rounded-xl border border-border bg-card/40 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Camera className="size-4 text-nx-brand" />
            <h3 className="text-sm font-medium">快照</h3>
            <span className="text-[10px] text-muted-foreground ml-auto">{snapshots.length} 个</span>
            <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={create} disabled={creating || !sessionId}>
              {creating ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
              创建
            </Button>
          </div>
          <label className="flex items-center gap-1.5 mb-2 text-[10px] text-muted-foreground cursor-pointer select-none w-fit">
            <input type="checkbox" checked={pruneFiles} onChange={(e) => setPruneFiles(e.target.checked)} className="accent-[var(--nx-brand)] size-3" />
            恢复时同时删除快照之后新增的文件（真·回退）
          </label>
          {loadingSnapshots ? (
            <div className="text-xs text-muted-foreground py-2">加载中…</div>
          ) : snapshots.length === 0 ? (
            <div className="text-xs text-muted-foreground py-2">暂无快照。write / pwsh 等工具执行前会自动创建。</div>
          ) : (
            <div className="space-y-1.5">
              <AnimatePresence initial={false}>
                {snapshots.map((s) => (
                  <motion.div
                    key={s.id}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={spring}
                    className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-2.5 py-1.5 text-xs"
                  >
                    <History className={cn("size-3.5 shrink-0", s.restorable === false ? "text-muted-foreground/40" : "text-nx-brand")} />
                    <span className="font-medium truncate max-w-[200px]" title={s.label}>{s.label}</span>
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 shrink-0">{s.reason}</Badge>
                    {s.restorable === false && (
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 shrink-0 border-destructive/40 text-destructive" title="文件备份已丢失：只能回滚会话事件，无法还原项目文件">
                        文件备份缺失
                      </Badge>
                    )}
                    {s.eventSeq != null && <span className="text-[10px] font-mono text-muted-foreground shrink-0">#{s.eventSeq}</span>}
                    {(s as any).eventCount != null && <span className="text-[10px] text-muted-foreground shrink-0">{(s as any).eventCount}事件 / {(s as any).fileCount ?? 0}文件</span>}
                    <span className="text-[10px] text-muted-foreground shrink-0 ml-auto">{new Date(s.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                    <Button size="sm" variant="outline" className="h-6 text-[10px] shrink-0" onClick={() => restore(s)} disabled={restoringId === s.id}>
                      {restoringId === s.id ? <Loader2 className="size-2.5 animate-spin" /> : <RotateCcw className="size-2.5" />}
                      恢复
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px] shrink-0" onClick={() => setFileRestoreFor(s)} title="从该快照恢复单个文件">
                      <FileDown className="size-2.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px] hover:text-destructive shrink-0" onClick={() => removeSnapshot(s)} title="删除快照">
                      <Trash2 className="size-2.5" />
                    </Button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* ── 事件时间线 ── */}
        <div className="rounded-xl border border-border bg-card/30 p-4">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <GitBranch className="size-4 text-nx-brand" />
            <h3 className="text-sm font-medium">执行时间线</h3>
            <div className="flex items-center gap-1 ml-auto">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={cn(
                    "relative px-2 py-0.5 rounded text-[10px] transition-colors",
                    filter === f.id ? "text-nx-brand" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {f.label}
                  {filter === f.id && (
                    <motion.span layoutId="nx-tl-filter" transition={spring} className="absolute inset-0 -z-10 rounded bg-nx-brand/10 border border-nx-brand/30" />
                  )}
                </button>
              ))}
            </div>
          </div>
          {visibleEvents.length === 0 ? (
            <div className="text-center py-10 text-sm text-muted-foreground">暂无事件</div>
          ) : (
            <div className="space-y-0">
              {visibleEvents.map((e, i) => {
                const meta = EVENT_META[e.type] || { label: e.type, icon: CircleDot, tone: "text-muted-foreground" };
                const Icon = meta.icon;
                const summary = summarizeEvent(e);
                const expanded = expandedId === `${e.id}-${i}`;
                return (
                  <div key={`${e.id}-${i}`} className="relative pl-8 border-l border-border last:border-l-transparent">
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : `${e.id}-${i}`)}
                      className={cn(
                        "absolute -left-[7px] top-1 size-3.5 rounded-full bg-card border-2 flex items-center justify-center hover:scale-125 transition-transform",
                        meta.tone,
                        previewing && e.seq > cursorSeq && "opacity-30"
                      )}
                      title={expanded ? "收起" : "展开详情"}
                    >
                      <Icon className="size-2" />
                    </button>
                    <div className="pb-4 cursor-pointer" onClick={() => setExpandedId(expanded ? null : `${e.id}-${i}`)}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={cn("text-xs font-medium", meta.tone)}>{meta.label}</span>
                        <span className="text-[10px] text-muted-foreground font-mono">#{e.seq}</span>
                        {e.data?.turn ? <Badge variant="outline" className="text-[9px] px-1.5 py-0">第 {e.data.turn} 轮</Badge> : null}
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          {new Date(e.createdAt).toLocaleTimeString("zh-CN", { hour12: false })}
                        </span>
                      </div>
                      {summary && summary !== "{}" ? (
                        <p className={cn("mt-0.5 text-[11px] text-muted-foreground line-clamp-2", previewing && e.seq > cursorSeq && "line-through opacity-40")}>{summary}</p>
                      ) : null}
                      <AnimatePresence>
                        {expanded && (
                          <motion.pre
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.18, ease: "easeOut" }}
                            className="mt-1.5 overflow-hidden text-[10px] font-mono text-muted-foreground whitespace-pre-wrap break-words bg-background/40 border border-border/50 rounded-md p-2"
                          >
                            {JSON.stringify(e.data, null, 2)}
                          </motion.pre>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── 回溯预览底部面板 ── */}
      <AnimatePresence>
        {previewing && (
          <motion.div
            initial={{ y: 120, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 120, opacity: 0 }}
            transition={{ type: "spring", stiffness: 340, damping: 32 }}
            className="absolute inset-x-0 bottom-0 z-40 border-t border-nx-brand/30 bg-popover/95 backdrop-blur-md shadow-2xl"
          >
            <div className="max-w-4xl mx-auto p-4">
              <div className="flex items-center gap-2 mb-2">
                <Rewind className="size-4 text-nx-brand" />
                <span className="text-sm font-medium">预览 · 事件 #0 – #{cursorSeq}</span>
                <Badge variant="outline" className="text-[10px] text-nx-warn border-nx-warn/40">{droppedCount} 条后续事件将被移除</Badge>
                <span className="ml-auto text-[10px] text-muted-foreground">{previewMessages.length} 条消息 · 回溯前会自动创建保护性快照</span>
              </div>
              <div className="max-h-44 overflow-y-auto nx-scroll rounded-lg border border-border/60 bg-background/40 p-3 space-y-2">
                {previewMessages.map((m) => (
                  <div key={m.id} className={cn("flex gap-2 text-xs", m.role === "user" && "flex-row-reverse")}>
                    <span className={cn("shrink-0 size-5 rounded flex items-center justify-center", m.role === "user" ? "bg-accent text-muted-foreground" : "nx-brand-grad text-primary-foreground")}>
                      {m.role === "user" ? <User className="size-3" /> : <Zap className="size-3" />}
                    </span>
                    <p className={cn(
                      "max-w-[75%] rounded-lg px-2.5 py-1.5 whitespace-pre-wrap line-clamp-4",
                      m.role === "user" ? "bg-nx-brand/15 text-foreground" : "bg-card border border-border text-foreground"
                    )}>{m.content}</p>
                  </div>
                ))}
                {previewMessages.length === 0 && <div className="text-xs text-muted-foreground text-center py-4">该时刻还没有消息</div>}
              </div>
              <div className="flex items-center gap-2 mt-3">
                <Button onClick={rewindHere} disabled={rewinding} className="nx-brand-grad border-0 text-white active:scale-[0.98] transition-transform">
                  {rewinding ? <Loader2 className="size-3.5 animate-spin" /> : <Rewind className="size-3.5" />}
                  回溯到这里
                </Button>
                <Button variant="outline" onClick={() => setCursor(null)}>返回现在</Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 单文件恢复对话框 */}
      <SnapshotFileRestoreDialog snapshot={fileRestoreFor} onClose={() => setFileRestoreFor(null)} />
    </div>
  );
}

function SnapshotFileRestoreDialog({ snapshot, onClose }: { snapshot: SnapshotItem | null; onClose: () => void }) {
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [restoring, setRestoring] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (!snapshot) { setFiles([]); return; }
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/snapshots/${snapshot.id}/files`);
        const data = await res.json();
        setFiles(Array.isArray(data.files) ? data.files : []);
      } catch { setFiles([]); }
      finally { setLoading(false); }
    })();
  }, [snapshot]);

  const restore = async (rel: string) => {
    if (!snapshot || restoring) return;
    if (!confirm(`从快照「${snapshot.label}」恢复文件 ${rel} 到工作区？（覆盖当前文件）`)) return;
    setRestoring(rel);
    try {
      const res = await fetch(`/api/snapshots/${snapshot.id}/file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: rel }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "恢复失败");
      toast({ title: "文件已恢复", description: rel });
    } catch (err: any) {
      toast({ title: "恢复失败", description: err?.message, variant: "destructive" });
    } finally { setRestoring(null); }
  };

  const filtered = files.filter((f) => !query.trim() || f.toLowerCase().includes(query.toLowerCase()));

  return (
    <Dialog open={!!snapshot} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md max-h-[80vh] flex flex-col" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileDown className="size-4 text-nx-brand" /> 从快照恢复文件</DialogTitle>
          <DialogDescription className="text-[11px]">{snapshot?.label} · 选择要恢复的文件（覆盖工作区同名文件）</DialogDescription>
        </DialogHeader>
        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索文件…" className="pl-8 h-8 text-xs" />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto nx-scroll space-y-1 pr-1">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-xs"><Loader2 className="size-3.5 animate-spin mr-2" /> 加载文件清单…</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 text-xs text-muted-foreground">{files.length === 0 ? "该快照没有文件备份" : "无匹配文件"}</div>
          ) : (
            filtered.slice(0, 200).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => restore(f)}
                disabled={restoring === f}
                className="w-full text-left rounded-md border border-border/60 bg-background/40 px-2.5 py-1.5 text-[11px] font-mono hover:border-nx-brand/40 hover:text-nx-brand transition-colors disabled:opacity-50"
              >
                {restoring === f ? <Loader2 className="size-2.5 animate-spin inline mr-1" /> : <FileDown className="size-2.5 inline mr-1 text-muted-foreground" />}
                {f}
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
