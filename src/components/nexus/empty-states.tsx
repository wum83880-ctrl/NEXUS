"use client";
import { motion } from "framer-motion";
import {
  Zap,
  Sparkles,
  Code2,
  FileSearch,
  GitBranch,
  Lightbulb,
  PenLine,
} from "lucide-react";
import { useNexus } from "@/hooks/nexus/use-nexus";
import { Particles } from "./particles";
import { cn } from "@/lib/utils";

const SUGGESTIONS: { icon: typeof Sparkles; title: string; prompt: string; tag: string }[] = [
  {
    icon: Code2,
    title: "做一个网页",
    prompt: "帮我做一个单文件网页：深色主题的个人作品集，含导航、项目卡片、联系方式，设计要克制精致。",
    tag: "开发",
  },
  {
    icon: FileSearch,
    title: "排查一个 Bug",
    prompt: "请帮我排查问题：\n\n现象：\n复现步骤：\n相关文件：",
    tag: "调试",
  },
  {
    icon: GitBranch,
    title: "代码审查",
    prompt: "请以资深工程师视角审查以下代码，按 阻塞性/重要/建议 三档给出意见：\n\n```\n\n```",
    tag: "质量",
  },
  {
    icon: Lightbulb,
    title: "打磨 UI 动效",
    prompt: "请帮我把这个页面的交互打磨到细腻精致的质感：克制配色、弹簧动效、按压回弹、hover 微反馈。文件路径：",
    tag: "设计",
  },
  {
    icon: PenLine,
    title: "补单元测试",
    prompt: "请为以下代码补齐正常/边界/异常三层测试并运行验证：",
    tag: "测试",
  },
  {
    icon: Sparkles,
    title: "技术调研",
    prompt: "请联网调研并交叉验证：",
    tag: "研究",
  },
];

export function EmptyChatState() {
  const send = useNexus((s) => s.send);
  const sessionId = useNexus((s) => s.activeSessionId);
  const turn = useNexus((s) => s.runTurn);

  const onPick = (prompt: string) => {
    if (!sessionId || !send) return;
    send({ type: "chat:run", sessionId, message: prompt, turn: turn + 1 });
  };

  return (
    <div className="relative h-full flex flex-col items-center justify-center px-6 py-10 overflow-hidden">
      {/* aurora 背景 + 粒子层 */}
      <div className="absolute inset-0 nx-aurora pointer-events-none" />
      <Particles />
      <div className="absolute inset-0 nx-grid-bg opacity-40 pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative z-10 flex flex-col items-center text-center mb-10"
      >
        <div className="w-16 h-16 rounded-2xl nx-brand-grad flex items-center justify-center nx-glow mb-5">
          <Zap className="w-8 h-8 text-primary-foreground" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          NEXUS
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          图驱动 AI Agent · 把对话变成可观测的推理与执行
        </p>
      </motion.div>

      <div className="relative z-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 w-full max-w-4xl">
        {SUGGESTIONS.map((s, idx) => (
          <motion.button
            key={s.title}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 26, delay: 0.04 * idx }}
            whileHover={{ y: -3, scale: 1.01 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => onPick(s.prompt)}
            className={cn(
              "group text-left rounded-xl border border-border bg-card/70 backdrop-blur-sm",
              "p-4 hover:border-nx-brand/50 hover:bg-card transition-colors"
            )}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="size-8 rounded-lg bg-accent flex items-center justify-center group-hover:nx-brand-grad transition-colors">
                <s.icon className="size-4 text-nx-brand group-hover:text-primary-foreground" />
              </div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground px-1.5 py-0.5 rounded bg-accent/60">
                {s.tag}
              </span>
            </div>
            <div className="text-sm font-medium text-foreground mb-1">{s.title}</div>
            <div className="text-xs text-muted-foreground line-clamp-2">{s.prompt}</div>
          </motion.button>
        ))}
      </div>

      <p className="relative z-10 mt-8 text-[11px] text-muted-foreground">
        提示：输入 <kbd className="px-1 py-0.5 rounded bg-accent text-foreground">⌘K</kbd> 打开命令面板
      </p>
    </div>
  );
}
