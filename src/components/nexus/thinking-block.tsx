"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function ThinkingBlock({ thinking, streaming }: { thinking?: string; streaming?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!thinking) return null;

  return (
    <div className="rounded-lg border border-[var(--nx-brand-2)]/30 bg-[var(--nx-brand-2)]/5 overflow-hidden text-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--nx-brand-2)]/10 transition-colors"
      >
        <ChevronRight
          className={cn(
            "size-3.5 text-[var(--nx-brand-2)] transition-transform shrink-0",
            open && "rotate-90"
          )}
        />
        <Brain className="size-3.5 text-[var(--nx-brand-2)] shrink-0" />
        <span className="text-xs text-foreground/80">
          思考过程{streaming ? " · 推理中…" : ""}
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground font-mono">
          {thinking.length} 字符
        </span>
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
            <div className="px-3 pb-3 pt-1 border-t border-[var(--nx-brand-2)]/20">
              <pre
                className={cn(
                  "text-[12px] font-mono whitespace-pre-wrap text-foreground/75 leading-relaxed max-h-80 overflow-y-auto nx-scroll",
                  streaming && "nx-caret"
                )}
              >
                {thinking}
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
