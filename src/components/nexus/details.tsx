"use client";
import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Info,
  Activity,
  Clock,
  Cpu,
  GitBranch,
  Wrench,
  CircleDot,
  ChevronRight,
} from "lucide-react";
import { useNexus } from "@/hooks/nexus/use-nexus";
import type { EventType } from "@/lib/nexus/types";
import { cn } from "@/lib/utils";

const EVENT_LABEL: Record<EventType, string> = {
  "session/created": "会话创建",
  "user/message": "用户消息",
  "assistant/message": "助手消息",
  "assistant/chunk": "助手流式",
  "assistant/thinking": "助手思考",
  "assistant/thinking_chunk": "思考流式",
  "tool/call": "工具调用",
  "tool/result": "工具结果",
  "tool/error": "工具错误",
  "tool/approval_request": "工具审批",
  "graph/node_start": "节点开始",
  "graph/node_end": "节点结束",
  "graph/turn_start": "回合开始",
  "graph/turn_end": "回合结束",
  "decision/record": "决策记录",
  "evidence/added": "证据追加",
  "session/goal": "会话目标",
  "session/plan": "执行计划",
  "context/compacted": "上下文压缩",
  error: "错误",
};

const EVENT_TONE: Partial<Record<EventType, string>> = {
  "user/message": "text-nx-cyan",
  "assistant/message": "text-nx-brand",
  "assistant/chunk": "text-nx-brand",
  "tool/call": "text-nx-warn",
  "tool/result": "text-nx-success",
  "tool/error": "text-nx-error",
  "decision/record": "text-nx-brand-2",
  error: "text-nx-error",
};

