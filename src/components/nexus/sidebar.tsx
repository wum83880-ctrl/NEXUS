"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Zap,
  Plus,
  Search,
  Pin,
  PinOff,
  Pencil,
  Trash2,
  Settings,
  MessageSquare,
  MessagesSquare,
  Sparkles,
  Users,
  Brain,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Circle,
  Download,
  Upload,
} from "lucide-react";
import { useNexus, type NavSection } from "@/hooks/nexus/use-nexus";
import { useToast } from "@/hooks/use-toast";
import type { SessionSummary } from "@/lib/nexus/types";
import {
  togglePin,
  renameSession,
  deleteSession,
  createSession,
  selectSession,
} from "./app-frame";
import { ThemePicker } from "./theme-picker";
import { SettingsDialog } from "./settings-dialog";
import { cn } from "@/lib/utils";

const NAV: { id: NavSection; label: string; icon: typeof MessageSquare }[] = [
  { id: "sessions", label: "会话", icon: MessageSquare },
  { id: "group", label: "群聊", icon: MessagesSquare },
  { id: "skills", label: "技能", icon: Sparkles },
  { id: "team", label: "团队", icon: Users },
  { id: "memory", label: "记忆", icon: Brain },
  { id: "mcp", label: "MCP", icon: Network },
];

