"use client";
// NEXUS MCP 面板 — Model Context Protocol 服务器接入说明与配置
import { useState } from "react";
import { motion } from "framer-motion";
import {
  Network, Server, Plus, Terminal, FileText, Database, Search, Loader2, Check,
  Plug, Boxes, ShieldCheck, ArrowRight, Cpu,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface BuiltinServer {
  id: string;
  name: string;
  icon: typeof FileText;
  command: string;
  args: string;
  description: string;
  tools: string[];
  color: string;
}

const BUILTIN_SERVERS: BuiltinServer[] = [
  {
    id: "filesystem",
    name: "filesystem",
    icon: FileText,
    command: "npx",
    args: "-y @modelcontextprotocol/server-filesystem /path/to/allowed/dir",
    description: "受限文件系统访问：在白名单目录内读写、搜索、监视文件。",
    tools: ["read_file", "write_file", "list_directory", "search_files", "get_file_info"],
    color: "blue",
  },
  {
    id: "fetch",
    name: "fetch",
    icon: Search,
    command: "npx",
    args: "-y @modelcontextprotocol/server-fetch",
    description: "抓取并解析 URL 内容，支持 HTML→Markdown、JSON 提取与递归链接。",
    tools: ["fetch", "fetch_text", "fetch_json"],
    color: "emerald",
  },
  {
    id: "sqlite",
    name: "sqlite",
    icon: Database,
    command: "npx",
    args: "-y @modelcontextprotocol/server-sqlite --db-path ./data.db",
    description: "在本地 SQLite 数据库上执行只读 / 受控查询，自动描述 schema。",
    tools: ["read_query", "write_query", "list_tables", "describe_table"],
    color: "amber",
  },
];

const COLOR_BG: Record<string, string> = {
  blue: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  emerald: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  amber: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  purple: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  rose: "bg-rose-500/15 text-rose-400 border-rose-500/30",
};

const CONCEPTS = [
  {
    icon: Plug,
    title: "统一协议",
    desc: "MCP 定义了 LLM 与外部工具、数据源之间的标准握手协议，让 Agent 像调用函数一样使用外部能力。",
  },
  {
    icon: Boxes,
    title: "工具即资源",
    desc: "每个 MCP 服务器对外暴露 tools / resources / prompts 三类能力，Agent 按需发现并调用。",
  },
  {
    icon: ShieldCheck,
    title: "权限与隔离",
    desc: "服务器运行在独立进程，通过 stdio 或 SSE 通信；敏感操作须经用户审批，避免越权。",
  },
];

export function McpPanel() {
  const [customServers, setCustomServers] = useState<Array<{ id: string; name: string; command: string; args: string }>>([]);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [adding, setAdding] = useState(false);
  const { toast } = useToast();

  const addServer = () => {
    if (!name.trim() || !command.trim()) {
      toast({ title: "请填写名称和命令", variant: "destructive" });
      return;
    }
    setAdding(true);
    setTimeout(() => {
      setCustomServers((prev) => [
        ...prev,
        { id: `srv-${Date.now()}`, name: name.trim(), command: command.trim(), args: args.trim() },
      ]);
      setName(""); setCommand(""); setArgs("");
      setAdding(false);
      toast({ title: "已添加（演示）", description: "MCP 服务器配置仅保存在本会话，未真正启动进程" });
    }, 300);
  };

  return (
    <div className="flex flex-col h-full">
      <header className="shrink-0 border-b border-border bg-card/40 backdrop-blur-sm px-4 sm:px-6 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="size-8 rounded-lg nx-brand-grad flex items-center justify-center shrink-0">
            <Network className="size-4 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">MCP 服务器</h2>
            <p className="text-[11px] text-muted-foreground truncate">
              Model Context Protocol · 让 Agent 接入外部工具与数据源
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto nx-scroll">
        <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
          {/* 概念说明 */}
          <section className="nx-aurora rounded-2xl border border-border p-5 sm:p-6">
            <div className="flex items-center gap-2 mb-4">
              <div className="size-9 rounded-lg nx-brand-grad flex items-center justify-center">
                <Cpu className="size-4 text-primary-foreground" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-foreground">什么是 MCP？</h3>
                <p className="text-[11px] text-muted-foreground">Model Context Protocol — 标准化的 Agent ↔ 工具协议</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed mb-4">
              MCP 是一种开放协议，用于将大语言模型与外部工具、数据源连接起来。它让 Agent
              能够以一致的方式发现并调用文件系统、数据库、API、搜索引擎等能力，
              而无需为每个工具编写定制集成。你可以把 MCP 想象成 Agent 世界的「USB 接口」。
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {CONCEPTS.map((c, i) => (
                <motion.div
                  key={c.title}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.08, duration: 0.3 }}
                  className="rounded-xl border border-border bg-card/70 backdrop-blur-sm p-3"
                >
                  <c.icon className="size-4 text-nx-brand mb-2" />
                  <div className="text-xs font-medium text-foreground mb-1">{c.title}</div>
                  <div className="text-[11px] text-muted-foreground leading-relaxed">{c.desc}</div>
                </motion.div>
              ))}
            </div>
          </section>

          {/* 内置服务器 */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Server className="size-4 text-nx-brand" />
                <h3 className="text-sm font-semibold text-foreground">内置服务器</h3>
                <Badge variant="secondary" className="text-[10px]">{BUILTIN_SERVERS.length}</Badge>
              </div>
              <span className="text-[11px] text-muted-foreground">参考实现 · 点击查看工具列表</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {BUILTIN_SERVERS.map((s, idx) => (
                <motion.div
                  key={s.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.06, duration: 0.3 }}
                  whileHover={{ y: -2 }}
                  className="rounded-xl border border-border bg-card/70 backdrop-blur-sm p-4 hover:border-nx-brand/40 transition-colors"
                >
                  <div className="flex items-start gap-3 mb-3">
                    <div className={cn("size-9 rounded-lg flex items-center justify-center border", COLOR_BG[s.color])}>
                      <s.icon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-medium text-foreground">{s.name}</h4>
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-emerald-400 border-emerald-500/30 bg-emerald-500/10">内置</Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{s.description}</p>
                    </div>
                  </div>
                  <div className="rounded-lg bg-muted/40 border border-border p-2 mb-2">
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-0.5">
                      <Terminal className="size-2.5" /> 启动命令
                    </div>
                    <code className="text-[11px] text-nx-cyan font-mono break-all">{s.command} {s.args}</code>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">暴露工具</div>
                    <div className="flex flex-wrap gap-1">
                      {s.tools.map((t) => (
                        <Badge key={t} variant="secondary" className="text-[9px] px-1.5 py-0 font-mono">{t}</Badge>
                      ))}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </section>

          {/* 添加自定义服务器 */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Plus className="size-4 text-nx-brand" />
              <h3 className="text-sm font-semibold text-foreground">添加自定义服务器</h3>
            </div>
            <div className="rounded-xl border border-border bg-card/70 backdrop-blur-sm p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Field label="名称">
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-server" className="text-sm h-9" />
                </Field>
                <Field label="命令">
                  <Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx / node / python" className="text-sm h-9" />
                </Field>
                <Field label="参数">
                  <Input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="-y @org/server-name" className="text-sm h-9" />
                </Field>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-muted-foreground">
                  配置将作为 <code className="text-nx-cyan font-mono">stdio</code> 服务器启动，Agent 通过 MCP 协议与之握手。
                </p>
                <Button size="sm" className="nx-brand-grad border-0 text-primary-foreground" onClick={addServer} disabled={adding}>
                  {adding ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                  添加
                </Button>
              </div>
            </div>

            {customServers.length > 0 && (
              <div className="mt-3 space-y-2">
                {customServers.map((s) => (
                  <motion.div
                    key={s.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="rounded-lg border border-border bg-card/50 p-3 flex items-center gap-3"
                  >
                    <div className="size-8 rounded-md bg-accent flex items-center justify-center shrink-0">
                      <Server className="size-3.5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-foreground">{s.name}</div>
                      <code className="text-[10px] text-muted-foreground font-mono break-all">{s.command} {s.args}</code>
                    </div>
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-amber-400 border-amber-500/30 bg-amber-500/10">
                      <Check className="size-2.5" /> 已配置
                    </Badge>
                  </motion.div>
                ))}
              </div>
            )}
          </section>

          {/* 工作流程 */}
          <section className="rounded-xl border border-border bg-muted/20 p-4">
            <div className="flex items-center gap-2 mb-3">
              <ArrowRight className="size-4 text-nx-brand" />
              <h3 className="text-sm font-semibold text-foreground">MCP 工作流程</h3>
            </div>
            <ol className="space-y-2 text-xs text-muted-foreground">
              <li className="flex gap-2">
                <span className="size-5 rounded-full bg-accent text-foreground text-[10px] font-medium flex items-center justify-center shrink-0">1</span>
                <span><b className="text-foreground">发现</b>：Agent 启动时与每个 MCP 服务器握手，获取其声明的 tools / resources。</span>
              </li>
              <li className="flex gap-2">
                <span className="size-5 rounded-full bg-accent text-foreground text-[10px] font-medium flex items-center justify-center shrink-0">2</span>
                <span><b className="text-foreground">选择</b>：根据用户任务，Agent 决定调用哪个工具，构造参数。</span>
              </li>
              <li className="flex gap-2">
                <span className="size-5 rounded-full bg-accent text-foreground text-[10px] font-medium flex items-center justify-center shrink-0">3</span>
                <span><b className="text-foreground">调用</b>：通过 MCP 协议向服务器发起请求，等待结构化结果返回。</span>
              </li>
              <li className="flex gap-2">
                <span className="size-5 rounded-full bg-accent text-foreground text-[10px] font-medium flex items-center justify-center shrink-0">4</span>
                <span><b className="text-foreground">整合</b>：Agent 将结果纳入推理，决定是否继续调用或回应用户。</span>
              </li>
            </ol>
          </section>
        </div>
      </div>
    </div>
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
