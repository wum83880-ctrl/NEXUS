"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageSquare,
  GitBranch,
  History,
  Network,
  Send,
  Square,
  Info,
  Hash,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Camera,
  X,
  Plus,
  FolderTree,
  FileText,
} from "lucide-react";
import { useNexus, type ViewTab } from "@/hooks/nexus/use-nexus";
import { ChatView } from "./views/chat-view";
import { GraphView } from "./views/graph-view";
import { GroupPanel } from "./panels/group-panel";
import { SkillsPanel } from "./panels/skills-panel";
import { TeamPanel } from "./panels/team-panel";
import { MemoryPanel } from "./panels/memory-panel";
import { McpPanel } from "./panels/mcp-panel";
import { TimelineView } from "./views/timeline-view";
import { CodeGraphView } from "./views/codegraph-view";
import { SlashCommandPicker, executeSlashCommand } from "./slash-command";
import { SnapshotDialog } from "./snapshot-dialog";
import { ModelSwitcher } from "./model-switcher";
import { SessionMetaBar } from "./session-meta-bar";
import { PromptOptimizer } from "./prompt-optimizer";
import { cn } from "@/lib/utils";

// ── 文件/文件夹附件：拖进对话或经 + 按钮选择，作为上下文注入 ──
interface Attachment {
  id: string;
  kind: "file" | "folder";
  name: string;
  content?: string;  // 单文件内容（≤200KB）
  paths?: string[];  // 文件夹内相对路径（≤100 个）
}
const MAX_FILE_BYTES = 200_000;
const MAX_FOLDER_PATHS = 100;
const MAX_ATTACHMENTS = 8;

function AttachmentChips({ attachments, onRemove }: { attachments: Attachment[]; onRemove: (id: string) => void }) {
  if (attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 pb-1.5">
      {attachments.map((a) => (
        <span
          key={a.id}
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] max-w-[220px]",
            a.kind === "folder" ? "border-nx-brand/40 bg-nx-brand/10 text-nx-brand" : "border-border bg-accent/40 text-foreground/80"
          )}
          title={a.kind === "folder" ? `文件夹：${(a.paths || []).length} 个文件` : `文件：${a.name}`}
        >
          {a.kind === "folder" ? <FolderTree className="size-2.5 shrink-0" /> : <FileText className="size-2.5 shrink-0" />}
          <span className="truncate">{a.name}</span>
          {a.kind === "file" && <span className="text-muted-foreground shrink-0">{((a.content || "").length / 1024).toFixed(0)}KB</span>}
          <button type="button" onClick={() => onRemove(a.id)} className="shrink-0 text-muted-foreground hover:text-destructive" title="移除">
            <X className="size-2.5" />
          </button>
        </span>
      ))}
    </div>
  );
}

