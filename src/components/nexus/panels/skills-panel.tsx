"use client";
// NEXUS 技能面板 — 浏览内置与自定义技能，点击运行注入到当前会话
import { useEffect, useMemo, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import * as Icons from "lucide-react";
import {
  Sparkles, Plus, Play, Search, Loader2, Wrench, ChevronRight, X, Check, Trash2,
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
import { SKILL_MAP, type Skill } from "@/lib/nexus/skills";
import { cn } from "@/lib/utils";

const CATEGORY_COLORS: Record<string, string> = {
  研究: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  开发: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  写作: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  语言: "bg-teal-500/15 text-teal-400 border-teal-500/30",
  创意: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  学习: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  效率: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  通用: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
};

function toPascal(s: string) {
  if (!s) return "Sparkles";
  if (/^[A-Z]/.test(s)) return s;
  return s.split(/[-_ ]/).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
}

function DynamicIcon({ name, className }: { name: string; className?: string }) {
  const I = (Icons as any)[toPascal(name)] || Sparkles;
  return <I className={className} />;
}

export function SkillsPanel() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const send = useNexus((s) => s.send);
  const sessionId = useNexus((s) => s.activeSessionId);
  const runTurn = useNexus((s) => s.runTurn);
  const setNavSection = useNexus((s) => s.setNavSection);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/custom-skills");
      const data = await res.json();
      setSkills(data.skills || []);
    } catch {
      toast({ title: "加载失败", description: "无法获取技能列表", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    skills.forEach((s) => set.add(s.category || "通用"));
    return Array.from(set);
  }, [skills]);

  const filtered = useMemo(() => {
    let list = skills;
    if (activeCategory) list = list.filter((s) => (s.category || "通用") === activeCategory);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
      );
    }
    return list;
  }, [skills, activeCategory, query]);

  const runSkill = (skill: Skill) => {
    if (!sessionId || !send) {
      toast({
        title: "无可用会话",
        description: "请先在「会话」页新建或选择一个会话",
        variant: "destructive",
      });
      return;
    }
    setRunning(skill.id);
    send({ type: "chat:run", sessionId, message: skill.prompt, turn: runTurn + 1 });
    toast({ title: `已运行：${skill.name}`, description: "已切换回会话页查看结果" });
    setTimeout(() => {
      setRunning(null);
      setNavSection("sessions");
    }, 400);
  };

  const removeSkill = async (skill: Skill) => {
    if (!confirm(`确定删除自定义技能「${skill.name}」吗？`)) return;
    setDeletingId(skill.id);
    try {
      const res = await fetch(`/api/custom-skills/${skill.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("删除失败");
      toast({ title: "已删除", description: skill.name });
      await load();
    } catch (err: any) {
      toast({ title: "删除失败", description: err?.message, variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  const startEdit = (skill: Skill) => {
    setEditingSkill(skill);
    setShowCreate(true);
  };

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <header className="shrink-0 border-b border-border bg-card/40 backdrop-blur-sm px-4 sm:px-6 py-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <div className="size-8 rounded-lg nx-brand-grad flex items-center justify-center shrink-0">
              <Sparkles className="size-4 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground">技能库</h2>
              <p className="text-[11px] text-muted-foreground truncate">
                {skills.length} 个技能 · 点击运行注入到当前会话
              </p>
            </div>
          </div>
          <Button size="sm" className="nx-brand-grad border-0 text-primary-foreground" onClick={() => setShowCreate(true)}>
            <Plus className="size-3.5" /> 新建技能
          </Button>
        </div>

        {/* 搜索 + 过滤 */}
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索技能名称或描述…"
              className="pl-8 h-8 text-xs"
            />
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            <FilterChip
              active={activeCategory === null}
              onClick={() => setActiveCategory(null)}
              label="全部"
            />
            {categories.map((c) => (
              <FilterChip
                key={c}
                active={activeCategory === c}
                onClick={() => setActiveCategory(c === activeCategory ? null : c)}
                label={c}
              />
            ))}
          </div>
        </div>
      </header>

      {/* 卡片网格 */}
      <ScrollArea className="flex-1 nx-scroll">
        <div className="p-4 sm:p-6">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-muted-foreground">
              <Loader2 className="size-5 animate-spin mr-2" /> 加载中…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="size-14 rounded-2xl bg-accent flex items-center justify-center mb-3">
                <Sparkles className="size-6 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground mb-3">未找到匹配技能</p>
              <Button size="sm" variant="outline" onClick={() => setShowCreate(true)}>
                <Plus className="size-3.5" /> 创建新技能
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.map((skill, idx) => (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  index={idx}
                  expanded={expandedId === skill.id}
                  onToggle={() => setExpandedId(expandedId === skill.id ? null : skill.id)}
                  onRun={() => runSkill(skill)}
                  onEdit={() => startEdit(skill)}
                  onDelete={() => removeSkill(skill)}
                  running={running === skill.id}
                  deleting={deletingId === skill.id}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      <CreateSkillDialog
        open={showCreate}
        initial={editingSkill}
        onOpenChange={(v) => { setShowCreate(v); if (!v) setEditingSkill(null); }}
        onCreated={() => { setShowCreate(false); setEditingSkill(null); load(); }}
      />
    </div>
  );
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-[11px] px-2.5 py-1 rounded-full border transition-colors",
        active
          ? "bg-accent border-border text-foreground"
          : "bg-transparent border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/50",
      )}
    >
      {label}
    </button>
  );
}

function SkillCard({
  skill, index, expanded, onToggle, onRun, onEdit, onDelete, running, deleting,
}: {
  skill: Skill; index: number; expanded: boolean; onToggle: () => void; onRun: () => void; onEdit: () => void; onDelete: () => void; running: boolean; deleting: boolean;
}) {
  const catColor = CATEGORY_COLORS[skill.category] || CATEGORY_COLORS.通用;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.04, 0.3) }}
      whileHover={{ y: -2 }}
      className={cn(
        "rounded-xl border bg-card/70 backdrop-blur-sm overflow-hidden transition-colors",
        expanded ? "border-nx-brand/50 nx-glow" : "border-border hover:border-nx-brand/40",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left p-4"
      >
        <div className="flex items-start gap-3">
          <div className={cn("size-10 rounded-lg flex items-center justify-center shrink-0", catColor)}>
            <DynamicIcon name={skill.icon} className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-0.5">
              <h3 className="text-sm font-medium text-foreground truncate">{skill.name}</h3>
              <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0", catColor)}>{skill.category}</Badge>
            </div>
            <p className="text-xs text-muted-foreground line-clamp-2">{skill.description}</p>
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
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">提示词</div>
                <pre className="text-[11px] leading-relaxed text-foreground/90 bg-muted/40 border border-border rounded-lg p-2.5 whitespace-pre-wrap break-words max-h-48 overflow-y-auto nx-scroll">
                  {skill.prompt}
                </pre>
              </div>
              {skill.suggestedTools && skill.suggestedTools.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
                    <Wrench className="size-3" /> 推荐工具
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {skill.suggestedTools.map((t) => (
                      <Badge key={t} variant="secondary" className="text-[10px] px-1.5 py-0">{t}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {skill.starter && (
                <div className="text-[11px] text-muted-foreground italic">输入提示：{skill.starter}</div>
              )}
              <Button
                size="sm"
                className="w-full nx-brand-grad border-0 text-primary-foreground"
                onClick={onRun}
                disabled={running}
              >
                {running ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                {running ? "运行中…" : "运行此技能"}
              </Button>
              {!SKILL_MAP[skill.id] && (
                <div className="grid grid-cols-2 gap-2">
                  <Button size="sm" variant="outline" onClick={onEdit}>
                    <Check className="size-3.5" /> 编辑
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onDelete}
                    disabled={deleting}
                  >
                    {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                    删除
                  </Button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function CreateSkillDialog({
  open, initial, onOpenChange, onCreated,
}: { open: boolean; initial: Skill | null; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("Sparkles");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("通用");
  const [prompt, setPrompt] = useState("");
  const [suggestedTools, setSuggestedTools] = useState("");
  const [starter, setStarter] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const ICON_OPTIONS = ["Sparkles", "Microscope", "Code2", "FileText", "Languages", "Lightbulb", "GraduationCap", "ListChecks", "ScanText", "PenLine", "Brain", "Zap"];

  useEffect(() => {
    if (open && initial) {
      setName(initial.name);
      setIcon(initial.icon);
      setDescription(initial.description || "");
      setCategory(initial.category || "通用");
      setPrompt(initial.prompt);
      setSuggestedTools((initial.suggestedTools || []).join(", "));
      setStarter(initial.starter || "");
    } else if (!open) {
      setName(""); setIcon("Sparkles"); setDescription(""); setCategory("通用");
      setPrompt(""); setSuggestedTools(""); setStarter("");
    }
  }, [open, initial]);

  const submit = async () => {
    if (!name.trim() || !prompt.trim()) {
      toast({ title: "请填写名称和提示词", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        name: name.trim(),
        icon: icon.trim() || "Sparkles",
        description: description.trim(),
        category: category.trim() || "通用",
        prompt: prompt.trim(),
        suggestedTools: suggestedTools.split(/[,，\n]/).map((s) => s.trim()).filter(Boolean),
        starter: starter.trim(),
      };
      const res = initial
        ? await fetch(`/api/custom-skills/${initial.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/custom-skills", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || (initial ? "更新失败" : "创建失败"));
      }
      toast({ title: initial ? "技能已更新" : "技能已创建", description: name.trim() });
      setName(""); setIcon("Sparkles"); setDescription(""); setCategory("通用");
      setPrompt(""); setSuggestedTools(""); setStarter("");
      onCreated();
    } catch (err: any) {
      toast({ title: "创建失败", description: err?.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); }}>
      <DialogContent className="sm:max-w-lg max-h-[88vh] overflow-y-auto nx-scroll" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="size-4 text-nx-brand" /> {initial ? "编辑技能" : "新建技能"}</DialogTitle>
          <DialogDescription className="sr-only">填写技能信息</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="grid grid-cols-2 gap-2">
            <Field label="名称">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：数据清洗" className="text-sm h-9" />
            </Field>
            <Field label="分类">
              <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="通用" className="text-sm h-9" />
            </Field>
          </div>
          <Field label="描述">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="一句话说明这个技能做什么" className="text-sm h-9" />
          </Field>
          <Field label="图标">
            <div className="grid grid-cols-6 gap-1.5">
              {ICON_OPTIONS.map((n) => {
                const I = (Icons as any)[n] || Sparkles;
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
          <Field label="提示词（注入到系统提示）">
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="详细描述这个技能的工作方式、步骤、输出格式…"
              className="text-xs min-h-[120px] font-mono"
            />
          </Field>
          <div className="grid grid-cols-1 gap-2">
            <Field label="推荐工具（用逗号或换行分隔）">
              <Textarea
                value={suggestedTools}
                onChange={(e) => setSuggestedTools(e.target.value)}
                placeholder="web_search, page_reader, memory_save"
                className="text-xs min-h-[44px]"
              />
            </Field>
            <Field label="输入框占位提示">
              <Input value={starter} onChange={(e) => setStarter(e.target.value)} placeholder="例如：输入研究主题…" className="text-sm h-9" />
            </Field>
          </div>
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
