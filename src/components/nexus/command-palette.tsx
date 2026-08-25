"use client";
// 全局命令面板：Ctrl/Cmd + K 打开，快速跳转功能模块。
import { useEffect, useMemo, useState } from "react";
import { Search, MessageSquare, MessagesSquare, Sparkles, Users, Brain, Network, GitBranch, Share2, FolderTree } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useNexus } from "@/hooks/nexus/use-nexus";
import { cn } from "@/lib/utils";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const setNavSection = useNexus((s) => s.setNavSection);
  const setView = useNexus((s) => s.setView);
  const setDetailsOpen = useNexus((s) => s.setDetailsOpen);

  const items = useMemo(() => [
    { id: "sessions", label: "会话", icon: MessageSquare, action: () => { setNavSection("sessions"); setView("chat"); } },
    { id: "group", label: "群聊", icon: MessagesSquare, action: () => setNavSection("group") },
    { id: "skills", label: "技能", icon: Sparkles, action: () => setNavSection("skills") },
    { id: "team", label: "团队", icon: Users, action: () => setNavSection("team") },
    { id: "memory", label: "记忆", icon: Brain, action: () => setNavSection("memory") },
    { id: "mcp", label: "MCP", icon: Network, action: () => setNavSection("mcp") },
    { id: "graph", label: "执行图", icon: Share2, action: () => { setNavSection("sessions"); setView("graph"); } },
    { id: "timeline", label: "时间轴 · 回溯", icon: GitBranch, action: () => { setNavSection("sessions"); setView("timeline"); } },
    { id: "codegraph", label: "代码图谱", icon: FolderTree, action: () => { setNavSection("sessions"); setView("codegraph"); } },
    { id: "details", label: "详情面板", icon: Search, action: () => setDetailsOpen(true) },
  ], [setNavSection, setView, setDetailsOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSelectedIndex(0);
        setQuery("");
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const filtered = items.filter((i) => i.label.toLowerCase().includes(query.toLowerCase()));

  const run = (item: (typeof items)[number]) => {
    item.action();
    setOpen(false);
    setQuery("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="text-sm">命令面板</DialogTitle>
          <DialogDescription className="sr-only">快速跳转</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelectedIndex((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelectedIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const item = filtered[selectedIndex];
                if (item) run(item);
              }
            }}
            placeholder="搜索功能…"
            className="pl-9"
          />
        </div>
        <div className="mt-2 space-y-1 max-h-72 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-6">无匹配功能</div>
          ) : (
            filtered.map((item, index) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => run(item)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={cn(
                    "w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                    selectedIndex === index ? "bg-accent" : "hover:bg-accent"
                  )}
                >
                  <Icon className="size-4 text-nx-brand shrink-0" />
                  {item.label}
                </button>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
