"use client";
// NEXUS 群聊面板 — 像微信群聊，用户发消息每个 agent 回应
import { useEffect, useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import * as Icons from "lucide-react";
import {
  MessagesSquare, Plus, Trash2, Send, Loader2, Square, Users, X, Check, UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { io, Socket } from "socket.io-client";
import { useNexus } from "@/hooks/nexus/use-nexus";
import { useToast } from "@/hooks/use-toast";
import { nexusSocketUrl } from "@/lib/nexus/socket-url";
import { getClientToken } from "@/lib/nexus/client-token";
import { cn } from "@/lib/utils";

interface GroupMember { id: string; name: string; role: string; systemPrompt: string; color: string; icon: string; providerId?: string; }
interface GroupRoom { id: string; name: string; members: GroupMember[]; task: string; status: string; createdAt: string; updatedAt: string; }
interface GroupMessage { id: string; roomId: string; senderId: string; senderName: string; senderRole: string; color: string; content: string; thinking: string; round: number; createdAt: string; }

const COLOR_MAP: Record<string, { bg: string; text: string; dot: string }> = {
  blue: { bg: "bg-blue-500/15", text: "text-blue-400", dot: "bg-blue-400" },
  emerald: { bg: "bg-emerald-500/15", text: "text-emerald-400", dot: "bg-emerald-400" },
  amber: { bg: "bg-amber-500/15", text: "text-amber-400", dot: "bg-amber-400" },
  purple: { bg: "bg-purple-500/15", text: "text-purple-400", dot: "bg-purple-400" },
  rose: { bg: "bg-rose-500/15", text: "text-rose-400", dot: "bg-rose-400" },
  cyan: { bg: "bg-cyan-500/15", text: "text-cyan-400", dot: "bg-cyan-400" },
  violet: { bg: "bg-violet-500/15", text: "text-violet-400", dot: "bg-violet-400" },
  teal: { bg: "bg-teal-500/15", text: "text-teal-400", dot: "bg-teal-400" },
  zinc: { bg: "bg-zinc-500/15", text: "text-zinc-300", dot: "bg-zinc-400" },
};

const MEMBER_TEMPLATES: Omit<GroupMember, "id">[] = [
  { name: "研究员", role: "信息收集", color: "blue", icon: "Search", systemPrompt: "你是研究员，擅长信息检索、资料整理与事实核查。" },
  { name: "工程师", role: "技术实现", color: "emerald", icon: "Code", systemPrompt: "你是工程师，关注可行性、实现方案与技术细节。" },
  { name: "设计师", role: "用户体验", color: "purple", icon: "Palette", systemPrompt: "你是设计师，关注用户体验、审美与易用性。" },
  { name: "审查员", role: "质量把关", color: "rose", icon: "ShieldCheck", systemPrompt: "你是审查员，负责挑错、质疑与质量把关。" },
  { name: "规划师", role: "任务拆解", color: "cyan", icon: "ListChecks", systemPrompt: "你是规划师，擅长任务拆解、流程设计。" },
  { name: "总结者", role: "提炼综合", color: "teal", icon: "FileBarChart", systemPrompt: "你是总结者，擅长提炼共识、归纳要点。" },
];

function genId() { return `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`; }

export function GroupPanel() {
  const [rooms, setRooms] = useState<GroupRoom[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const activeRoomIdRef = useRef<string | null>(null);
  activeRoomIdRef.current = activeRoomId;
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const loadRooms = useCallback(async () => {
    setLoading(true);
    try { const res = await fetch("/api/groups"); const data = await res.json(); setRooms(data.rooms || []); } finally { setLoading(false); }
  }, []);

  const loadMessages = useCallback(async (roomId: string) => {
    const res = await fetch(`/api/groups/${roomId}/messages`); const data = await res.json(); setMessages(data.messages || []);
  }, []);

  useEffect(() => { loadRooms(); }, [loadRooms]);
  useEffect(() => { if (activeRoomId) loadMessages(activeRoomId); else setMessages([]); }, [activeRoomId, loadMessages]);

  // 跨面板委派：自动选中待打开的群聊
  const pendingRoomId = useNexus((s) => s.pendingGroupRoomId);
  const setPendingRoomId = useNexus((s) => s.setPendingGroupRoomId);
  const setPendingMessage = useNexus((s) => s.setPendingGroupMessage);

  // 发送待发消息：socket 已连接且房间已就绪时才发，避免"connect 先于 ref 更新"的竞态丢消息
  const flushPendingMessage = useCallback(() => {
    const st = useNexus.getState();
    const roomId = activeRoomIdRef.current;
    if (roomId && st.pendingGroupMessage && socketRef.current?.connected) {
      const msg = st.pendingGroupMessage;
      setPendingMessage(null);
      socketRef.current.emit("group:message", { roomId, message: msg });
      setRunning(true);
    }
  }, [setPendingMessage]);

  useEffect(() => {
    if (pendingRoomId) {
      setActiveRoomId(pendingRoomId);
      setPendingRoomId(null);
      // 立即尝试发送（socket 已连接时）；未连接则由下方 connect 处理器兜底
      flushPendingMessage();
    }
  }, [pendingRoomId, setPendingRoomId, flushPendingMessage]);

  // Socket
  useEffect(() => {
    const token = getClientToken();
    const socket = io(nexusSocketUrl(), { path: "/", transports: ["websocket", "polling"], forceNew: true, reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 1000, timeout: 10000, ...(token ? { auth: { token } } : {}) });
    socketRef.current = socket;
    socket.on("group:message_start", ({ roomId, message }: { roomId: string; message: GroupMessage }) => {
      if (roomId !== activeRoomIdRef.current) return; // 运行中切房：丢弃旧房间的迟到事件
      setMessages((prev) => [...prev, { ...message, content: "", thinking: "" }]); setRunning(true);
    });
    socket.on("group:message_chunk", ({ roomId, msgId, delta }: { roomId: string; msgId: string; delta: string }) => {
      if (roomId !== activeRoomIdRef.current) return;
      setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, content: m.content + delta } : m));
    });
    socket.on("group:message_done", ({ roomId, message }: { roomId: string; message: GroupMessage }) => {
      if (roomId !== activeRoomIdRef.current) return;
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === message.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = message;
          return next;
        }
        return [...prev, message];
      });
    });
    socket.on("group:done", () => { setRunning(false); loadRooms(); });
    socket.on("group:stopped", () => { setRunning(false); });
    socket.on("group:error", ({ roomId, error }: { roomId: string; error: string }) => {
      if (roomId !== activeRoomIdRef.current) return;
      setRunning(false); setMessages((prev) => [...prev, { id: genId(), roomId: activeRoomIdRef.current || "", senderId: "system", senderName: "系统", senderRole: "", color: "zinc", content: `❌ ${error}`, thinking: "", round: 0, createdAt: new Date().toISOString() }]);
    });
    socket.on("disconnect", () => { setRunning(false); });
    // 跨面板委派：socket 连接就绪后自动发送待发消息（connect 可能在房间 ref 更新前触发，由 flush 二次兜底）
    socket.on("connect", () => {
      // 等一帧，确保 activeRoomIdRef 已由 pendingRoomId effect 更新
      setTimeout(flushPendingMessage, 50);
    });
    return () => { socket.disconnect(); };
  }, [loadRooms, flushPendingMessage]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);

  const sendMessage = () => {
    if (!input.trim() || !activeRoomId || !socketRef.current || running) return;
    const msg = input.trim();
    setInput("");
    socketRef.current.emit("group:message", { roomId: activeRoomId, message: msg });
  };

  const stopGroup = () => { if (activeRoomId && socketRef.current) socketRef.current.emit("group:stop", { roomId: activeRoomId }); };
  const createRoom = async (name: string, members: GroupMember[]) => {
    try {
      const res = await fetch("/api/groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, members }) });
      const data = await res.json();
      if (!data?.room?.id) { toast({ title: "创建失败", description: data?.error || "未返回群聊", variant: "destructive" }); return; }
      await loadRooms(); setActiveRoomId(data.room.id); setShowCreate(false);
    } catch {
      toast({ title: "创建失败", description: "网络异常", variant: "destructive" });
    }
  };
  const deleteRoom = async (id: string) => {
    try { await fetch(`/api/groups/${id}`, { method: "DELETE" }); } catch { /* 网络异常静默 */ }
    if (activeRoomId === id) setActiveRoomId(null);
    loadRooms();
  };

  const activeRoom = rooms.find((r) => r.id === activeRoomId);

  return (
    <div className="flex h-full">
      {/* 群聊列表 */}
      <div className="w-64 shrink-0 border-r border-border flex flex-col">
        <div className="p-3 border-b border-border">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2"><MessagesSquare className="w-4 h-4 text-nx-rose" /><span className="text-sm font-medium">群聊</span></div>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setShowCreate(true)}><Plus className="w-3.5 h-3.5" /></Button>
          </div>
          <p className="text-[10px] text-muted-foreground">多 Agent 群聊协作</p>
        </div>
        <ScrollArea className="flex-1 nx-scroll">
          <div className="p-2 space-y-1">
            {rooms.length === 0 && <div className="text-center py-8 text-xs text-muted-foreground">暂无群聊<br/>点击 + 创建</div>}
            {rooms.map((r) => (
              <button key={r.id} onClick={() => setActiveRoomId(r.id)} className={cn("w-full text-left rounded-lg p-2 transition-colors", r.id === activeRoomId ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/50")}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium truncate flex-1">{r.name}</span>
                  <span className={cn("w-1.5 h-1.5 rounded-full shrink-0 ml-1", r.status === "running" ? "bg-nx-success animate-pulse" : r.status === "done" ? "bg-blue-400" : "bg-muted-foreground")} />
                </div>
                <div className="flex items-center gap-1 mt-1">
                  <div className="flex -space-x-1">{r.members.slice(0, 4).map((m) => { const c = COLOR_MAP[m.color] || COLOR_MAP.blue; return <div key={m.id} className={cn("w-4 h-4 rounded-full border border-background", c.bg)} />; })}</div>
                  <span className="text-[9px] text-muted-foreground">{r.members.length} 成员</span>
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* 聊天区 */}
      <div className="flex-1 flex flex-col min-w-0">
        {!activeRoom ? (
          <div className="flex-1 flex items-center justify-center nx-aurora">
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl nx-brand-grad shadow-lg mb-4"><MessagesSquare className="w-8 h-8 text-white" /></div>
              <h2 className="text-lg font-semibold mb-2">Agent 群聊协作</h2>
              <p className="text-sm text-muted-foreground max-w-md mb-4">像拉微信群一样，把多个 Agent 拉进一个房间。<br/>你说什么他们就回应什么，下任务就各司其职讨论。</p>
              <Button onClick={() => setShowCreate(true)} className="nx-brand-grad border-0 text-white"><Plus className="w-4 h-4" /> 创建群聊</Button>
            </div>
          </div>
        ) : (
          <>
            <header className="shrink-0 border-b border-border px-4 py-2.5 flex items-center justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-medium truncate">{activeRoom.name}</h2>
                  {running && <span className="flex items-center gap-1 text-[10px] text-nx-success bg-nx-success/10 px-1.5 py-0.5 rounded-full"><Loader2 className="w-2.5 h-2.5 animate-spin" /> 回复中</span>}
                </div>
                <div className="flex items-center gap-1 mt-0.5">
                  <div className="flex -space-x-1">{activeRoom.members.map((m) => { const c = COLOR_MAP[m.color] || COLOR_MAP.blue; const Icon = (Icons as any)[m.icon] || Users; return <div key={m.id} className={cn("w-5 h-5 rounded-full border border-background flex items-center justify-center", c.bg)} title={`${m.name} (${m.role})`}><Icon className={cn("w-2.5 h-2.5", c.text)} /></div>; })}</div>
                  <span className="text-[10px] text-muted-foreground">{activeRoom.members.length} 位 Agent</span>
                </div>
              </div>
              <button onClick={() => deleteRoom(activeRoom.id)} className="p-1.5 rounded-md hover:bg-destructive/10 hover:text-destructive transition-colors" title="删除群聊"><Trash2 className="w-3.5 h-3.5" /></button>
            </header>

            <div ref={scrollRef} className="flex-1 overflow-y-auto nx-scroll">
              <div className="max-w-3xl mx-auto px-4 py-4 space-y-3">
                {messages.length === 0 && !running && <div className="text-center py-12 text-sm text-muted-foreground">发消息开始群聊<br/><span className="text-[10px]">Agent 们会像真人一样回应你</span></div>}
                <AnimatePresence initial={false}>
                  {messages.map((msg) => {
                    const isSystem = msg.senderId === "system";
                    const isUser = msg.senderId === "user";
                    const c = COLOR_MAP[msg.color] || COLOR_MAP.blue;
                    const Icon = isSystem ? MessagesSquare : isUser ? Users : (Icons as any)[activeRoom.members.find(m => m.id === msg.senderId)?.icon || "Users"] || Users;
                    return (
                      <motion.div key={msg.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cn("flex gap-2.5", isSystem && "justify-center")}>
                        {isSystem ? <div className="text-[11px] text-muted-foreground bg-muted/50 rounded-full px-3 py-1">{msg.content}</div> : (
                          <>
                            <div className={cn("shrink-0 w-7 h-7 rounded-lg flex items-center justify-center", c.bg)}><Icon className={cn("w-3.5 h-3.5", c.text)} /></div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <span className="text-xs font-medium">{msg.senderName}</span>
                                {msg.senderRole && <Badge variant="outline" className={cn("text-[9px] px-1 py-0", c.text)}>{msg.senderRole}</Badge>}
                              </div>
                              <div className={cn("rounded-2xl px-3.5 py-2.5 text-sm bg-card border border-border", !msg.content && "text-muted-foreground")}>
                                {msg.content ? <div className={cn("whitespace-pre-wrap break-words", running && msg.id === messages[messages.length-1]?.id && "nx-caret")}>{msg.content}</div> : <span className="flex items-center gap-1.5 text-xs"><span className="w-1.5 h-1.5 rounded-full bg-nx-brand animate-pulse" /> 正在回复…</span>}
                              </div>
                            </div>
                          </>
                        )}
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            </div>

            <div className="shrink-0 border-t border-border px-4 py-3 bg-background/80 backdrop-blur-sm">
              <div className="max-w-3xl mx-auto">
                <div className="relative rounded-2xl border border-border bg-card focus-within:border-nx-brand/60 focus-within:nx-glow transition-all overflow-hidden">
                  <Textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="发消息给群聊… (Enter 发送)" disabled={running} className="min-h-[44px] max-h-[120px] resize-none border-0 bg-transparent px-4 py-3 pr-20 text-sm focus-visible:ring-0" rows={1} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} />
                  <div className="absolute right-2 bottom-2 flex items-center gap-1">
                    {running ? <Button size="icon" variant="destructive" className="h-7 w-7 rounded-lg" onClick={stopGroup} title="停止"><Square className="w-3 h-3" fill="currentColor" /></Button> : <Button size="icon" className="h-7 w-7 rounded-lg nx-brand-grad border-0 hover:opacity-90" onClick={sendMessage} disabled={!input.trim()} title="发送"><Send className="w-3.5 h-3.5" /></Button>}
                  </div>
                </div>
                <div className="flex items-center justify-between mt-1.5 px-1">
                  <span className="text-[10px] text-muted-foreground">{activeRoom.members.length} 位 Agent · 你说什么他们就回应什么</span>
                  <span className="text-[10px] text-muted-foreground">{input.length} 字符</span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
      <CreateRoomDialog open={showCreate} onOpenChange={setShowCreate} onCreate={createRoom} />
    </div>
  );
}

function CreateRoomDialog({ open, onOpenChange, onCreate }: { open: boolean; onOpenChange: (v: boolean) => void; onCreate: (name: string, members: GroupMember[]) => void }) {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<GroupMember[]>([]);
  const [customName, setCustomName] = useState("");
  const [customRole, setCustomRole] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");
  const [customColor, setCustomColor] = useState("blue");

  const toggleTemplate = (t: Omit<GroupMember, "id">) => {
    const existing = selected.find((m) => m.name === t.name);
    if (existing) setSelected(selected.filter((m) => m.id !== existing.id));
    else setSelected([...selected, { ...t, id: genId() }]);
  };
  const addCustom = () => {
    if (!customName.trim() || !customPrompt.trim()) return;
    setSelected([...selected, { id: genId(), name: customName.trim(), role: customRole.trim() || "自定义", systemPrompt: customPrompt.trim(), color: customColor, icon: "User" }]);
    setCustomName(""); setCustomRole(""); setCustomPrompt("");
  };
  const submit = () => { if (selected.length === 0) return; onCreate(name.trim() || `群聊-${selected.length}人`, selected); setName(""); setSelected([]); };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto nx-scroll" aria-describedby={undefined}>
        <DialogHeader><DialogTitle className="flex items-center gap-2"><MessagesSquare className="w-4 h-4 text-nx-rose" /> 创建群聊</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5"><label className="text-xs font-medium text-muted-foreground">群聊名称</label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：技术讨论组" className="text-sm" /></div>
          <div className="space-y-2">
            <div className="flex items-center justify-between"><label className="text-xs font-medium text-muted-foreground">选择成员</label><span className="text-[10px] text-muted-foreground">{selected.length} 人</span></div>
            <div className="grid grid-cols-2 gap-1.5">
              {MEMBER_TEMPLATES.map((t) => {
                const isSelected = selected.some((m) => m.name === t.name);
                const c = COLOR_MAP[t.color] || COLOR_MAP.blue;
                const Icon = (Icons as any)[t.icon] || Users;
                return <button key={t.name} onClick={() => toggleTemplate(t)} className={cn("flex items-center gap-2 rounded-lg border p-2 transition-colors text-left", isSelected ? cn(c.bg) : "border-border hover:bg-accent")}>
                  <div className={cn("shrink-0 w-7 h-7 rounded-md flex items-center justify-center", c.bg)}><Icon className={cn("w-3.5 h-3.5", c.text)} /></div>
                  <div className="min-w-0 flex-1"><div className="text-xs font-medium">{t.name}</div><div className="text-[9px] text-muted-foreground">{t.role}</div></div>
                  {isSelected && <Check className={cn("w-3.5 h-3.5 shrink-0", c.text)} />}
                </button>;
              })}
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1"><UserPlus className="w-3 h-3" /> 添加自定义成员</label>
            <div className="rounded-lg border border-border p-2.5 space-y-2">
              <div className="grid grid-cols-2 gap-1.5"><Input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="名称" className="h-7 text-xs" /><Input value={customRole} onChange={(e) => setCustomRole(e.target.value)} placeholder="角色" className="h-7 text-xs" /></div>
              <Textarea value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} placeholder="系统提示词" className="text-xs min-h-[50px]" />
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground">颜色:</span>
                {Object.entries(COLOR_MAP).filter(([k]) => k !== "zinc").map(([k, v]) => <button key={k} onClick={() => setCustomColor(k)} className={cn("w-5 h-5 rounded-full border-2", v.bg, customColor === k ? "border-foreground" : "border-transparent")} />)}
                <Button size="sm" variant="outline" className="h-6 ml-auto text-[10px] px-2" onClick={addCustom} disabled={!customName.trim() || !customPrompt.trim()}>添加</Button>
              </div>
            </div>
          </div>
          {selected.length > 0 && <div className="flex flex-wrap gap-1.5">{selected.map((m) => { const c = COLOR_MAP[m.color] || COLOR_MAP.blue; return <div key={m.id} className={cn("flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px]", c.bg, c.text)}>{m.name}<button onClick={() => setSelected(selected.filter((x) => x.id !== m.id))} className="hover:text-destructive"><X className="w-2.5 h-2.5" /></button></div>; })}</div>}
          <Button onClick={submit} disabled={selected.length === 0} className="w-full nx-brand-grad border-0 text-white">创建群聊 ({selected.length} 人)</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