// 上下文用量徽标：展示估算占用率，占用过高时提供一键压缩
function ContextUsageBadge({ sessionId }: { sessionId: string | null }) {
  const [usage, setUsage] = useState<{ tokens: number; window: number; pct: number; threshold: number; messageCount: number } | null>(null);
  const messages = useNexus((s) => s.messages);
  const send = useNexus((s) => s.send);
  const runStatus = useNexus((s) => s.runStatus);

  const load = useCallback(async () => {
    if (!sessionId) { setUsage(null); return; }
    try {
      const res = await fetch(`/api/sessions/${sessionId}/context`);
      const data = await res.json();
      setUsage(data.usage);
    } catch { setUsage(null); }
  }, [sessionId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- 异步数据获取，setState 在 fetch 回调中
  useEffect(() => { load(); }, [load, messages.length, runStatus]);
  if (!usage || !sessionId) return null;

  const tone = usage.pct >= usage.threshold ? "text-nx-error border-nx-error/40" : usage.pct >= 60 ? "text-nx-warn border-amber-500/40" : "text-muted-foreground border-border";
  const over = usage.pct >= usage.threshold;
  return (
    <button
      type="button"
      onClick={() => { if (over && send) send({ type: "chat:compact", sessionId }); }}
      title={`上下文估算 ${usage.tokens.toLocaleString()} / ${usage.window.toLocaleString()} tokens（阈值 ${usage.threshold}%）；${over ? "点击压缩上下文" : "自动压缩阈值内"}`}
      className={cn("hidden sm:inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-mono transition-colors", tone, over && "hover:bg-nx-error/10 cursor-pointer")}
    >
      {over && <span className="size-1.5 rounded-full bg-nx-error animate-pulse" />}
      上下文 {usage.pct}%
    </button>
  );
}

const TABS: { id: ViewTab; label: string; icon: typeof MessageSquare }[] = [
  { id: "chat", label: "对话", icon: MessageSquare },
  { id: "graph", label: "执行图", icon: GitBranch },
  { id: "codegraph", label: "代码图谱", icon: Network },
  { id: "timeline", label: "时间轴", icon: History },
];

// 未配置供应商引导横幅（可关闭，localStorage 记忆）
function ProviderHint() {
  // localStorage 记忆：一次性初始化（useState 惰性求值，无需 effect）
  const [visible, setVisible] = useState<boolean>(() => {
    try { return localStorage.getItem("nx-provider-hint-dismissed") !== "1"; } catch { return true; }
  });
  const [hintOpen, setHintOpen] = useState(false);
  const navSection = useNexus((s) => s.navSection);

  useEffect(() => {
    if (navSection !== "sessions") return;
    if (!visible) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings");
        const data = await res.json();
        if (!cancelled) setHintOpen(!!data.settings && data.settings.providers.length === 0);
      } catch { if (!cancelled) setHintOpen(false); }
    })();
    return () => { cancelled = true; };
  }, [navSection, visible]);

  if (!visible || !hintOpen) return null;
  return (
    <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-4 sm:px-6 py-1.5 flex items-center gap-2 text-[11px] text-amber-700 dark:text-amber-300">
      <AlertTriangle className="size-3.5 shrink-0" />
      <span className="flex-1">尚未配置 AI 供应商，对话暂时无法获得回复。</span>
      <button type="button" className="underline hover:opacity-80 shrink-0" onClick={() => { setHintOpen(false); try { localStorage.setItem("nx-provider-hint-dismissed", "1"); } catch {} }}>知道了</button>
    </div>
  );
}