function Logo({ collapsed }: { collapsed: boolean }) {
  return (
    <div className="flex items-center gap-2 px-2 h-12">
      <motion.div
        whileHover={{ rotate: 360 }}
        transition={{ type: "spring", stiffness: 200, damping: 20 }}
        className="relative size-8 shrink-0"
      >
        {/* 呼吸光晕 */}
        <motion.span
          animate={{ opacity: [0.35, 0.8, 0.35], scale: [0.95, 1.15, 0.95] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
          className="absolute inset-0 rounded-lg nx-brand-grad blur-[6px]"
        />
        <div className="relative size-8 rounded-lg nx-brand-grad flex items-center justify-center">
          <motion.span
            animate={{ scale: [1, 1.1, 1] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
            className="flex"
          >
            <Zap className="size-4 text-primary-foreground" />
          </motion.span>
        </div>
      </motion.div>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: "auto" }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden whitespace-nowrap"
          >
            <div className="text-sm font-semibold tracking-tight leading-none">
              NEXUS
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">图驱动 AI Agent</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NavRail({ collapsed }: { collapsed: boolean }) {
  const navSection = useNexus((s) => s.navSection);
  const setNavSection = useNexus((s) => s.setNavSection);

  return (
    <nav className="px-2 py-1 space-y-0.5">
      {NAV.map((n) => {
        const active = navSection === n.id;
        return (
          <button
            key={n.id}
            type="button"
            onClick={() => setNavSection(n.id)}
            title={n.label}
            className={cn(
              "relative w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              collapsed && "justify-center px-0"
            )}
          >
            {active && (
              <motion.span
                layoutId="nx-nav-active"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
                className="absolute inset-0 rounded-lg bg-accent border border-nx-brand/30"
              />
            )}
            <n.icon className={cn("size-4 shrink-0 relative z-10", active && "text-nx-brand")} />
            {!collapsed && <span className="truncate relative z-10">{n.label}</span>}
            {!collapsed && active && (
              <motion.span
                layoutId="nx-nav-dot"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
                className="ml-auto size-1.5 rounded-full bg-nx-brand relative z-10"
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}

function SessionItem({ s, collapsed }: { s: SessionSummary; collapsed: boolean }) {
  const { toast } = useToast();
  const activeSessionId = useNexus((st) => st.activeSessionId);
  const active = activeSessionId === s.id;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(s.title);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => selectSession(s.id)}
        title={s.title}
        className={cn(
          "relative w-full flex items-center justify-center rounded-lg px-0 py-2 transition-colors",
          active ? "bg-accent text-nx-brand" : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
        )}
      >
        <MessageSquare className="size-4" />
        {s.pinned && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-nx-warn" />}
      </button>
    );
  }

  const commitRename = async () => {
    const t = draft.trim();
    if (t && t !== s.title) await renameSession(s.id, t);
    else setDraft(s.title);
    setEditing(false);
  };

  return (
    <div
      className={cn(
        "group relative rounded-lg border px-2.5 py-2 transition-colors cursor-pointer",
        active
          ? "bg-accent border-nx-brand/40"
          : "bg-transparent border-transparent hover:bg-accent/50 hover:border-border"
      )}
      onClick={() => !editing && selectSession(s.id)}
    >
      <div className="flex items-start gap-2">
        {s.pinned ? (
          <Pin className="size-3 text-nx-warn shrink-0 mt-0.5" />
        ) : (
          <MessageSquare className="size-3 text-muted-foreground shrink-0 mt-0.5" />
        )}
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") { setDraft(s.title); setEditing(false); }
              }}
              className="w-full bg-background border border-nx-brand/50 rounded px-1 py-0.5 text-xs text-foreground outline-none"
            />
          ) : (
            <div className="text-xs font-medium text-foreground truncate flex items-center gap-1">
              <span className="truncate">{s.title}</span>
              {s.messageCount > 0 && (
                <span className="text-[10px] text-muted-foreground shrink-0">{s.messageCount}</span>
              )}
            </div>
          )}
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5">
            <span className="truncate">{s.lastMessage || "暂无消息"}</span>
            <span className="shrink-0 opacity-70">{relativeTime(s.updatedAt)}</span>
          </div>
          {s.tags && s.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1 mt-1">
              {s.tags.slice(0, 3).map((t) => (
                <span key={t} className="text-[9px] px-1 py-0.5 rounded bg-accent text-muted-foreground">
                  {t}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {/* hover 操作 */}
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); togglePin(s.id, !s.pinned); }}
            title={s.pinned ? "取消置顶" : "置顶"}
            className="size-5 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-background/60"
          >
            {s.pinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); exportSession(s, toast); }}
            title="导出会话（JSON）"
            className="size-5 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-background/60"
          >
            <Download className="size-3" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setEditing(true); setDraft(s.title); }}
            title="重命名"
            className="size-5 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-background/60"
          >
            <Pencil className="size-3" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
            title="删除"
            className="size-5 inline-flex items-center justify-center rounded text-muted-foreground hover:text-nx-error hover:bg-background/60"
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

// 相对时间：今天/昨天/N天前
function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d === 1) return "昨天";
  if (d < 7) return `${d} 天前`;
  return new Date(t).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

interface MsgResult {
  sessionId: string;
  title: string;
  seq: number;
  type: string;
  snippet: string;
  createdAt: string;
}

function SessionList({ collapsed }: { collapsed: boolean }) {
  const sessions = useNexus((s) => s.sessions);
  const openTimelineAt = useNexus((s) => s.openTimelineAt);
  const [query, setQuery] = useState("");
  const [msgResults, setMsgResults] = useState<MsgResult[]>([]);
  const [searching, setSearching] = useState(false);

  // 消息级全文搜索（防抖 300ms）：搜索框输入时同步检索历史消息内容
  useEffect(() => {
    const q = query.trim();
    if (!q) { setMsgResults([]); setSearching(false); return; }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setMsgResults(Array.isArray(data.results) ? data.results : []);
      } catch {
        setMsgResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const sorted = useMemo(() => {
    const list = [...sessions].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
    if (!query.trim()) return list;
    const q = query.toLowerCase();
    return list.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (s.lastMessage || "").toLowerCase().includes(q) ||
        (s.tags || []).some((t) => t.toLowerCase().includes(q))
    );
  }, [sessions, query]);

  if (collapsed) {
    return (
      <div className="px-1 py-1 space-y-0.5">
        {sorted.slice(0, 8).map((s) => (
          <SessionItem key={s.id} s={s} collapsed />
        ))}
      </div>
    );
  }

  return (
    <div className="px-2 flex-1 min-h-0 flex flex-col">
      <div className="relative mb-2">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索会话…"
          className="w-full bg-background/60 border border-border rounded-lg pl-8 pr-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-nx-brand/50"
        />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto nx-scroll space-y-0.5 pr-0.5">
        {sorted.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground py-8">
            {query ? "未找到匹配的会话" : "暂无会话"}
          </div>
        ) : (
          sorted.map((s) => <SessionItem key={s.id} s={s} collapsed={false} />)
        )}
        {query.trim() && (
          <div className="mt-1 border-t border-border/60 pt-2 pb-1 space-y-1">
            <div className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Search className="size-2.5" />
              消息搜索{searching ? "…" : `（${msgResults.length}）`}
            </div>
            {msgResults.slice(0, 6).map((m) => (
              <button
                key={`${m.sessionId}-${m.seq}`}
                type="button"
                onClick={() => { selectSession(m.sessionId); openTimelineAt(m.seq); }}
                className="w-full text-left rounded-md px-1.5 py-1 hover:bg-accent/60 transition-colors"
                title={`打开 ${m.title} 并定位到消息`}
              >
                <div className="text-[10px] text-foreground truncate flex items-center gap-1">
                  <span className="truncate">{m.title}</span>
                  <span className="text-[9px] text-muted-foreground shrink-0">#{m.seq}</span>
                </div>
                <div className="text-[9px] text-muted-foreground line-clamp-2">{m.snippet}</div>
              </button>
            ))}
            {!searching && msgResults.length === 0 && (
              <div className="text-[10px] text-muted-foreground px-1">无匹配消息</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function NewSessionButton({ collapsed }: { collapsed: boolean }) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="px-2 space-y-1">
      <button
        type="button"
        onClick={() => createSession()}
        title="新建会话"
        className={cn(
          "w-full nx-brand-grad text-primary-foreground rounded-lg py-2 text-xs font-medium flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity",
          collapsed && "px-0"
        )}
      >
        <Plus className="size-3.5" />
        {!collapsed && <span>新建会话</span>}
      </button>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        title="导入会话（JSON）"
        className={cn(
          "w-full border border-border text-muted-foreground hover:text-foreground hover:border-nx-brand/40 rounded-lg py-1.5 text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors",
          collapsed && "px-0"
        )}
      >
        <Upload className="size-3" />
        {!collapsed && <span>导入会话</span>}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          try {
            const text = await file.text();
            const res = await fetch("/api/sessions/import", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ data: JSON.parse(text) }),
            });
            const data = await res.json();
            if (!res.ok || !data.session) throw new Error(data.error || "导入失败");
            // 刷新会话列表并选中新会话
            const listRes = await fetch("/api/sessions");
            const listData = await listRes.json();
            useNexus.getState().setSessions(listData.sessions || []);
            await selectSession(data.session.id);
          } catch (err: any) {
            toast({ title: "导入失败", description: err?.message || "解析错误", variant: "destructive" });
          }
        }}
      />
    </div>
  );
}

async function exportSession(s: SessionSummary, toast: (p: { title: string; description?: string; variant?: "default" | "destructive" }) => void) {
  try {
    const res = await fetch(`/api/sessions/${s.id}/export`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nexus-session-${s.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 40) || s.id.slice(0, 8)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (err: any) {
    toast({ title: "导出失败", description: err?.message || "网络错误", variant: "destructive" });
  }
}

function Footer({ collapsed }: { collapsed: boolean }) {
  const socketConnected = useNexus((s) => s.socketConnected);
  const reconnecting = useNexus((s) => s.reconnecting);
  const toggleSidebar = useNexus((s) => s.toggleSidebar);
  const setDetailsOpen = useNexus((s) => s.setDetailsOpen);

  const status = reconnecting
    ? { label: "重连中", color: "text-nx-warn", dot: "bg-nx-warn" }
    : socketConnected
      ? { label: "已连接", color: "text-nx-success", dot: "bg-nx-success" }
      : { label: "已断开", color: "text-nx-error", dot: "bg-nx-error" };

  return (
    <div className="border-t border-border px-2 py-2 space-y-1">
      <div
        className={cn(
          "flex items-center gap-2 px-2 py-1.5 rounded-lg",
          collapsed ? "justify-center" : "bg-background/40"
        )}
        title={status.label}
      >
        {reconnecting ? (
          <Circle className={cn("size-2 fill-current animate-pulse", status.color)} />
        ) : (
          <span className={cn("size-2 rounded-full", status.dot)} />
        )}
        {!collapsed && (
          <span className={cn("text-[11px]", status.color)}>{status.label}</span>
        )}
      </div>
      <div className={cn("flex items-center", collapsed ? "flex-col gap-1" : "justify-between")}>
        <ThemePicker />
        <SettingsDialog />
        <button
          type="button"
          onClick={toggleSidebar}
          title={collapsed ? "展开侧边栏" : "折叠侧边栏"}
          className={cn(
            "size-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors",
            !collapsed && "order-1"
          )}
        >
          {collapsed ? <PanelLeftOpen className="size-3.5" /> : <PanelLeftClose className="size-3.5" />}
        </button>
      </div>
    </div>
  );
}

export function NexusSidebar() {
  const collapsed = useNexus((s) => s.sidebarCollapsed);

  return (
    <div className="h-full flex flex-col bg-sidebar text-sidebar-foreground">
      <Logo collapsed={collapsed} />
      <NavRail collapsed={collapsed} />
      <div className="px-2 my-2">
        <div className="h-px bg-border" />
      </div>
      <NewSessionButton collapsed={collapsed} />
      <div className="h-2" />
      <SessionList collapsed={collapsed} />
      <Footer collapsed={collapsed} />
    </div>
  );
}
