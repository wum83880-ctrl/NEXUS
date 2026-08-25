"use client";
// 会话元数据栏：顶部展示 /goal 设置的总目标与 /plan 生成的执行计划，可编辑、清除、重新生成。
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Target, ListChecks, Pencil, X, RefreshCw, ChevronDown } from "lucide-react";
import { useNexus } from "@/hooks/nexus/use-nexus";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function lastMeta(events: { type: string; data: Record<string, any> }[], type: "session/goal" | "session/plan"): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === type) {
      const c = events[i].data?.content;
      return typeof c === "string" && c.trim() ? c : null;
    }
  }
  return null;
}

async function postMeta(sessionId: string, type: "goal" | "plan", content: string) {
  try {
    const res = await fetch(`/api/sessions/${sessionId}/meta`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, content }),
    });
    const data = await res.json();
    if (res.ok && data.event) {
      useNexus.getState().applyLiveEvent({ type: data.event.type, data: data.event.data, createdAt: data.event.createdAt });
    }
  } catch {}
}

export function SessionMetaBar() {
  const events = useNexus((s) => s.events);
  const sessionId = useNexus((s) => s.activeSessionId);
  const send = useNexus((s) => s.send);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [planOpen, setPlanOpen] = useState(false);

  const goal = lastMeta(events, "session/goal");
  const plan = lastMeta(events, "session/plan");
  if (!sessionId || (!goal && !plan && !editing)) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ type: "spring", stiffness: 340, damping: 32 }}
        className="shrink-0 border-b border-border bg-nx-brand/5"
      >
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-2 space-y-1.5">
          {/* 目标 */}
          {editing ? (
            <div className="flex items-center gap-2">
              <Target className="size-3.5 text-nx-brand shrink-0" />
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { postMeta(sessionId, "goal", draft.trim()); setEditing(false); }
                  if (e.key === "Escape") setEditing(false);
                }}
                placeholder="输入会话总目标，Enter 确认"
                className="flex-1 bg-transparent text-xs outline-none border-b border-nx-brand/40 focus:border-nx-brand py-0.5"
              />
              <Button size="sm" className="h-6 text-[10px] px-2" onClick={() => { postMeta(sessionId, "goal", draft.trim()); setEditing(false); }}>保存</Button>
              <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => setEditing(false)}>取消</Button>
            </div>
          ) : goal ? (
            <div className="flex items-start gap-2 group">
              <Target className="size-3.5 text-nx-brand shrink-0 mt-0.5" />
              <p className="flex-1 text-xs text-foreground/90 line-clamp-2" title={goal}>{goal}</p>
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button type="button" title="编辑目标" onClick={() => { setDraft(goal); setEditing(true); }} className="size-5 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent"><Pencil className="size-3" /></button>
                <button type="button" title="清除目标" onClick={() => postMeta(sessionId, "goal", "")} className="size-5 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-accent"><X className="size-3" /></button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => { setDraft(""); setEditing(true); }} className="flex items-center gap-2 text-[11px] text-muted-foreground hover:text-nx-brand transition-colors">
              <Target className="size-3.5" /> 用 /goal 设置会话总目标，全程约束 Agent 行为
            </button>
          )}

          {/* 计划 */}
          {plan && (
            <div>
              <div className="flex items-start gap-2 group">
                <ListChecks className="size-3.5 text-nx-cyan shrink-0 mt-0.5" />
                <button type="button" onClick={() => setPlanOpen((v) => !v)} className="flex-1 text-left min-w-0">
                  <span className={cn("text-xs text-foreground/80", !planOpen && "line-clamp-1")}>
                    {plan.split("\n").find((l) => l.trim())?.slice(0, 100) || "执行计划"}
                  </span>
                </button>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button type="button" title="重新生成计划" onClick={() => send?.({ type: "chat:plan", sessionId })} className="size-5 inline-flex items-center justify-center rounded text-muted-foreground hover:text-nx-brand hover:bg-accent opacity-0 group-hover:opacity-100 transition-opacity"><RefreshCw className="size-3" /></button>
                  <button type="button" title="清除计划" onClick={() => postMeta(sessionId, "plan", "")} className="size-5 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-accent opacity-0 group-hover:opacity-100 transition-opacity"><X className="size-3" /></button>
                  <motion.span animate={{ rotate: planOpen ? 180 : 0 }} className="text-muted-foreground"><ChevronDown className="size-3" /></motion.span>
                </div>
              </div>
              <AnimatePresence>
                {planOpen && (
                  <motion.pre
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className="overflow-hidden ml-6 mt-1 text-[11px] whitespace-pre-wrap text-foreground/75 font-sans"
                  >
                    <span className="block max-h-56 overflow-y-auto nx-scroll bg-background/60 border border-border rounded-lg p-3">{plan}</span>
                  </motion.pre>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
