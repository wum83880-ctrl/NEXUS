"use client";
// NEXUS 团队面板 — 浏览角色，委派任务到群聊，自定义新角色
import { useEffect, useMemo, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import * as Icons from "lucide-react";
import {
  Users, Plus, Search, Loader2, Wrench, ChevronRight, Send, UserPlus, Check, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { useNexus } from "@/hooks/nexus/use-nexus";
import { useToast } from "@/hooks/use-toast";
import { TEAM_MAP, type TeamMember } from "@/lib/nexus/team";
import { cn } from "@/lib/utils";

const COLOR_MAP: Record<string, { bg: string; text: string; ring: string }> = {
  blue: { bg: "bg-blue-500/15", text: "text-blue-400", ring: "ring-blue-500/30" },
  emerald: { bg: "bg-emerald-500/15", text: "text-emerald-400", ring: "ring-emerald-500/30" },
  amber: { bg: "bg-amber-500/15", text: "text-amber-400", ring: "ring-amber-500/30" },
  purple: { bg: "bg-purple-500/15", text: "text-purple-400", ring: "ring-purple-500/30" },
  rose: { bg: "bg-rose-500/15", text: "text-rose-400", ring: "ring-rose-500/30" },
  cyan: { bg: "bg-cyan-500/15", text: "text-cyan-400", ring: "ring-cyan-500/30" },
  violet: { bg: "bg-violet-500/15", text: "text-violet-400", ring: "ring-violet-500/30" },
  teal: { bg: "bg-teal-500/15", text: "text-teal-400", ring: "ring-teal-500/30" },
  zinc: { bg: "bg-zinc-500/15", text: "text-zinc-300", ring: "ring-zinc-500/30" },
};

function toPascal(s: string) {
  if (!s) return "User";
  if (/^[A-Z]/.test(s)) return s;
  return s.split(/[-_ ]/).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
}
function DynamicIcon({ name, className }: { name: string; className?: string }) {
  const I = (Icons as any)[toPascal(name)] || Users;
  return <I className={className} />;
}

export function TeamPanel() {
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const setNavSection = useNexus((s) => s.setNavSection);
  const setPendingGroupRoomId = useNexus((s) => s.setPendingGroupRoomId);
  const setPendingGroupMessage = useNexus((s) => s.setPendingGroupMessage);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/custom-team");
      const data = await res.json();
      setTeam(data.team || []);
    } catch {
      toast({ title: "加载失败", description: "无法获取团队成员", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!query.trim()) return team;
    const q = query.toLowerCase();
    return team.filter(
      (m) => m.name.toLowerCase().includes(q) || m.role.toLowerCase().includes(q) || m.description.toLowerCase().includes(q),
    );
  }, [team, query]);

  const delegate = async (member: TeamMember, task: string) => {
    const t = task.trim();
    if (!t) {
      toast({ title: "请输入任务内容", variant: "destructive" });
      return;
    }
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `委派 · ${member.name}`,
          members: [{
            id: member.id,
            name: member.name,
            role: member.role,
            systemPrompt: member.systemPrompt,
            color: member.color,
            icon: member.icon,
          }],
          task: t,
        }),
      });
      if (!res.ok) throw new Error("创建群聊失败");
      const data = await res.json();
      const roomId = data.room?.id;
      if (!roomId) throw new Error("未获取到群聊 ID");
      // 让 GroupPanel 自动选中并自动发送消息
      setPendingGroupRoomId(roomId);
      setPendingGroupMessage(t);
      setNavSection("group");
      toast({ title: `已委派给 ${member.name}`, description: "正在切换到群聊…" });
    } catch (err: any) {
      toast({ title: "委派失败", description: err?.message, variant: "destructive" });
    }
  };

  const removeMember = async (member: TeamMember) => {
    if (!confirm(`确定删除自定义角色「${member.name}」吗？`)) return;
    setDeletingId(member.id);
    try {
      const res = await fetch(`/api/custom-team/${member.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("删除失败");
      toast({ title: "已删除", description: member.name });
      await load();
    } catch (err: any) {
      toast({ title: "删除失败", description: err?.message, variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <header className="shrink-0 border-b border-border bg-card/40 backdrop-blur-sm px-4 sm:px-6 py-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <div className="size-8 rounded-lg nx-brand-grad flex items-center justify-center shrink-0">
              <Users className="size-4 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground">团队</h2>
              <p className="text-[11px] text-muted-foreground truncate">
                {team.length} 位角色 · 委派任务到独立群聊
              </p>
            </div>
          </div>
          <Button size="sm" className="nx-brand-grad border-0 text-primary-foreground" onClick={() => setShowCreate(true)}>
            <Plus className="size-3.5" /> 新建角色
          </Button>
        </div>
        <div className="mt-3 relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索角色名称、定位或能力…"
            className="pl-8 h-8 text-xs max-w-md"
          />
        </div>
      </header>

      <ScrollArea className="flex-1 nx-scroll">
        <div className="p-4 sm:p-6">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-muted-foreground">
              <Loader2 className="size-5 animate-spin mr-2" /> 加载中…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="size-14 rounded-2xl bg-accent flex items-center justify-center mb-3">
                <Users className="size-6 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground mb-3">未找到匹配角色</p>
              <Button size="sm" variant="outline" onClick={() => setShowCreate(true)}>
                <Plus className="size-3.5" /> 创建新角色
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.map((m, idx) => (
                <MemberCard
                  key={m.id}
                  member={m}
                  index={idx}
                  expanded={expandedId === m.id}
                  onToggle={() => setExpandedId(expandedId === m.id ? null : m.id)}
                  onDelegate={(task) => delegate(m, task)}
                  onDelete={() => removeMember(m)}
                  deleting={deletingId === m.id}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      <CreateMemberDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreated={() => { setShowCreate(false); load(); }}
      />
    </div>
  );
}

function MemberCard({
  member, index, expanded, onToggle, onDelegate, onDelete, deleting,
}: {
  member: TeamMember; index: number; expanded: boolean; onToggle: () => void; onDelegate: (task: string) => void; onDelete: () => void; deleting: boolean;
}) {
  const c = COLOR_MAP[member.color] || COLOR_MAP.blue;
  const [task, setTask] = useState("");
  const [submitting, setSubmitting] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.04, 0.3) }}
      whileHover={{ y: -2 }}
      className={cn(
        "rounded-xl border bg-card/70 backdrop-blur-sm overflow-hidden transition-colors",
        expanded ? cn("ring-1", c.ring) : "border-border hover:border-nx-brand/40",
      )}
    >
      <button type="button" onClick={onToggle} className="w-full text-left p-4">
        <div className="flex items-start gap-3">
          <div className={cn("size-10 rounded-lg flex items-center justify-center shrink-0 ring-1", c.bg, c.ring)}>
            <DynamicIcon name={member.icon} className={cn("size-5", c.text)} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-0.5">
              <h3 className="text-sm font-medium text-foreground truncate">{member.name}</h3>
            </div>
            <div className={cn("text-[11px] mb-1", c.text)}>{member.role}</div>
            <p className="text-xs text-muted-foreground line-clamp-2">{member.description}</p>
          </div>
          <ChevronRight className={cn("size-4 text-muted-foreground shrink-0 transition-transform", expanded && "rotate-90")} />
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-border overflow-hidden"
          >
            <div className="p-4 space-y-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">系统提示词</div>
                <pre className="text-[11px] leading-relaxed text-foreground/90 bg-muted/40 border border-border rounded-lg p-2.5 whitespace-pre-wrap break-words max-h-40 overflow-y-auto nx-scroll">
                  {member.systemPrompt}
                </pre>
              </div>
              {member.suggestedTools && member.suggestedTools.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
                    <Wrench className="size-3" /> 推荐工具
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {member.suggestedTools.map((t) => (
                      <Badge key={t} variant="secondary" className="text-[10px] px-1.5 py-0">{t}</Badge>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">委派任务</div>
                <div className="relative">
                  <Textarea
                    value={task}
                    onChange={(e) => setTask(e.target.value)}
                    placeholder={`向 ${member.name} 描述任务…`}
                    className="text-xs min-h-[64px] pr-12 resize-none"
                  />
                  <Button
                    size="icon"
                    className={cn("absolute right-1.5 bottom-1.5 size-7 rounded-md border-0 text-primary-foreground", "nx-brand-grad")}
                    onClick={async () => {
                      setSubmitting(true);
                      try { await onDelegate(task); setTask(""); } finally { setSubmitting(false); }
                    }}
                    disabled={submitting || !task.trim()}
                    title="委派"
                  >
                    {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">将创建一个仅含此角色的群聊并自动发送任务</p>
              </div>
              {!TEAM_MAP[member.id] && (
                <Button size="sm" variant="outline" className="w-full" onClick={onDelete} disabled={deleting}>
                  {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                  删除角色
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function CreateMemberDialog({
  open, onOpenChange, onCreated,
}: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("User");
  const [role, setRole] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [color, setColor] = useState("blue");
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const ICON_OPTIONS = ["User", "Microscope", "Code2", "ChartColumn", "PenLine", "ShieldCheck", "Route", "ListTree", "Languages", "Brain", "Bot", "Sparkles"];
  const COLORS = ["blue", "emerald", "amber", "purple", "rose", "cyan", "violet", "teal"];

  const submit = async () => {
    if (!name.trim() || !systemPrompt.trim()) {
      toast({ title: "请填写名称和系统提示词", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/custom-team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          icon: icon.trim() || "User",
          role: role.trim() || "自定义角色",
          description: description.trim(),
          systemPrompt: systemPrompt.trim(),
          color,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "创建失败");
      }
      toast({ title: "角色已创建", description: name.trim() });
      setName(""); setIcon("User"); setRole(""); setDescription(""); setSystemPrompt(""); setColor("blue");
      onCreated();
    } catch (err: any) {
      toast({ title: "创建失败", description: err?.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[88vh] overflow-y-auto nx-scroll" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UserPlus className="size-4 text-nx-brand" /> 新建角色</DialogTitle>
          <DialogDescription className="sr-only">填写角色信息</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="grid grid-cols-2 gap-2">
            <Field label="名称">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：架构师" className="text-sm h-9" />
            </Field>
            <Field label="角色定位">
              <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="一句话定位" className="text-sm h-9" />
            </Field>
          </div>
          <Field label="描述">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="角色能力详述" className="text-sm h-9" />
          </Field>
          <Field label="图标">
            <div className="grid grid-cols-6 gap-1.5">
              {ICON_OPTIONS.map((n) => {
                const I = (Icons as any)[n] || Users;
                const sel = icon === n;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setIcon(n)}
                    className={cn(
                      "size-9 rounded-lg border flex items-center justify-center transition-colors",
                      sel ? "border-nx-brand bg-nx-brand/15 text-nx-brand" : "border-border text-muted-foreground hover:text-foreground hover:bg-accent",
                    )}
                    title={n}
                  >
                    <I className="size-4" />
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label="颜色">
            <div className="flex items-center gap-1.5 flex-wrap">
              {COLORS.map((k) => {
                const v = COLOR_MAP[k] || COLOR_MAP.blue;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setColor(k)}
                    className={cn("size-6 rounded-full border-2 flex items-center justify-center", v.bg, color === k ? "border-foreground" : "border-transparent")}
                    title={k}
                  >
                    {color === k && <Check className={cn("size-3", v.text)} />}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label="系统提示词">
            <Textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="详细描述角色的行为准则、输出风格…"
              className="text-xs min-h-[120px] font-mono"
            />
          </Field>
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>取消</Button>
            <Button size="sm" className="nx-brand-grad border-0 text-primary-foreground" onClick={submit} disabled={submitting}>
              {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              创建
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