function NodeDetail() {
  const nodeId = useNexus((s) => s.selectedNodeId);
  const nodes = useNexus((s) => s.graphNodes);
  const node = useMemo(() => nodes.find((n) => n.id === nodeId), [nodes, nodeId]);
  if (!node) return null;

  const kindLabel = {
    user_input: "用户输入",
    llm_call: "LLM 推理",
    tool: "工具节点",
    tool_node: "工具节点",
    finalize: "回合结束",
  }[node.kind] || node.kind;

  const statusTone =
    node.status === "running" ? "text-nx-brand" :
    node.status === "done" ? "text-nx-success" :
    node.status === "error" ? "text-nx-error" : "text-muted-foreground";

  return (
    <div className="space-y-4">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">节点</div>
        <div className="flex items-center gap-2">
          <CircleDot className={cn("size-4", statusTone)} />
          <span className="text-sm font-medium text-foreground">{node.label}</span>
          <span className={cn("text-[10px] px-1.5 py-0.5 rounded bg-accent", statusTone)}>
            {node.status}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <Field label="类型" value={kindLabel} />
        <Field label="状态" value={node.status} tone={statusTone} />
        <Field
          label="开始"
          value={node.startedAt ? new Date(node.startedAt).toLocaleString("zh-CN") : "—"}
        />
        <Field
          label="结束"
          value={node.endedAt ? new Date(node.endedAt).toLocaleString("zh-CN") : "—"}
        />
        <Field
          label="耗时"
          value={node.durationMs ? `${node.durationMs} ms` : "—"}
        />
      </div>

      {node.meta && Object.keys(node.meta).length > 0 ? (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">元数据</div>
          <pre className="text-[11px] font-mono bg-background/60 border border-border rounded-md p-2 overflow-x-auto nx-scroll">
            {JSON.stringify(node.meta, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-md bg-background/40 border border-border/60 px-2 py-1.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={cn("text-xs text-foreground truncate", tone)}>{value}</div>
    </div>
  );
}

function DecisionDetail() {
  const decisionId = useNexus((s) => s.selectedDecisionId);
  const decisions = useNexus((s) => s.decisions);
  const d = useMemo(() => decisions.find((x) => x.id === decisionId), [decisions, decisionId]);
  if (!d) return null;

  return (
    <div className="space-y-4">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">决策</div>
        <div className="flex items-center gap-2">
          <GitBranch className="size-4 text-nx-brand-2" />
          <span className="text-sm font-medium text-foreground">回合 {d.turn} 决策</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="flex items-center gap-1.5 rounded-md bg-background/40 border border-border/60 px-2 py-1.5">
          <Cpu className="size-3 text-nx-brand" />
          <div className="min-w-0">
            <div className="text-[10px] text-muted-foreground">模型</div>
            <div className="text-xs text-foreground truncate">{d.provider}/{d.model}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 rounded-md bg-background/40 border border-border/60 px-2 py-1.5">
          <Activity className="size-3 text-nx-brand-2" />
          <div className="min-w-0">
            <div className="text-[10px] text-muted-foreground">协议</div>
            <div className="text-xs text-foreground truncate">
              {d.protocol === "native" ? "原生函数调用" : "文本协议"}
            </div>
          </div>
        </div>
        <Field label="耗时" value={`${d.durationMs} ms`} />
        <Field
          label="工具调用"
          value={d.hasToolCalls ? `${d.toolCalls.length} 次` : "无"}
          tone={d.hasToolCalls ? "text-nx-warn" : "text-muted-foreground"}
        />
        <Field
          label="Token 估算"
          value={`输入 ~${(d.inputTokens ?? 0).toLocaleString()} · 输出 ~${(d.outputTokens ?? 0).toLocaleString()}`}
          tone="text-muted-foreground"
        />
      </div>

      {d.contextSummary ? (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">上下文摘要</div>
          <p className="text-xs text-foreground/80 bg-background/40 border border-border/60 rounded-md p-2">
            {d.contextSummary}
          </p>
        </div>
      ) : null}

      {d.toolCalls.length > 0 ? (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">工具调用</div>
          <div className="space-y-1">
            {d.toolCalls.map((tc) => (
              <div key={tc.id} className="rounded-md bg-background/40 border border-border/60 p-2">
                <div className="flex items-center gap-1.5 mb-1">
                  <Wrench className="size-3 text-nx-warn" />
                  <span className="text-xs font-mono text-foreground">{tc.name}</span>
                </div>
                <pre className="text-[10px] font-mono text-muted-foreground overflow-x-auto nx-scroll">
                  {JSON.stringify(tc.arguments, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {d.thinking ? (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">推理内容</div>
          <pre className="text-[11px] font-mono whitespace-pre-wrap text-foreground/80 bg-background/60 border border-border rounded-md p-2 max-h-80 overflow-y-auto nx-scroll">
            {d.thinking}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

function EventLog() {
  const events = useNexus((s) => s.events);
  const reversed = useMemo(() => [...events].reverse(), [events]);

  if (!events.length) {
    return (
      <div className="text-center text-xs text-muted-foreground py-8">暂无事件日志</div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-2">
        <span>共 {events.length} 条事件</span>
        <span>倒序排列</span>
      </div>
      <div className="max-h-[60vh] overflow-y-auto nx-scroll space-y-1 pr-1">
        {reversed.map((e) => {
          const tone = EVENT_TONE[e.type] || "text-foreground";
          return (
            <div
              key={e.id}
              className="rounded-md border border-border/60 bg-background/40 px-2 py-1.5"
            >
              <div className="flex items-center gap-2 mb-0.5">
                <ChevronRight className={cn("size-3", tone)} />
                <span className={cn("text-[11px] font-medium", tone)}>
                  {EVENT_LABEL[e.type] || e.type}
                </span>
                <span className="ml-auto text-[10px] text-muted-foreground font-mono flex items-center gap-1">
                  <Clock className="size-2.5" />
                  {new Date(e.createdAt).toLocaleTimeString("zh-CN", { hour12: false })}
                </span>
              </div>
              {Object.keys(e.data).length > 0 ? (
                <pre className="text-[10px] font-mono text-muted-foreground overflow-x-auto nx-scroll pl-5">
                  {JSON.stringify(e.data).slice(0, 240)}
                </pre>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function NexusDetails() {
  const open = useNexus((s) => s.detailsOpen);
  const setOpen = useNexus((s) => s.setDetailsOpen);
  const selectedNodeId = useNexus((s) => s.selectedNodeId);
  const selectedDecisionId = useNexus((s) => s.selectedDecisionId);
  const selectNode = useNexus((s) => s.selectNode);
  const selectDecision = useNexus((s) => s.selectDecision);

  const tab: "node" | "decision" | "events" =
    selectedNodeId ? "node" : selectedDecisionId ? "decision" : "events";

  const title = tab === "node" ? "节点详情" : tab === "decision" ? "决策详情" : "事件日志";

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 bg-background/40 backdrop-blur-[1px]"
          />
          <motion.aside
            initial={{ x: 360, opacity: 0.6 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 360, opacity: 0.6 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            className="fixed right-0 top-0 bottom-0 z-50 w-[360px] max-w-[90vw] bg-card border-l border-border flex flex-col"
          >
            <div className="h-12 shrink-0 px-4 flex items-center gap-2 border-b border-border">
              <Info className="size-4 text-nx-brand" />
              <span className="text-sm font-medium text-foreground">{title}</span>
              <button
                type="button"
                onClick={() => {
                  if (selectedNodeId) selectNode(null);
                  else if (selectedDecisionId) selectDecision(null);
                  else setOpen(false);
                }}
                className="ml-auto size-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                title="返回 / 关闭"
              >
                <ChevronRight className="size-4 rotate-180" />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="size-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                title="关闭"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* tab 切换 */}
            <div className="shrink-0 px-3 py-2 border-b border-border flex items-center gap-1">
              {([
                { id: "node", label: "节点", disabled: !selectedNodeId },
                { id: "decision", label: "决策", disabled: !selectedDecisionId },
                { id: "events", label: "事件", disabled: false },
              ] as const).map((t) => {
                const isActive = tab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    disabled={t.disabled}
                    onClick={() => {
                      if (t.id === "events") {
                        selectNode(null);
                        selectDecision(null);
                      }
                    }}
                    className={cn(
                      "px-2.5 py-1 text-[11px] rounded-md transition-colors",
                      isActive
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                      t.disabled && "opacity-40 cursor-not-allowed hover:text-muted-foreground"
                    )}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto nx-scroll p-4">
              {tab === "node" ? <NodeDetail /> : tab === "decision" ? <DecisionDetail /> : <EventLog />}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
