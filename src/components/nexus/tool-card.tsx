"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronRight,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Wrench,
} from "lucide-react";
import type { ToolCall, ToolResult } from "@/lib/nexus/types";
import { cn } from "@/lib/utils";

interface ToolCardProps {
  call: ToolCall;
  result?: ToolResult;
  /** 是否运行中：未匹配到结果则视为运行中 */
  running?: boolean;
}

function previewArgs(args: Record<string, any>): string {
  const entries = Object.entries(args);
  if (!entries.length) return "无参数";
  const main = entries[0];
  let val = typeof main[1] === "string" ? main[1] : JSON.stringify(main[1]);
  if (val.length > 64) val = val.slice(0, 64) + "…";
  return `${main[0]}: ${val}`;
}

export function ToolCard({ call, result, running }: ToolCardProps) {
  const [open, setOpen] = useState(false);

  const isRunning = running ?? (!result);
  const isError = result?.status === "error";
  const isDone = !!result && !isError;

  const statusNode = isRunning ? (
    <span className="flex items-center gap-1 text-[11px] text-nx-brand">
      <Loader2 className="size-3 animate-spin" /> 运行中
    </span>
  ) : isError ? (
    <span className="flex items-center gap-1 text-[11px] text-nx-error">
      <AlertTriangle className="size-3" /> 错误
    </span>
  ) : (
    <span className="flex items-center gap-1 text-[11px] text-nx-success">
      <CheckCircle2 className="size-3" /> 完成
      {result?.durationMs ? (
        <span className="text-muted-foreground">· {result.durationMs}ms</span>
      ) : null}
    </span>
  );

  return (
    <div
      className={cn(
        "rounded-lg border bg-card/60 overflow-hidden text-sm",
        isError ? "border-nx-error/40" : "border-border",
        isRunning && "border-nx-brand/40"
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent/40 transition-colors"
      >
        <ChevronRight
          className={cn(
            "size-3.5 text-muted-foreground transition-transform shrink-0",
            open && "rotate-90"
          )}
        />
        <Wrench className="size-3.5 text-nx-brand shrink-0" />
        <span className="font-mono text-xs text-foreground truncate">{call.name}</span>
        <span className="text-xs text-muted-foreground truncate flex-1">
          {previewArgs(call.arguments)}
        </span>
        {statusNode}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-1 space-y-2 border-t border-border/60">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  参数
                </div>
                <pre className="text-[11px] font-mono bg-background/60 rounded-md p-2 overflow-x-auto nx-scroll">
                  {JSON.stringify(call.arguments, null, 2)}
                </pre>
              </div>
              {result && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                    结果
                  </div>
                  <pre
                    className={cn(
                      "text-[11px] font-mono rounded-md p-2 overflow-x-auto nx-scroll max-h-64",
                      isError
                        ? "bg-nx-error/10 text-nx-error"
                        : "bg-background/60 text-foreground"
                    )}
                  >
                    {result.content}
                  </pre>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
