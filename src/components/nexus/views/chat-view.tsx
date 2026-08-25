"use client";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  User,
  Zap,
  Copy,
  Check,
  RefreshCw,
  Wrench,
  Rewind,
} from "lucide-react";
import { useNexus } from "@/hooks/nexus/use-nexus";
import type { ChatMessage } from "@/lib/nexus/types";
import { Markdown } from "../markdown";
import { ToolCard } from "../tool-card";
import { ThinkingBlock } from "../thinking-block";
import { EmptyChatState } from "../empty-states";
import { cn } from "@/lib/utils";

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const [copied, setCopied] = useState(false);
  const send = useNexus((s) => s.send);
  const sessionId = useNexus((s) => s.activeSessionId);
  const turn = useNexus((s) => s.runTurn);
  const messages = useNexus((s) => s.messages);
  const openTimelineAt = useNexus((s) => s.openTimelineAt);

  const isUser = msg.role === "user";
  const streaming = msg.streaming;
  // 持久化消息 id 形如 m-<事件seq>；能解析出 seq 才支持"从此处回溯"
  const seqMatch = /^m-(\d+)$/.exec(msg.id);
  const msgSeq = seqMatch ? Number(seqMatch[1]) : null;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const onRegen = () => {
    if (!sessionId || !send) return;
    let prompt = msg.content;
    if (msg.role === "assistant") {
      const idx = messages.findIndex((m) => m.id === msg.id);
      for (let i = idx - 1; i >= 0; i--) {
        if (messages[i].role === "user") {
          prompt = messages[i].content;
          break;
        }
      }
    }
    send({ type: "chat:run", sessionId, message: prompt, turn: turn + 1 });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 30 }}
      className={cn("group flex gap-3 px-4 sm:px-6", isUser ? "flex-row-reverse" : "flex-row")}
    >
      {/* 头像 */}
      <div
        className={cn(
          "size-8 shrink-0 rounded-lg flex items-center justify-center mt-0.5",
          isUser
            ? "bg-accent text-muted-foreground"
            : "nx-brand-grad text-primary-foreground"
        )}
      >
        {isUser ? <User className="size-4" /> : <Zap className="size-4" />}
      </div>

      {/* 内容 */}
      <div className={cn("min-w-0 max-w-[85%] sm:max-w-[78%] flex flex-col", isUser ? "items-end" : "items-start")}>
        <div
          className={cn(
            "rounded-xl px-4 py-2.5 text-sm break-words",
            isUser
              ? "nx-brand-grad text-primary-foreground"
              : "bg-card border border-border text-foreground"
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{msg.content}</p>
          ) : msg.content ? (
            <div className={cn(streaming && "nx-caret")}>
              <Markdown content={msg.content} />
            </div>
          ) : streaming ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Zap className="size-3.5 animate-pulse text-nx-brand" />
              <span className="text-xs">思考中…</span>
            </div>
          ) : null}
        </div>

        {/* 思考块 */}
        {!isUser && msg.thinking ? (
          <div className="mt-2 w-full">
            <ThinkingBlock thinking={msg.thinking} streaming={streaming} />
          </div>
        ) : null}

        {/* 工具调用 */}
        {!isUser && msg.toolCalls && msg.toolCalls.length > 0 ? (
          <div className="mt-2 w-full space-y-2">
            {msg.toolCalls.map((tc) => {
              const result = msg.toolResults?.find((r) => r.toolCallId === tc.id);
              return (
                <ToolCard
                  key={tc.id}
                  call={tc}
                  result={result}
                  running={!result && streaming}
                />
              );
            })}
          </div>
        ) : null}

        {/* 操作 */}
        <div
          className={cn(
            "mt-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity",
            isUser ? "flex-row-reverse" : "flex-row"
          )}
        >
          <button
            type="button"
            onClick={onCopy}
            className="size-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="复制"
          >
            {copied ? <Check className="size-3.5 text-nx-success" /> : <Copy className="size-3.5" />}
          </button>
          {!isUser && (
            <button
              type="button"
              onClick={onRegen}
              className="size-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors active:scale-90"
              title="重新生成"
            >
              <RefreshCw className="size-3.5" />
            </button>
          )}
          {msgSeq != null && (
            <button
              type="button"
              onClick={() => openTimelineAt(msgSeq)}
              className="size-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-nx-brand hover:bg-accent transition-colors active:scale-90"
              title={`回溯到这里 · 事件 #${msgSeq}`}
            >
              <Rewind className="size-3.5" />
            </button>
          )}
          <span className="text-[10px] text-muted-foreground px-1">
            {new Date(msg.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

export function ChatView() {
  const messages = useNexus((s) => s.messages);
  const loading = useNexus((s) => s.loadingSession);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  // 自动滚动到底部
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (atBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  if (!loading && messages.length === 0) {
    return (
      <div className="flex-1 min-h-0">
        <EmptyChatState />
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="flex-1 min-h-0 overflow-y-auto nx-scroll"
    >
      <div className="max-w-4xl mx-auto py-6 space-y-5">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
            <Wrench className="size-4 animate-pulse text-nx-brand mr-2" />
            正在加载会话…
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {messages.map((m) => (
              <MessageBubble key={m.id} msg={m} />
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