function Header() {
  const title = useNexus((s) => s.sessionTitle);
  const tags = useNexus((s) => s.sessionTags);
  const pinned = useNexus((s) => s.sessionPinned);
  const messages = useNexus((s) => s.messages);
  const runStatus = useNexus((s) => s.runStatus);
  const runTurn = useNexus((s) => s.runTurn);
  const setDetailsOpen = useNexus((s) => s.setDetailsOpen);
  const activeSessionId = useNexus((s) => s.activeSessionId);
  const [snapshotOpen, setSnapshotOpen] = useState(false);

  const statusNode =
    runStatus === "running" ? (
      <span className="flex items-center gap-1 text-[11px] text-nx-brand">
        <Loader2 className="size-3 animate-spin" /> 运行中 · 第 {runTurn} 轮
      </span>
    ) : runStatus === "error" ? (
      <span className="flex items-center gap-1 text-[11px] text-nx-error">
        <AlertTriangle className="size-3" /> 出错
      </span>
    ) : runStatus === "stopped" ? (
      <span className="flex items-center gap-1 text-[11px] text-nx-warn">
        <Square className="size-3" /> 已停止
      </span>
    ) : (
      <span className="flex items-center gap-1 text-[11px] text-nx-success">
        <CheckCircle2 className="size-3" /> 空闲
      </span>
    );

  return (
    <header className="shrink-0 border-b border-border bg-card/40 backdrop-blur-sm">
      <div className="h-14 px-4 sm:px-6 flex items-center gap-3">
        <div className="min-w-0 flex-1 flex items-center gap-2">
          <h2 className="text-sm font-medium text-foreground truncate">{title}</h2>
          {pinned && <Hash className="size-3 text-nx-warn shrink-0" />}
          {tags && tags.length > 0 ? (
            <div className="hidden sm:flex items-center gap-1">
              {tags.map((t) => (
                <span
                  key={t}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-accent text-muted-foreground"
                >
                  {t}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {statusNode}
          <ContextUsageBadge sessionId={activeSessionId} />
          <ModelSwitcher />
          <span className="text-[11px] text-muted-foreground hidden sm:inline">· {messages.length} 条消息</span>
          <button
            type="button"
            onClick={() => setSnapshotOpen(true)}
            title="快照与回溯"
            className="size-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <Camera className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setDetailsOpen(true)}
            title="详情"
            className="size-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <Info className="size-4" />
          </button>
        </div>
      </div>

      {/* View Tabs */}
      <div className="px-3 sm:px-5 flex items-center gap-1">
        {TABS.map((t) => (
          <TabButton key={t.id} tab={t} />
        ))}
      </div>
      <SnapshotDialog
        sessionId={activeSessionId}
        open={snapshotOpen}
        onOpenChange={setSnapshotOpen}
      />
    </header>
  );
}

function TabButton({
  tab,
}: {
  tab: { id: ViewTab; label: string; icon: typeof MessageSquare };
}) {
  const setView = useNexus((s) => s.setView);
  const current = useNexus((s) => s.view);
  const isActive = current === tab.id;
  return (
    <button
      type="button"
      onClick={() => setView(tab.id)}
      className={cn(
        "relative flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors",
        isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
      )}
    >
      <tab.icon className={cn("size-3.5", isActive && "text-nx-brand")} />
      {tab.label}
      {isActive && (
        <motion.div
          layoutId="nx-tab-underline"
          className="absolute left-0 right-0 -bottom-px h-0.5 nx-brand-grad rounded-full"
        />
      )}
    </button>
  );
}

function Composer() {
  const [value, setValue] = useState("");
  const [pickerDismissed, setPickerDismissed] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachMenu, setAttachMenu] = useState(false);
  const [dragging, setDragging] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dirInputRef = useRef<HTMLInputElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);

  // 读取单个文件内容（≤200KB）
  const addFiles = (files: FileList | File[], kind: "file" | "folder") => {
    const list = Array.from(files);
    const pending: Attachment[] = [];
    if (kind === "folder") {
      const paths = list.map((f) => (f as any).webkitRelativePath || f.name).filter(Boolean).slice(0, MAX_FOLDER_PATHS);
      if (paths.length === 0) return;
      const name = paths[0].split("/")[0] || "文件夹";
      pending.push({ id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, kind: "folder", name, paths });
    } else {
      for (const f of list) {
        if (f.size > MAX_FILE_BYTES) continue;
        const id = `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const reader = new FileReader();
        reader.onload = () => {
          setAttachments((prev) => prev.length >= MAX_ATTACHMENTS ? prev : [...prev, { id, kind: "file", name: f.name, content: String(reader.result || "") }]);
        };
        reader.readAsText(f);
      }
      return;
    }
    setAttachments((prev) => [...prev, ...pending].slice(0, MAX_ATTACHMENTS));
    // 选择文件夹 → 自动构建代码图谱（智能嵌入）
    if (kind === "folder" && pending.length > 0) {
      const st = useNexus.getState();
      if (st.activeSessionId && st.send) st.send({ type: "chat:graph", sessionId: st.activeSessionId });
    }
  };
  const send = useNexus((s) => s.send);
  const sessionId = useNexus((s) => s.activeSessionId);
  const runStatus = useNexus((s) => s.runStatus);
  const runTurn = useNexus((s) => s.runTurn);
  const queuedMessage = useNexus((s) => s.queuedMessage);
  const setQueuedMessage = useNexus((s) => s.setQueuedMessage);
  const running = runStatus === "running";

  // 自适应高度
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, [value]);

  const onSend = () => {
    const text = value.trim();
    if (!text || !sessionId || !send) return;
    // Agent 运行中：消息先入队，本轮完成后自动发送
    if (running) {
      setQueuedMessage(text);
      setValue("");
      return;
    }
    // 斜杠系统指令（/goal /plan /compact /graph /organize）本地处理，绝不作为用户消息发给模型
    if (text.startsWith("/")) {
      executeSlashCommand(text, { sessionId, send }).then((handled) => {
        if (handled) setValue("");
      });
      return;
    }
    // 组装附件上下文：单文件带内容（Agent 直接可见）；文件夹带路径提示（配合图谱/read 调查）
    let message = text;
    if (attachments.length > 0) {
      const parts: string[] = [];
      for (const a of attachments) {
        if (a.kind === "file" && a.content != null) {
          parts.push(`[用户附加文件] ${a.name}\n` + "```" + `\n${a.content.slice(0, MAX_FILE_BYTES)}\n` + "```");
        } else if (a.kind === "folder" && a.paths?.length) {
          parts.push(`[用户附加文件夹] ${a.name}（${a.paths.length} 个文件，相对路径如下；如需处理请结合代码图谱与 read 工具调查）\n${a.paths.slice(0, 50).join("\n")}`);
        }
      }
      message = parts.join("\n\n") + (text ? `\n\n[用户任务] ${text}` : "\n\n请基于以上附件处理。");
    }
    send({ type: "chat:run", sessionId, message, turn: runTurn + 1 });
    setValue("");
    setAttachments([]);
  };

  const onStop = () => {
    if (!sessionId || !send) return;
    send({ type: "chat:stop", sessionId });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div
      className="shrink-0 border-t border-border bg-card/40 backdrop-blur-sm"
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
          const hasDirs = Array.from(files).some((f) => (f as any).webkitRelativePath);
          addFiles(files, hasDirs ? "folder" : "file");
        }
      }}
    >
      <div className="max-w-4xl mx-auto p-3 sm:p-4 relative">
        {value.startsWith("/") && !running && !pickerDismissed && (
          <SlashCommandPicker
            input={value}
            onPick={(text) => { setValue(text); }}
            onClose={() => setPickerDismissed(true)}
          />
        )}
        {/* 附件列表 */}
        <AttachmentChips attachments={attachments} onRemove={(id) => setAttachments((prev) => prev.filter((a) => a.id !== id))} />
        <div
          className={cn(
            "rounded-xl border bg-background/60 focus-within:border-nx-brand/50 transition-colors px-3 py-2 flex items-end gap-1.5",
            dragging ? "border-nx-brand ring-2 ring-nx-brand/30" : "border-border"
          )}
        >
          {/* + 附件按钮 */}
          <div className="relative shrink-0" ref={attachMenuRef}>
            <button
              type="button"
              onClick={() => setAttachMenu((v) => !v)}
              title="附加文件 / 文件夹（拖拽亦可）"
              className="size-8 shrink-0 inline-flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-nx-brand hover:border-nx-brand/40 transition-colors"
            >
              <Plus className="size-3.5" />
            </button>
            {attachMenu && (
              <div className="absolute bottom-full left-0 mb-1.5 w-44 rounded-lg border border-border bg-popover shadow-xl overflow-hidden z-30">
                <button type="button" onClick={() => { setAttachMenu(false); fileInputRef.current?.click(); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent transition-colors">
                  <FileText className="size-3.5 text-nx-cyan" /> 选择文件（可多选）
                </button>
                <button type="button" onClick={() => { setAttachMenu(false); dirInputRef.current?.click(); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent transition-colors">
                  <FolderTree className="size-3.5 text-nx-brand" /> 选择文件夹（自动构建图谱）
                </button>
              </div>
            )}
          </div>
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files) addFiles(e.target.files, "file"); e.target.value = ""; }} />
          <input ref={dirInputRef} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files) addFiles(e.target.files, "folder"); e.target.value = ""; }} {...({ webkitdirectory: "", directory: "" } as any)} />
          {/* 点击外部关闭菜单 */}
          <button
            type="button"
            aria-hidden
            onClick={() => setAttachMenu(false)}
            className={cn("fixed inset-0 z-20 cursor-default", attachMenu ? "block" : "hidden")}
            tabIndex={-1}
          />
          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              // 输入不再以 / 开头（清空/发送）时复位选择器关闭态，下次 / 命令可再次唤起
              if (!e.target.value.startsWith("/")) setPickerDismissed(false);
            }}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={running ? "Agent 正在执行…" : "输入消息，Enter 发送 · / 唤起指令（goal/plan/compact/graph/organize）"}
            disabled={!sessionId}
            className="flex-1 bg-transparent resize-none outline-none text-sm text-foreground placeholder:text-muted-foreground max-h-[200px] nx-scroll disabled:opacity-60"
          />
          <PromptOptimizer text={value} onApply={setValue} />
          <AnimatePresence mode="wait" initial={false}>
            {running ? (
              <motion.button
                key="stop"
                type="button"
                onClick={onStop}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                whileTap={{ scale: 0.85 }}
                transition={{ type: "spring", stiffness: 500, damping: 25 }}
                className="size-8 shrink-0 inline-flex items-center justify-center rounded-lg bg-nx-error/15 text-nx-error hover:bg-nx-error/25 transition-colors"
                title="停止"
              >
                <Square className="size-3.5 fill-current" />
              </motion.button>
            ) : (
              <motion.button
                key="send"
                type="button"
                onClick={onSend}
                disabled={!value.trim() || !sessionId}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                whileTap={{ scale: 0.85 }}
                whileHover={{ scale: 1.06 }}
                transition={{ type: "spring", stiffness: 500, damping: 25 }}
                className="size-8 shrink-0 inline-flex items-center justify-center rounded-lg nx-brand-grad text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
                title="发送"
              >
                <Send className="size-3.5" />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>NEXUS · Web 开发 Agent · <kbd className="px-1 py-0.5 rounded bg-accent">⌘K</kbd> 命令面板 · <kbd className="px-1 py-0.5 rounded bg-accent">/</kbd> 快捷指令</span>
          <span className="nx-brand-grad-text">Enter 发送 · Shift+Enter 换行{running ? " · 运行中输入将自动排队" : ""}</span>
        </div>
        {queuedMessage && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-1.5 flex items-center gap-2 rounded-lg border border-nx-brand/30 bg-nx-brand/5 px-2.5 py-1.5 text-[11px]"
          >
            <Loader2 className="size-3 text-nx-brand animate-spin shrink-0" />
            <span className="text-foreground/85 truncate flex-1">
              已排队：{queuedMessage.slice(0, 60)}{queuedMessage.length > 60 ? "…" : ""}
            </span>
            <span className="text-[10px] text-muted-foreground shrink-0">本轮完成后自动发送</span>
            <button
              type="button"
              onClick={() => setQueuedMessage(null)}
              className="size-5 shrink-0 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-accent transition-colors"
              title="取消排队"
            >
              <X className="size-3.5" />
            </button>
          </motion.div>
        )}
      </div>
    </div>
  );
}

export function NexusConversation() {
  const view = useNexus((s) => s.view);
  const navSection = useNexus((s) => s.navSection);

  // 非 sessions 视图：渲染对应面板
  if (navSection !== "sessions") {
    return (
      <div className="flex-1 min-w-0 h-full flex flex-col">
        <AnimatePresence mode="wait">
          <motion.div key={navSection} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ type: "spring", stiffness: 320, damping: 30 }} className="flex-1 min-h-0 flex flex-col">
            {navSection === "group" && <GroupPanel />}
            {navSection === "skills" && <SkillsPanel />}
            {navSection === "team" && <TeamPanel />}
            {navSection === "memory" && <MemoryPanel />}
            {navSection === "mcp" && <McpPanel />}
          </motion.div>
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0 h-full flex flex-col">
      <ProviderHint />
      <Header />
      <SessionMetaBar />
      <div className="flex-1 min-h-0 flex flex-col">
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            className="flex-1 min-h-0 flex flex-col"
          >
            {view === "chat" ? <ChatView /> : view === "timeline" ? <TimelineView /> : view === "codegraph" ? <CodeGraphView /> : <GraphView />}
          </motion.div>
        </AnimatePresence>
      </div>
      <Composer />
    </div>
  );
}
