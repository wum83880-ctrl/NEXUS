"use client";
import { useEffect } from "react";
import { useNexus, type ViewTab } from "@/hooks/nexus/use-nexus";
import { useNexusSocket } from "@/hooks/nexus/use-nexus-socket";
import { applyClientTokenToFetch } from "@/lib/nexus/client-token";
import { motion, AnimatePresence } from "framer-motion";
import { NexusSidebar } from "./sidebar";
import { NexusConversation } from "./conversation";
import { NexusDetails } from "./details";
import { CommandPalette } from "./command-palette";

export function AppFrame() {
  const sidebarCollapsed = useNexus((s) => s.sidebarCollapsed);
  useNexusSocket();

  // 全局快捷键：⌘/Ctrl+N 新建会话 · ⌘/Ctrl+1..4 切换视图 · ⌘/Ctrl+Shift+D 详情面板
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      const st = useNexus.getState();
      if (key === "n") {
        e.preventDefault();
        createSession();
      } else if (key === "1" || key === "2" || key === "3" || key === "4") {
        e.preventDefault();
        const views: ViewTab[] = ["chat", "graph", "codegraph", "timeline"];
        const v = views[Number(key) - 1];
        if (v) { st.setView(v); st.setNavSection("sessions"); }
      } else if (key === "d" && e.shiftKey) {
        e.preventDefault();
        st.setDetailsOpen(!st.detailsOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    applyClientTokenToFetch();
    (async () => {
      try {
        const st = useNexus.getState();
        const res = await fetch("/api/sessions");
        if (!res.ok) return; // 服务端不可用：保持空状态，不抛未处理异常
        const data = await res.json();
        st.setSessions(data.sessions || []);
        if (!st.activeSessionId && data.sessions?.length) {
          await selectSession(data.sessions[0].id);
        } else if (!data.sessions?.length) {
          await createSession();
        }
      } catch {
        // 网络异常（后端未启动等）：静默保持空态，避免应用卡死在加载中
      }
    })();
  }, []);

  return (
    <div className="relative z-10 flex h-screen w-screen overflow-hidden">
      <motion.aside
        initial={false}
        animate={{ width: sidebarCollapsed ? 56 : 280 }}
        transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
        className="shrink-0 h-full border-r border-border bg-sidebar"
      >
        <NexusSidebar />
      </motion.aside>
      <main className="flex-1 min-w-0 h-full flex flex-col">
        <NexusConversation />
      </main>
      <NexusDetails />
      <CommandPalette />
    </div>
  );
}

// selectSession 竞态保护：快速切换会话时只应用最新一次请求的结果
let selectSessionSeq = 0;
export async function selectSession(id: string) {
  const seq = ++selectSessionSeq;
  const st = useNexus.getState();
  st.setActiveSession(id);
  useNexus.setState({ loadingSession: true });
  try {
    const res = await fetch(`/api/sessions/${id}`);
    if (!res.ok) return;
    if (seq !== selectSessionSeq) return; // 已有更新的选择，丢弃过期响应
    const data = await res.json();
    st.loadSession(id, { messages: data.messages, events: data.events, graph: data.graph, decisions: data.decisions, title: data.session.title, pinned: data.session.pinned, tags: data.session.tags || [] });
  } catch {
    // 网络异常：保持会话占位，不抛未处理异常
  } finally { if (seq === selectSessionSeq) useNexus.setState({ loadingSession: false }); }
}

export async function createSession(title?: string) {
  const res = await fetch("/api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: title || "新建会话" }) });
  const data = await res.json();
  const session = data.session;
  if (!session) throw new Error(data.error || "创建会话失败");
  useNexus.getState().upsertSession({ id: session.id, title: session.title, pinned: session.pinned, tags: [], createdAt: session.createdAt, updatedAt: session.updatedAt, messageCount: 0 });
  await selectSession(session.id);
  return session;
}

export async function deleteSession(id: string) {
  try {
    await fetch(`/api/sessions/${id}`, { method: "DELETE" });
  } catch {
    // 网络异常：本地仍移除，避免界面卡死
  }
  const st = useNexus.getState();
  st.removeSession(id);
  if (st.activeSessionId === id) {
    // 从最新 state 取下一个会话：removeSession 会生成新 state，旧引用里 sessions 仍含已删会话
    const next = useNexus.getState().sessions[0];
    if (next) await selectSession(next.id);
    else await createSession();
  }
}

export async function renameSession(id: string, title: string) {
  try {
    await fetch(`/api/sessions/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
  } catch {
    // 网络异常静默：本地标题更新不受影响
  }
  useNexus.getState().setSessionTitle(id, title);
}

export async function togglePin(id: string, pinned: boolean) {
  try {
    await fetch(`/api/sessions/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pinned }) });
  } catch {
    // 网络异常静默
  }
  useNexus.getState().setSessionPinned(id, pinned);
}
