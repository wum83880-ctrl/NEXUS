"use client";
// 快捷指令 — 输入 / 触发：目标 / 计划 / 压缩 / 图谱 / 整理。
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Target, ListChecks, Archive, Network, Wand2 } from "lucide-react";
import { useNexus } from "@/hooks/nexus/use-nexus";
import { cn } from "@/lib/utils";

interface SlashCommand {
  id: "goal" | "plan" | "compact" | "graph" | "organize";
  label: string;
  desc: string;
  icon: any;
  placeholder?: string;
}

const COMMANDS: SlashCommand[] = [
  {
    id: "goal",
    label: "/goal",
    desc: "设置会话总目标（存入会话元数据，全程约束 Agent）",
    icon: Target,
    placeholder: "本次会话要达成的目标，例如：做一个可上线的个人博客站点",
  },
  {
    id: "plan",
    label: "/plan",
    desc: "基于当前上下文 + 目标生成结构化执行计划",
    icon: ListChecks,
  },
  {
    id: "compact",
    label: "/compact",
    desc: "手动压缩上下文（保留目标/计划/最新内容，原始记录完整保留在快照）",
    icon: Archive,
  },
  {
    id: "graph",
    label: "/graph",
    desc: "分析工作区并建立代码图谱（扫描 + LLM 归纳，注入项目结构认知）",
    icon: Network,
  },
  {
    id: "organize",
    label: "/organize",
    desc: "智能整理项目：大模型分析结构并自动移动/改名（绝不删除），需在对话中确认",
    icon: Wand2,
  },
];

// 斜杠系统指令的本地解析与执行（会话控制类，不进入 LLM 消息队列）。
// 返回 true 表示已作为系统指令处理；false 表示不是系统指令，按普通消息发送。
export async function executeSlashCommand(
  raw: string,
  ctx: { sessionId: string; send: (m: any) => void },
): Promise<boolean> {
  const match = /^\/(goal|plan|compact|graph|organize)\b/i.exec(raw.trim());
  if (!match) return false;
  const cmd = match[1].toLowerCase();
  const rest = raw.trim().slice(match[0].length).trim();

  if (cmd === "goal") {
    if (!rest) return false; // 无内容则交回选择器的输入流程
    try {
      const res = await fetch(`/api/sessions/${ctx.sessionId}/meta`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "goal", content: rest }),
      });
      const data = await res.json();
      if (res.ok && data.event) {
        useNexus.getState().applyLiveEvent({ type: "session/goal", data: data.event.data, createdAt: data.event.createdAt });
      }
    } catch {}
    return true;
  }
  if (cmd === "plan") {
    ctx.send({ type: "chat:plan", sessionId: ctx.sessionId });
    return true;
  }
  if (cmd === "compact") {
    ctx.send({ type: "chat:compact", sessionId: ctx.sessionId });
    return true;
  }
  if (cmd === "graph") {
    ctx.send({ type: "chat:graph", sessionId: ctx.sessionId });
    return true;
  }
  if (cmd === "organize") {
    if (!window.confirm("智能整理将让大模型分析项目结构并自动整理（仅移动/改名，绝不删除任何文件）。确认继续？")) return true;
    ctx.send({ type: "chat:organize", sessionId: ctx.sessionId });
    return true;
  }
  return false;
}

export function SlashCommandPicker({
  input, onClose,
}: {
  input: string;
  onPick: (text: string) => void;
  onClose: () => void;
}) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [argInput, setArgInput] = useState("");
  const [activeCmd, setActiveCmd] = useState<SlashCommand | null>(null);
  const send = useNexus((s) => s.send);
  const activeSessionId = useNexus((s) => s.activeSessionId);

  const query = input.slice(1).toLowerCase();
  const filtered = COMMANDS.filter((c) => c.label.toLowerCase().includes(query) || c.desc.includes(query));

  const [prevQuery, setPrevQuery] = useState(query);
  if (prevQuery !== query) {
    setPrevQuery(query);
    setSelectedIdx(0);
  }

  const runControl = async (cmd: SlashCommand, arg: string) => {
    if (!activeSessionId || !send) return;
    await executeSlashCommand(`/${cmd.id} ${arg}`.trim(), { sessionId: activeSessionId, send });
  };

  const execute = (cmd: SlashCommand) => {
    if (cmd.placeholder) {
      setActiveCmd(cmd);
      setArgInput("");
    } else {
      runControl(cmd, "");
      onClose();
    }
  };

  useEffect(() => {
    if (activeCmd || filtered.length === 0) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault(); e.stopPropagation();
        setSelectedIdx((i) => (i + 1) % filtered.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault(); e.stopPropagation();
        setSelectedIdx((i) => (i - 1 + filtered.length) % filtered.length);
      } else if (e.key === "Enter") {
        e.preventDefault(); e.stopPropagation();
        const cmd = filtered[selectedIdx];
        if (cmd) execute(cmd);
      } else if (e.key === "Escape") {
        e.preventDefault(); e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [activeCmd, filtered, selectedIdx, onClose]);

  const submit = () => {
    if (activeCmd && argInput.trim()) {
      runControl(activeCmd, argInput.trim());
      onClose();
    }
  };

  if (activeCmd) {
    const Icon = activeCmd.icon;
    return (
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-border bg-popover shadow-2xl overflow-hidden z-30"
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
          <Icon className="w-4 h-4 text-nx-brand" />
          <span className="text-xs font-medium">{activeCmd.label}</span>
          <span className="text-[10px] text-muted-foreground truncate">{activeCmd.desc}</span>
        </div>
        <div className="p-2">
          <input
            autoFocus
            value={argInput}
            onChange={(e) => setArgInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); submit(); }
              if (e.key === "Escape") onClose();
            }}
            placeholder={activeCmd.placeholder}
            className="w-full bg-transparent text-sm outline-none px-2 py-1.5"
          />
          <div className="flex justify-end gap-1 mt-1">
            <button onClick={onClose} className="px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors">取消</button>
            <button onClick={submit} disabled={!argInput.trim()} className="px-2.5 py-1 text-[10px] nx-brand-grad text-white rounded active:scale-95 transition-transform disabled:opacity-40">设置目标</button>
          </div>
        </div>
      </motion.div>
    );
  }

  if (filtered.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-border bg-popover shadow-2xl overflow-hidden z-30"
    >
      <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-b border-border">会话指令</div>
      {filtered.map((cmd, idx) => {
        const Icon = cmd.icon;
        const active = idx === selectedIdx;
        return (
          <button
            key={cmd.id}
            onMouseEnter={() => setSelectedIdx(idx)}
            onClick={() => execute(cmd)}
            className={cn("w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors", active ? "bg-nx-brand/10" : "hover:bg-accent")}
          >
            <div className={cn("w-7 h-7 rounded-md flex items-center justify-center transition-colors", active ? "nx-brand-grad" : "bg-muted")}>
              <Icon className={cn("w-3.5 h-3.5", active ? "text-white" : "text-muted-foreground")} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium">{cmd.label}</div>
              <div className="text-[10px] text-muted-foreground">{cmd.desc}</div>
            </div>
          </button>
        );
      })}
    </motion.div>
  );
}
