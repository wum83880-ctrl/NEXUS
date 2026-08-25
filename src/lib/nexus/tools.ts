// NEXUS 内置工具集：文件/代码/网络/记忆/目标管理等
// 真实可用：read / write / edit / str_replace_editor / glob / grep / read_image / pwsh / web_search
// 宿主依赖工具：create_goal / get_goal / update_goal / todo_write / workflow / ralph /
//   subagent / subagent_fork / send_message / list_agents / interrupt_agent /
//   job_list / job_output / job_kill / ask_user_question / skill
// 这些在当前独立 NEXUS 进程中无法完整复刻 DSH 宿主能力，提供明确“不可用/降级”说明。
import { spawn, spawnSync } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import type { ToolDefinition, ToolSchema, ToolExecutionContext } from "./types";
import {
  assessToolCall,
  blockedUrlReason,
  guardedFetch,
  isSystemDestructiveCommand,
  resolveSandboxedPath,
  workspaceRoot,
  type SafetyMode,
  type SandboxContext,
} from "./sandbox";
import { getSettings, resolveProvider, activeModelOf } from "./settings";
import { streamChat as llmStreamChat, type ChatMessage } from "./llm-client";
import { parseToolCallsFromText } from "./tool-parser";

export { blockedUrlReason, assessToolCall };

// Windows 兼容常量
const IS_WIN = process.platform === "win32";

// 需要跳过的扫描目录
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", ".nexus", "out", "build", ".cache", ".turbo", ".playwright-mcp"]);

// 文件/目录工具统一沙箱路径解析
function sandboxPath(raw: string, mode: SafetyMode, operation: "read" | "write" | "list", approved?: boolean): { path?: string; error?: string; requiresApproval?: boolean; blocked?: boolean } {
  const allowHighRisk = mode === "unrestricted" || approved === true;
  return resolveSandboxedPath(raw, mode, operation, { allowHighRisk });
}

// 简单 glob → RegExp（支持 ** / * / ?）
function globToRegExp(glob: string): RegExp {
  const normalized = glob.replace(/\\/g, "/");
  let re = "";
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === "*") {
      if (normalized[i + 1] === "*") {
        re += ".*";
        i++;
        // 吞掉后面的斜杠，让 ** 匹配跨目录
        if (normalized[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (ch === "?") {
      re += "[^/]";
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

async function walkFiles(dir: string, relBase: string, depth: number, maxDepth: number, out: string[]): Promise<void> {
  if (depth > maxDepth || out.length >= 1000) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    const rel = relBase ? `${relBase}/${e.name}` : e.name;
    if (e.isDirectory()) {
      await walkFiles(full, rel, depth + 1, maxDepth, out);
    } else if (e.isFile()) {
      out.push(rel);
    }
  }
}

function unavailable(name: string, detail: string): string {
  return `[${name}] 当前 NEXUS 运行环境未接入 DSH 宿主，该工具不可用。${detail}`;
}

// ── 文件与代码工具 ──────────────────────────────────────────────

const read: ToolDefinition = {
  name: "read",
  description: "读取文件（带行号）或列出目录。",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      offset: { type: "integer", default: 1 },
      limit: { type: "integer", default: 2000 },
    },
    required: ["path"],
  },
  async handler(args, ctx) {
    const p = String(args.path ?? "").trim();
    if (!p) return "[read] 路径为空";
    const mode = ctx?.mode ?? "default";
    const resolved = sandboxPath(p, mode, "read", ctx?.approved);
    if (resolved.blocked) return `[read] ${resolved.error}`;
    if (resolved.requiresApproval) return "[read] 该路径需要审批";
    const target = resolved.path!;
    try {
      const stat = await fs.stat(target);
      if (stat.isDirectory()) {
        const entries = await fs.readdir(target);
        return `[目录] ${entries.length} 个条目:\n${entries.slice(0, 100).join("\n")}`;
      }
      const content = await fs.readFile(target, "utf8");
      const lines = content.split("\n");
      const offset = Math.max(1, Number(args.offset) || 1);
      const limit = Math.max(1, Number(args.limit) || 2000);
      const sel = lines.slice(offset - 1, offset - 1 + limit);
      return `[${target} 第${offset}-${offset + sel.length - 1}行/共${lines.length}行]\n${sel.map((l, i) => `${offset + i}: ${l}`).join("\n")}`;
    } catch (err: any) {
      return `[read 错误] ${err?.code === "ENOENT" ? "文件不存在" : err?.message}`;
    }
  },
};

const write: ToolDefinition = {
  name: "write",
  description: "写入文件（覆盖）。",
  parameters: {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"],
  },
  requiresApproval: true,
  async handler(args, ctx) {
    const p = String(args.path ?? "").trim();
    if (!p) return "[write] 路径为空";
    const mode = ctx?.mode ?? "default";
    const resolved = sandboxPath(p, mode, "write", ctx?.approved);
    if (resolved.blocked) return `[write] ${resolved.error}`;
    if (resolved.requiresApproval) return "[write] 该路径需要审批";
    const target = resolved.path!;
    try {
      await fs.mkdir(path.dirname(target) || ".", { recursive: true });
      await fs.writeFile(target, String(args.content ?? ""), "utf8");
      return `[write] 已写入 ${String(args.content ?? "").length} 字符到 ${target}`;
    } catch (err: any) {
      return `[write 错误] ${err?.message}`;
    }
  },
};

const edit: ToolDefinition = {
  name: "edit",
  description: "精准替换文件中的唯一一段文本（类似 str_replace）。",
  parameters: {
    type: "object",
    properties: {
      file_path: { type: "string" },
      old_string: { type: "string" },
      new_string: { type: "string" },
      replace_all: { type: "boolean", default: false },
    },
    required: ["file_path", "old_string", "new_string"],
  },
  requiresApproval: true,
  async handler(args, ctx) {
    const filePath = String(args.file_path ?? "").trim();
    const oldStr = String(args.old_string ?? "");
    const newStr = String(args.new_string ?? "");
    if (!filePath || !oldStr) return "[edit] file_path 与 old_string 不能为空";
    const mode = ctx?.mode ?? "default";
    const resolved = sandboxPath(filePath, mode, "write", ctx?.approved);
    if (resolved.blocked) return `[edit] ${resolved.error}`;
    if (resolved.requiresApproval) return "[edit] 该路径需要审批";
    const target = resolved.path!;
    try {
      const content = await fs.readFile(target, "utf8");
      if (args.replace_all) {
        if (!content.includes(oldStr)) return "[edit] 未找到 old_string";
        const next = content.split(oldStr).join(newStr);
        await fs.writeFile(target, next, "utf8");
        return `[edit] 已全部替换 ${content.split(oldStr).length - 1} 处`;
      }
      const count = content.split(oldStr).length - 1;
      if (count === 0) return "[edit] 未找到 old_string";
      if (count > 1) return `[edit] old_string 出现 ${count} 次，请提供更多上下文或设置 replace_all=true`;
      await fs.writeFile(target, content.replace(oldStr, newStr), "utf8");
      return "[edit] 替换成功";
    } catch (err: any) {
      return `[edit 错误] ${err?.message}`;
    }
  },
};

// 统一 diff 应用工具：支持多文件、多 hunk、上下文校验、dry-run。
export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  lines: { type: "ctx" | "del" | "add"; text: string }[];
}

export function parseUnifiedDiff(diff: string): { file: string; hunks: DiffHunk[] }[] {
  const files: { file: string; hunks: DiffHunk[] }[] = [];
  const lines = diff.split("\n");
  let cur: { file: string; hunks: DiffHunk[] } | null = null;
  let hunk: DiffHunk | null = null;

  const pushHunk = () => {
    if (cur && hunk) { cur.hunks.push(hunk); hunk = null; }
  };

  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("+++ ")) {
      pushHunk();
      const file = line.slice(4).trim().replace(/^[ab]\//, "").replace(/\t.*$/, "");
      if (cur && cur.file === file) { /* 继续 */ }
      else { cur = { file, hunks: [] }; files.push(cur); }
      continue;
    }
    if (line.startsWith("--- ") || line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("new file") || line.startsWith("deleted file")) continue;
    const h = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (h) {
      pushHunk();
      hunk = {
        oldStart: Number(h[1]),
        oldCount: h[2] ? Number(h[2]) : 1,
        newStart: Number(h[3]),
        lines: [],
      };
      continue;
    }
    if (!hunk) continue;
    if (line.startsWith("+")) hunk.lines.push({ type: "add", text: line.slice(1) });
    else if (line.startsWith("-")) hunk.lines.push({ type: "del", text: line.slice(1) });
    else if (line.startsWith(" ")) hunk.lines.push({ type: "ctx", text: line.slice(1) });
    else if (line === "\\ No newline at end of file") continue;
    // 其他（如属性变更）忽略
  }
  pushHunk();
  return files;
}

export function applyHunks(content: string, hunks: DiffHunk[]): { ok: boolean; result?: string; error?: string } {
  // CRLF 兼容：匹配前去掉行尾 \r，写回时保留原换行风格（Windows 项目 git diff 是 LF 头）
  const crlf = content.includes("\r\n");
  let lines = content.split("\n").map((l) => l.replace(/\r$/, ""));
  // 从后往前应用，避免行号漂移
  const sorted = [...hunks].sort((a, b) => b.oldStart - a.oldStart);
  for (const h of sorted) {
    const pos = h.oldStart - 1;
    // 上下文校验（允许整体偏移 ±10 行容错）
    let offset = 0;
    let matched = false;
    for (let o = 0; o <= 10; o++) {
      const candidate = pos - o;
      if (candidate >= 0 && checkHunkAt(lines, h, candidate)) { offset = -o; matched = true; break; }
      if (checkHunkAt(lines, h, pos + o)) { offset = o; matched = true; break; }
    }
    if (!matched) {
      const ctx = h.lines.find((l) => l.type !== "add")?.text || "";
      return { ok: false, error: `hunk @${h.oldStart} 上下文不匹配，预期行: "${ctx.slice(0, 60)}"` };
    }
    const start = pos + offset;
    // 删除区：start 起跳过 del/ctx 行数
    const delCount = h.lines.filter((l) => l.type === "del" || l.type === "ctx").length;
    const newBlock = h.lines.filter((l) => l.type === "add" || l.type === "ctx").map((l) => l.text);
    lines = [...lines.slice(0, start), ...newBlock, ...lines.slice(start + delCount)];
  }
  return { ok: true, result: lines.join(crlf ? "\r\n" : "\n") };
}

function checkHunkAt(lines: string[], h: DiffHunk, pos: number): boolean {
  let idx = pos;
  for (const l of h.lines) {
    if (l.type === "add") continue;
    if (lines[idx] !== l.text) return false;
    idx++;
  }
  return true;
}

const patch: ToolDefinition = {
  name: "patch",
  description: "应用 unified diff（git diff 格式）到文件：支持多文件、多 hunk、上下文校验、dryRun 预览。适合批量修改时一次性给出多个文件的新旧对比。",
  parameters: {
    type: "object",
    properties: {
      diff: { type: "string", description: "unified diff 文本，如：\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,3 +1,3 @@\n-old\n+new\n context" },
      dryRun: { type: "boolean", default: false, description: "true = 只报告将应用哪些 hunk 与校验结果，不写文件" },
    },
    required: ["diff"],
  },
  requiresApproval: true,
  async handler(args, ctx) {
    const diff = String(args.diff ?? "");
    if (!diff.trim()) return "[patch] diff 不能为空";
    const dryRun = !!args.dryRun;
    const mode = ctx?.mode ?? "default";
    const allowHighRisk = mode === "unrestricted" || ctx?.approved === true;

    const files = parseUnifiedDiff(diff);
    if (files.length === 0) return "[patch] 无法解析 diff（需要 --- / +++ 与 @@ 头）";

    const out: string[] = [];
    let appliedFiles = 0;
    let appliedHunks = 0;
    for (const f of files) {
      if (!f.file) continue;
      const resolved = sandboxPath(f.file, mode, "write", allowHighRisk);
      if (resolved.blocked) { out.push(`[patch] ${f.file}: ${resolved.error}`); continue; }
      if (resolved.requiresApproval) { out.push(`[patch] ${f.file}: 需要审批`); continue; }
      const target = resolved.path!;
      let content = "";
      try { content = await fs.readFile(target, "utf8"); }
      catch (err: any) { out.push(`[patch] ${f.file}: 读取失败 ${err?.code === "ENOENT" ? "（文件不存在）" : err?.message}`); continue; }
      const res = applyHunks(content, f.hunks);
      if (!res.ok) { out.push(`[patch] ${f.file}: ✗ ${res.error}`); continue; }
      appliedHunks += f.hunks.length;
      if (dryRun) {
        out.push(`[patch] ${f.file}: ✓ 将应用 ${f.hunks.length} 个 hunk（dry-run）`);
      } else {
        await fs.writeFile(target, res.result!, "utf8");
        out.push(`[patch] ${f.file}: ✓ 已应用 ${f.hunks.length} 个 hunk`);
      }
      appliedFiles++;
    }
    const summary = `[patch]${dryRun ? "（dry-run）" : ""} ${appliedFiles} 个文件 / ${appliedHunks} 个 hunk`;
    return [summary, ...out].join("\n");
  },
};

const str_replace_editor: ToolDefinition = {
  name: "str_replace_editor",
  description: "通用编辑工具：view 查看、create 新建、insert 插入、str_replace 精准替换。",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", enum: ["view", "create", "insert", "str_replace"] },
      path: { type: "string" },
      file_text: { type: "string" },
      insert_line: { type: "integer" },
      new_str: { type: "string" },
      old_str: { type: "string" },
      view_range: { type: "array", items: { type: "integer" } },
    },
    required: ["command", "path"],
  },
  requiresApproval: true,
  async handler(args, ctx) {
    const command = String(args.command ?? "");
    const p = String(args.path ?? "").trim();
    if (!p) return "[str_replace_editor] path 不能为空";
    const mode = ctx?.mode ?? "default";
    const op = command === "view" ? "read" : "write";
    const resolved = sandboxPath(p, mode, op, ctx?.approved);
    if (resolved.blocked) return `[str_replace_editor] ${resolved.error}`;
    if (resolved.requiresApproval) return "[str_replace_editor] 该路径需要审批";
    const target = resolved.path!;
    try {
      if (command === "view") {
        const content = await fs.readFile(target, "utf8");
        const lines = content.split("\n");
        const range = Array.isArray(args.view_range) && args.view_range.length === 2
          ? [Math.max(1, Number(args.view_range[0]) || 1), Math.min(lines.length, Number(args.view_range[1]) || lines.length)]
          : [1, lines.length];
        const sel = lines.slice(range[0] - 1, range[1]);
        return `[view ${target} 第${range[0]}-${range[0] + sel.length - 1}行/共${lines.length}行]\n${sel.map((l, i) => `${range[0] + i}: ${l}`).join("\n")}`;
      }
      if (command === "create") {
        try {
          await fs.access(target);
          return "[str_replace_editor] 文件已存在，不能 create";
        } catch {
          await fs.mkdir(path.dirname(target) || ".", { recursive: true });
          await fs.writeFile(target, String(args.file_text ?? ""), "utf8");
          return "[str_replace_editor] 文件已创建";
        }
      }
      if (command === "insert") {
        const line = Math.max(0, Number(args.insert_line) || 0);
        const content = await fs.readFile(target, "utf8");
        const lines = content.split("\n");
        lines.splice(line, 0, String(args.new_str ?? ""));
        await fs.writeFile(target, lines.join("\n"), "utf8");
        return `[str_replace_editor] 已在第 ${line} 行后插入`;
      }
      if (command === "str_replace") {
        const oldStr = String(args.old_str ?? "");
        const newStr = String(args.new_str ?? "");
        if (!oldStr) return "[str_replace_editor] old_str 不能为空";
        const content = await fs.readFile(target, "utf8");
        const count = content.split(oldStr).length - 1;
        if (count === 0) return "[str_replace_editor] 未找到 old_str";
        if (count > 1) return "[str_replace_editor] old_str 不唯一，请提供更多上下文";
        await fs.writeFile(target, content.replace(oldStr, newStr), "utf8");
        return "[str_replace_editor] 替换成功";
      }
      return "[str_replace_editor] 未知 command";
    } catch (err: any) {
      return `[str_replace_editor 错误] ${err?.message}`;
    }
  },
};

const glob: ToolDefinition = {
  name: "glob",
  description: "按 glob 模式递归查找文件（自动跳过 node_modules/.next/.git 等）。",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", default: "**/*" },
      path: { type: "string", default: "." },
      maxDepth: { type: "integer", default: 8 },
    },
    required: ["pattern"],
  },
  async handler(args, ctx) {
    const pattern = String(args.pattern ?? "**/*").trim() || "**/*";
    const rootArg = String(args.path ?? ".").trim() || ".";
    const mode = ctx?.mode ?? "default";
    const resolved = sandboxPath(rootArg, mode, "list", ctx?.approved);
    if (resolved.blocked) return `[glob] ${resolved.error}`;
    if (resolved.requiresApproval) return "[glob] 该路径需要审批";
    const root = resolved.path!;
    const maxDepth = Math.min(Math.max(Number(args.maxDepth) || 8, 1), 12);
    const re = globToRegExp(pattern);
    const files: string[] = [];
    await walkFiles(root, "", 0, maxDepth, files);
    const matched = files.filter((f) => re.test(f.replace(/\\/g, "/"))).slice(0, 200);
    return matched.length ? matched.join("\n") : "[glob] 无匹配文件";
  },
};

const grep: ToolDefinition = {
  name: "grep",
  description: "正则搜索文件内容，返回匹配文件与行号（context>0 时附带前后文，便于定位函数体/调用点）。",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string" },
      path: { type: "string", default: "." },
      include: { type: "string", default: "" },
      maxDepth: { type: "integer", default: 8 },
      context: { type: "integer", default: 0, description: "匹配行前后各取几行（默认 0，仅匹配行）" },
    },
    required: ["pattern"],
  },
  async handler(args, ctx) {
    const pattern = String(args.pattern ?? "").trim();
    if (!pattern) return "[grep] pattern 不能为空";
    const rootArg = String(args.path ?? ".").trim() || ".";
    const mode = ctx?.mode ?? "default";
    const resolved = sandboxPath(rootArg, mode, "list", ctx?.approved);
    if (resolved.blocked) return `[grep] ${resolved.error}`;
    if (resolved.requiresApproval) return "[grep] 该路径需要审批";
    const root = resolved.path!;
    const maxDepth = Math.min(Math.max(Number(args.maxDepth) || 8, 1), 12);
    const include = String(args.include ?? "");
    let re: RegExp;
    try {
      re = new RegExp(pattern);
    } catch (err: any) {
      return `[grep] 正则错误: ${err?.message}`;
    }
    const files: string[] = [];
    await walkFiles(root, "", 0, maxDepth, files);
    const context = Math.min(Math.max(Number(args.context) || 0, 0), 8);
    const out: string[] = [];
    for (const rel of files) {
      if (include && !rel.endsWith(include)) continue;
      try {
        const full = path.join(root, rel);
        const content = await fs.readFile(full, "utf8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) {
            if (context > 0) {
              const from = Math.max(0, i - context);
              const to = Math.min(lines.length, i + context + 1);
              const block = lines.slice(from, to).map((l, j) => `${from + j + 1}: ${l.slice(0, 200)}`).join("\n");
              out.push(`${rel} (${i + 1}):\n${block}`);
            } else {
              out.push(`${rel}:${i + 1}: ${lines[i].slice(0, 200)}`);
            }
            if (out.length >= 200) break;
          }
        }
      } catch {}
      if (out.length >= 200) break;
    }
    return out.length ? out.join("\n") : "[grep] 无匹配";
  },
};

const read_image: ToolDefinition = {
  name: "read_image",
  description: "读取本地图片文件并返回元数据；当前文本协议无法把图片直接送入模型。",
  parameters: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
  async handler(args, ctx) {
    const p = String(args.path ?? "").trim();
    if (!p) return "[read_image] 路径为空";
    const mode = ctx?.mode ?? "default";
    const resolved = sandboxPath(p, mode, "read", ctx?.approved);
    if (resolved.blocked) return `[read_image] ${resolved.error}`;
    if (resolved.requiresApproval) return "[read_image] 该路径需要审批";
    const target = resolved.path!;
    try {
      const stat = await fs.stat(target);
      return `[read_image] ${target}\n大小: ${stat.size} 字节\n说明: 当前 NEXUS 文本协议不支持直接查看图片，如需分析请使用支持视觉的模型或由用户查看。`;
    } catch (err: any) {
      return `[read_image 错误] ${err?.message}`;
    }
  },
};

// ── Shell 工具 ─────────────────────────────────────────────────

const pwsh: ToolDefinition = {
  name: "pwsh",
  description: "执行 PowerShell 命令（支持超时、工作目录；高风险命令默认需审批，系统破坏性命令始终拦截）。",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string" },
      cwd: { type: "string" },
      timeout: { type: "number", default: 30 },
    },
    required: ["command"],
  },
  requiresApproval: true,
  async handler(args, ctx) {
    const command = String(args.command ?? "").trim();
    if (!command) return "[pwsh] 命令为空";
    const guard = isSystemDestructiveCommand(command);
    if (guard.blocked) return `[pwsh] 系统保护：${guard.reason}`;
    const mode = ctx?.mode ?? "default";
    const allowHighRisk = mode === "unrestricted" || ctx?.approved === true;
    let cwd = workspaceRoot();
    if (args.cwd) {
      const resolved = sandboxPath(String(args.cwd), mode, "write", allowHighRisk);
      if (resolved.blocked) return `[pwsh] ${resolved.error}`;
      if (resolved.requiresApproval) return "[pwsh] 该工作目录需要审批";
      cwd = resolved.path!;
    }
    const timeout = Math.min(Math.max(Number(args.timeout) || 30, 1), 120) * 1000;
    // 跨平台：Windows 用 pwsh，其余平台用 bash
    const isWin = process.platform === "win32";
    const shellCmd = isWin ? "pwsh" : "bash";
    const shellArgs = isWin ? ["-NoProfile", "-NonInteractive", "-Command", command] : ["-c", command];
    return new Promise((resolvePromise) => {
      const child = spawn(shellCmd, shellArgs, {
        cwd,
        windowsHide: true,
        shell: false,
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolvePromise(`[pwsh] 超时\n${stdout || ""}${stderr ? `\n[stderr]\n${stderr}` : ""}`);
      }, timeout);
      child.stdout.on("data", (d) => {
        stdout += String(d);
        if (stdout.length > 2_000_000) stdout = stdout.slice(0, 2_000_000);
      });
      child.stderr.on("data", (d) => {
        stderr += String(d);
        if (stderr.length > 1_000_000) stderr = stderr.slice(0, 1_000_000);
      });
      child.on("error", (err: any) => {
        clearTimeout(timer);
        resolvePromise(`[pwsh 错误] ${err?.message || String(err)}`);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        const out = (stdout || "") + (stderr ? `\n[stderr]\n${stderr}` : "");
        resolvePromise(`退出码: ${code ?? 1}\n${out.slice(0, 6000) || "(无输出)"}`);
      });
    });
  },
};

// ── 信息工具 ───────────────────────────────────────────────────

const webSearch: ToolDefinition = {
  name: "web_search",
  description: "搜索公开网络获取实时信息，返回标题、URL、摘要。",
  parameters: {
    type: "object",
    properties: { query: { type: "string" }, num: { type: "integer", default: 5 } },
    required: ["query"],
  },
  async handler(args) {
    const q = String(args.query ?? "").trim();
    if (!q) return "[web_search] 参数错误：query 不能为空";
    const num = Math.min(Math.max(Number(args.num) || 5, 1), 10);
    try {
      const url = `https://cn.bing.com/search?q=${encodeURIComponent(q)}&count=${Math.max(num * 2, 10)}`;
      const resp = await guardedFetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
          "Accept-Language": "zh-CN,zh;q=0.9",
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) return `[web_search] HTTP ${resp.status}`;
      const html = await resp.text();
      const results: { url: string; title: string; snippet: string }[] = [];
      const blockRe = /<li class="b_algo"[^>]*>([\s\S]*?)<\/li>/g;
      let m: RegExpExecArray | null;
      while ((m = blockRe.exec(html)) && results.length < num * 2) {
        const blk = m[1];
        const h2 = blk.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
        const href = h2 ? (h2[1].match(/href="([^"]+)"/)?.[1]) : (blk.match(/href="([^"]+)"/)?.[1]);
        const title = (h2 ? h2[1] : "").replace(/<[^>]+>/g, "").replace(/&[^;]+;/g, " ").trim();
        const snippet = (blk.match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1] || "").replace(/<[^>]+>/g, "").replace(/&[^;]+;/g, " ").replace(/\s+/g, " ").trim();
        if (href && href.startsWith("http")) results.push({ url: href, title: title || "(无标题)", snippet });
      }
      if (results.length === 0) return `[web_search] 未找到 "${q}" 的结果`;
      return `[web_search] "${q}" 的结果\n\n${results.slice(0, num).map((x, i) => `${i + 1}. ${x.title}\n   URL: ${x.url}\n   ${x.snippet.slice(0, 160)}`).join("\n\n")}`;
    } catch (err: any) {
      return `[web_search 错误] ${err?.message || String(err)}`;
    }
  },
};

// ── 记忆 / 计算 / 时间 / HTTP 工具 ──

const memory_save: ToolDefinition = {
  name: "memory_save",
  description: "保存一条长期记忆（命名空间 KV，跨会话保留）；pinned=true 置顶并优先被召回。",
  parameters: { type: "object", properties: { key: { type: "string" }, value: { type: "string" }, namespace: { type: "string", default: "default" }, pinned: { type: "boolean", default: false } }, required: ["key", "value"] },
  async handler(args) {
    const key = String(args.key ?? "").trim();
    if (!key) return "[memory_save] key 不能为空";
    const ns = String(args.namespace ?? "default").trim() || "default";
    try {
      const { saveMemory } = await import("@/lib/nexus/memory");
      const row = await saveMemory(ns, key, String(args.value ?? ""), !!args.pinned);
      return `[memory_save] 已保存 ${ns}:${key}${row.pinned ? "（置顶）" : ""}`;
    } catch (err: any) {
      return `[memory_save 错误] ${err?.message || String(err)}`;
    }
  },
};

const memory_recall: ToolDefinition = {
  name: "memory_recall",
  description: "按命名空间（可选 key）回忆长期记忆，置顶优先，最多 50 条。",
  parameters: { type: "object", properties: { namespace: { type: "string", default: "default" }, key: { type: "string" } }, required: [] },
  async handler(args) {
    const ns = String(args.namespace ?? "default").trim() || "default";
    const key = typeof args.key === "string" && args.key.trim() ? args.key.trim() : undefined;
    try {
      const { recallMemory } = await import("@/lib/nexus/memory");
      const rows = await recallMemory(ns, key);
      if (!rows.length) return `[memory_recall] 命名空间「${ns}」没有匹配的记忆`;
      return `[memory_recall] ${rows.length} 条记忆：\n` + rows.map((m, i) => `${i + 1}. [${m.pinned ? "置顶" : "普通"}] ${m.key}: ${String(m.value).slice(0, 300)}`).join("\n");
    } catch (err: any) {
      return `[memory_recall 错误] ${err?.message || String(err)}`;
    }
  },
};

const calculator: ToolDefinition = {
  name: "calculator",
  description: "安全表达式求值：支持 + - * / % ^幂 括号、sqrt/sin/cos/tan/log/ln/abs、常量 pi/e/Math.PI。",
  parameters: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] },
  async handler(args) {
    const expr = String(args.expression ?? "").trim();
    if (!expr) return "[calculator] expression 不能为空";
    try {
      return `[calculator] ${expr} = ${safeEvaluate(expr)}`;
    } catch (err: any) {
      return `[calculator 错误] ${err?.message || String(err)}`;
    }
  },
};

const current_time: ToolDefinition = {
  name: "current_time",
  description: "获取当前日期时间（ISO 与本地时区）。",
  parameters: { type: "object", properties: {} },
  async handler() {
    const now = new Date();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return `[current_time] ISO: ${now.toISOString()} / 本地: ${now.toLocaleString("zh-CN", { hour12: false })} (${tz})`;
  },
};

const echo: ToolDefinition = {
  name: "echo",
  description: "原样返回输入文本（调试/测试用）。",
  parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  async handler(args) { return String(args.text ?? ""); },
};

const http_request: ToolDefinition = {
  name: "http_request",
  description: "发起 HTTP 请求（默认 GET；内置 SSRF 防护自动拦截本地/内网/云元数据地址；POST/PUT/DELETE 等写方法需审批）。",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string" },
      method: { type: "string", enum: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"], default: "GET" },
      headers: { type: "object", description: "可选请求头对象" },
      body: { type: "string", description: "请求体（字符串；对象会被 JSON 序列化）" },
      timeout: { type: "integer", default: 15, description: "超时秒数 1-60" },
    },
    required: ["url"],
  },
  async handler(args) {
    const url = String(args.url ?? "").trim();
    if (!url) return "[http_request] url 不能为空";
    const method = String(args.method ?? "GET").toUpperCase();
    const timeout = Math.min(Math.max(Number(args.timeout) || 15, 1), 60) * 1000;
    const headers: Record<string, string> = {
      "User-Agent": "NEXUS-Agent/1.0",
      ...(args.headers && typeof args.headers === "object" ? (args.headers as Record<string, unknown>) : {}),
    } as Record<string, string>;
    let body: string | undefined;
    if (args.body !== undefined) {
      body = typeof args.body === "string" ? args.body : JSON.stringify(args.body);
      if (body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    }
    try {
      const resp = await guardedFetch(url, { method, headers, body, signal: AbortSignal.timeout(timeout) });
      const text = await resp.text().catch(() => "");
      const maxLen = 12000;
      const out = text.length > maxLen ? text.slice(0, maxLen) + `\n…（输出截断，共 ${text.length} 字符）` : text;
      return `[http ${resp.status}] ${method} ${url}\n\n${out || "(空响应体)"}`;
    } catch (err: any) {
      return `[http_request 错误] ${err?.message || String(err)}`;
    }
  },
};

// ── 编程辅助工具（面向开发工作流） ─────────────────────────────

const page_reader: ToolDefinition = {
  name: "page_reader",
  description: "抓取网页并提取可读文本（剥离 HTML 标签/脚本/样式），适合读文档与手册。",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string" },
      maxChars: { type: "integer", default: 8000, description: "返回文本上限" },
    },
    required: ["url"],
  },
  async handler(args) {
    const url = String(args.url ?? "").trim();
    if (!url) return "[page_reader] url 不能为空";
    const maxChars = Math.min(Math.max(Number(args.maxChars) || 8000, 500), 30000);
    try {
      const resp = await guardedFetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
          "Accept-Language": "zh-CN,zh;q=0.9",
        },
        signal: AbortSignal.timeout(20000),
      });
      if (!resp.ok) return `[page_reader] HTTP ${resp.status}`;
      const html = await resp.text();
      // 剥离 script/style/nav/footer 后去标签
      let text = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
        .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;|&#160;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/[\t\r]+/g, " ")
        .replace(/\n\s*\n+/g, "\n")
        .replace(/[ ]{2,}/g, " ")
        .trim();
      // 按行切分，去掉过短/无意义的行
      const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length >= 2);
      text = lines.join("\n");
      const out = text.length > maxChars ? text.slice(0, maxChars) + `\n…（已截断，共 ${text.length} 字符）` : text;
      return `[page_reader] ${url}（${text.length} 字符）\n\n${out || "(未能提取到可读文本)"}`;
    } catch (err: any) {
      return `[page_reader 错误] ${err?.message || String(err)}`;
    }
  },
};

// 项目测试/构建白名单：只允许这些命令，杜绝把 run_tests 变成任意命令执行
const TEST_COMMANDS: Record<string, { label: string; build: (filter?: string) => string[] }> = {
  test: {
    label: "单元测试",
    build: (filter) => {
      const base = isBunAvailable() ? ["bun", "test"] : ["npm", "test"];
      return filter ? [...base, filter] : base;
    },
  },
  typecheck: {
    label: "类型检查",
    build: () => (isBunAvailable() ? ["bunx", "tsc", "--noEmit"] : ["npx", "tsc", "--noEmit"]),
  },
  build: {
    label: "构建验证",
    build: () => (isBunAvailable() ? ["bun", "run", "build"] : ["npm", "run", "build"]),
  },
};

let _bunChecked: boolean | null = null;
function isBunAvailable(): boolean {
  if (_bunChecked !== null) return _bunChecked;
  try {
    const r = spawnSync("bun", ["--version"], { timeout: 5000, stdio: "ignore", shell: IS_WIN });
    _bunChecked = r.status === 0;
  } catch {
    _bunChecked = false;
  }
  return _bunChecked;
}

const run_tests: ToolDefinition = {
  name: "run_tests",
  description: "运行项目验证（白名单命令）：test 单元测试 / typecheck 类型检查 / build 构建验证。修改代码后调用它确认没有破坏现有功能。",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", enum: ["test", "typecheck", "build"], default: "test" },
      filter: { type: "string", description: "可选：测试文件过滤（如 tools-registry）" },
      timeout: { type: "integer", default: 120, description: "超时秒数（默认 120，上限 600）" },
    },
    required: [],
  },
  async handler(args) {
    const cmd = String(args.command ?? "test");
    const cfg = TEST_COMMANDS[cmd] || TEST_COMMANDS.test;
    const filter = typeof args.filter === "string" && args.filter.trim() ? args.filter.trim() : undefined;
    const timeout = Math.min(Math.max(Number(args.timeout) || 120, 10), 600) * 1000;
    const argv = cfg.build(filter);
    return new Promise((resolvePromise) => {
      const child = spawn(argv[0], argv.slice(1), {
        cwd: workspaceRoot(),
        windowsHide: true,
        shell: IS_WIN && /^(npm|npx|bun|bunx)$/.test(argv[0]),
        env: { ...process.env, CI: "1" },
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolvePromise(`[run_tests:${cmd}] 超时（${timeout / 1000}s），已强制结束\n${tail(stdout)}${stderr ? `\n[stderr]\n${tail(stderr)}` : ""}`);
      }, timeout);
      child.stdout?.on("data", (d) => { stdout += String(d); if (stdout.length > 400_000) stdout = stdout.slice(-400_000); });
      child.stderr?.on("data", (d) => { stderr += String(d); if (stderr.length > 200_000) stderr = stderr.slice(-200_000); });
      child.on("error", (err: any) => {
        clearTimeout(timer);
        resolvePromise(`[run_tests:${cmd}] 启动失败: ${err?.message || String(err)}`);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        const body = tail(stdout) + (stderr ? `\n[stderr]\n${tail(stderr)}` : "");
        const verdict = code === 0 ? "通过 ✅" : `失败 ❌ (exit ${code ?? 1})`;
        resolvePromise(`[run_tests:${cmd}] ${cfg.label} ${verdict}（${argv.join(" ")}）\n\n${body.slice(0, 8000) || "(无输出)"}`);
      });
    });
  },
};

function tail(s: string, n = 60): string {
  const lines = s.split("\n");
  return lines.length > n ? "…（输出过长，仅显示尾部）\n" + lines.slice(-n).join("\n") : s;
}

const workspace_info: ToolDefinition = {
  name: "workspace_info",
  description: "概览工作区项目结构：package.json 脚本与依赖、顶层目录、关键配置文件。编程任务开始时调用可快速建立项目认知。",
  parameters: { type: "object", properties: {} },
  async handler() {
    const root = workspaceRoot();
    const out: string[] = [];
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
      out.push(`项目: ${pkg.name || "(未命名)"} v${pkg.version || "?"}`);
      if (pkg.scripts && Object.keys(pkg.scripts).length) {
        out.push("\nscripts:");
        for (const [k, v] of Object.entries(pkg.scripts)) out.push(`  ${k}: ${String(v).slice(0, 80)}`);
      }
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      const depKeys = Object.keys(deps);
      if (depKeys.length) out.push(`\n依赖: ${depKeys.length} 个（${depKeys.slice(0, 20).join(", ")}${depKeys.length > 20 ? " …" : ""}）`);
    } catch {
      out.push("（未找到 package.json）");
    }
    // 顶层目录/文件
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [] as any[]);
    const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith(".") && !["node_modules", ".next", "dist", "out", "build"].includes(e.name)).map((e) => e.name);
    const files = entries.filter((e) => e.isFile() && !e.name.startsWith(".")).map((e) => e.name);
    out.push(`\n顶层目录: ${dirs.join(", ") || "(无)"}`);
    out.push(`\n顶层文件: ${files.join(", ") || "(无)"}`);
    // 常用配置
    const configs = ["tsconfig.json", "next.config.ts", "next.config.js", "vitest.config.ts", "jest.config.js", "eslint.config.mjs", "tailwind.config.ts", "prisma/schema.prisma", ".env.example"];
    const found: string[] = [];
    for (const c of configs) {
      if (await existsSafe(path.join(root, c))) found.push(c);
    }
    if (found.length) out.push(`\n配置文件: ${found.join(", ")}`);
    out.push(`\n工作区: ${root}`);
    return out.join("\n");
  },
};

async function existsSafe(p: string): Promise<boolean> {
  try { await fs.stat(p); return true; } catch { return false; }
}

// ── 本地子代理（delegate）：真正的委托——独立上下文 + 受限工具循环 + 结果回传 ──
// 与宿主的 subagent 不同：不依赖 DSH 运行时，直接在 NEXUS 内起一个"子代理"，
// 给它独立的任务与（默认只读的）工具子集，跑完把结论交回主对话。

// 子代理可用工具白名单（默认只读；显式扩展时可加 run_tests/workspace_info）
const DELEGATE_TOOL_ALLOW = new Set([
  "read", "glob", "grep", "web_search", "page_reader", "calculator", "current_time", "echo",
  "workspace_info", "memory_recall", "run_tests",
]);

const delegate: ToolDefinition = {
  name: "delegate",
  description: "启动一个本地子代理：给它独立任务，子代理用只读工具自主调研后返回结论。适合并行探索、独立调查、子任务委派。",
  parameters: {
    type: "object",
    properties: {
      task: { type: "string", description: "子代理要完成的任务（越明确越好）" },
      maxRounds: { type: "integer", default: 4, description: "子代理最大工具轮次 1-8" },
    },
    required: ["task"],
  },
  async handler(args, ctx) {
    const task = String(args.task ?? "").trim();
    if (!task) return "[delegate] task 不能为空";
    const maxRounds = Math.min(Math.max(Number(args.maxRounds) || 4, 1), 8);
    const mode = ctx?.mode ?? "default";

    const settings = await getSettings().catch(() => null);
    const provider = settings ? resolveProvider(settings) : null;
    const model = provider ? activeModelOf(provider) : null;
    if (!provider || !model) return "[delegate] 未配置模型供应商，无法启动子代理";

    const toolDefs = [...DELEGATE_TOOL_ALLOW].map((n) => TOOL_MAP.get(n)).filter((t): t is ToolDefinition => !!t)
      .map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));

    const messages: ChatMessage[] = [
      { role: "system", content: "你是一个专注的子代理。只完成委派给你的任务，使用可用工具自主调查（优先读文件/搜索/查文档），信息充足后直接给出结论。不要向主代理提问，不要复述任务。可用工具：read / glob / grep / web_search / page_reader / calculator / current_time / echo / workspace_info / memory_recall / run_tests。" },
      { role: "user", content: task },
    ];

    let lastContent = "";
    for (let round = 0; round <= maxRounds; round++) {
      if (ctx && typeof (ctx as any).shouldStop === "function" && (ctx as any).shouldStop()) break;
      const r = await llmStreamChat(messages, {
        model: model.name,
        temperature: 0.3,
        maxTokens: 2000,
        thinkingEnabled: false,
        provider,
        tools: toolDefs,
      });
      lastContent = r.content || "";
      const native = r.toolCalls?.length ? r.toolCalls.map((tc) => ({ name: tc.name, arguments: tc.arguments })) : null;
      const toolCalls = native ?? parseToolCallsFromText(lastContent);
      if (!toolCalls || toolCalls.length === 0) break;

      messages.push({ role: "assistant", content: lastContent || `[调用工具: ${toolCalls.map((t) => t.name).join(", ")}]` });
      let results = "";
      for (const tc of toolCalls) {
        if (!DELEGATE_TOOL_ALLOW.has(tc.name)) { results += `\n[子代理] 工具 ${tc.name} 不在子代理白名单，已跳过`; continue; }
        const res = await executeTool(tc.name, tc.arguments, undefined, {
          mode, workspaceRoot: workspaceRoot(), approved: true, sessionId: ctx?.sessionId, roomId: ctx?.roomId,
        });
        results += `\n[工具 ${tc.name}] ${res.content.slice(0, 3000)}`;
      }
      messages.push({ role: "user", content: `工具返回：${results}\n\n请基于结果继续，完成即可给出结论。` });
    }
    // 剥离可能的工具 JSON 尾块，避免把 JSON 当结论回传
    const clean = lastContent.replace(/```(?:json)?\s*\{[\s\S]*?\}\s*```/g, "").trim();
    return `[delegate 子代理结论]\n${(clean || "(子代理未返回内容)").slice(0, 8000)}`;
  },
};

// ── 目标与任务管理（降级实现） ─────────────────────────────────

const localGoals = new Map<string, { objective: string; status: string }>();
const localTodos: string[] = [];

const create_goal: ToolDefinition = {
  name: "create_goal",
  description: "创建同会话长目标（当前为进程内降级实现，重启后丢失）。",
  parameters: { type: "object", properties: { objective: { type: "string" } }, required: ["objective"] },
  async handler(args) {
    const objective = String(args.objective ?? "").trim();
    if (!objective) return "[create_goal] objective 不能为空";
    const id = `goal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    localGoals.set(id, { objective, status: "active" });
    return `[create_goal] 已创建 ${id}: ${objective}`;
  },
};

const get_goal: ToolDefinition = {
  name: "get_goal",
  description: "读取当前长目标状态（进程内降级实现）。",
  parameters: { type: "object", properties: {} },
  async handler() {
    if (localGoals.size === 0) return "[get_goal] 当前没有目标";
    return [...localGoals.entries()].map(([id, g]) => `[${id}] ${g.status}: ${g.objective}`).join("\n");
  },
};

const update_goal: ToolDefinition = {
  name: "update_goal",
  description: "更新长目标状态（当前支持 complete / pause / resume，进程内降级实现）。",
  parameters: { type: "object", properties: { goal_id: { type: "string" }, action: { type: "string" } }, required: ["goal_id", "action"] },
  async handler(args) {
    const id = String(args.goal_id ?? "");
    const action = String(args.action ?? "");
    const goal = localGoals.get(id);
    if (!goal) return "[update_goal] 目标不存在";
    if (["complete", "pause", "resume"].includes(action)) {
      goal.status = action;
      return `[update_goal] ${id} -> ${action}`;
    }
    return "[update_goal] action 必须是 complete / pause / resume";
  },
};

const todo_write: ToolDefinition = {
  name: "todo_write",
  description: "写入结构化任务清单（进程内降级实现）。",
  parameters: { type: "object", properties: { todos: { type: "array", items: { type: "object" } } }, required: ["todos"] },
  async handler(args) {
    if (!Array.isArray(args.todos)) return "[todo_write] todos 必须是数组";
    localTodos.length = 0;
    localTodos.push(...args.todos.map((t: any) => `[${t?.status || "pending"}] ${t?.content || ""}`));
    return `[todo_write] 已保存 ${localTodos.length} 项任务`;
  },
};

// ── 宿主依赖工具（明确不可用） ─────────────────────────────────

const workflow: ToolDefinition = {
  name: "workflow",
  description: "大规模多 Agent 编排。",
  parameters: { type: "object", properties: { script: { type: "string" }, meta: { type: "object" }, args: { type: "object" } }, required: ["script"] },
  async handler(args) { return unavailable("workflow", "需要 DSH 宿主的工作流运行时。"); },
};

const ralph: ToolDefinition = {
  name: "ralph",
  description: "无对话种子的新鲜代理迭代循环。",
  parameters: { type: "object", properties: { objective: { type: "string" }, maxRounds: { type: "integer" } }, required: ["objective"] },
  async handler(args) { return unavailable("ralph", "需要 DSH 宿主的 Ralph 循环运行时。"); },
};

const subagent: ToolDefinition = {
  name: "subagent",
  description: "后台委托子任务。",
  parameters: { type: "object", properties: { description: { type: "string" }, prompt: { type: "string" } }, required: ["description", "prompt"] },
  async handler(args) { return unavailable("subagent", "需要 DSH 宿主的多代理运行时。"); },
};

const subagent_fork: ToolDefinition = {
  name: "subagent_fork",
  description: "继承当前上下文的后台子代理。",
  parameters: { type: "object", properties: { description: { type: "string" }, prompt: { type: "string" } }, required: ["description", "prompt"] },
  async handler(args) { return unavailable("subagent_fork", "需要 DSH 宿主的多代理运行时。"); },
};

const send_message: ToolDefinition = {
  name: "send_message",
  description: "向子代理发送消息。",
  parameters: { type: "object", properties: { subagent_id: { type: "string" }, message: { type: "string" } }, required: ["subagent_id", "message"] },
  async handler(args) { return unavailable("send_message", "需要 DSH 宿主的多代理运行时。"); },
};

const list_agents: ToolDefinition = {
  name: "list_agents",
  description: "列出子代理。",
  parameters: { type: "object", properties: { scope: { type: "string" } } },
  async handler(args) { return unavailable("list_agents", "需要 DSH 宿主的多代理运行时。"); },
};

const interrupt_agent: ToolDefinition = {
  name: "interrupt_agent",
  description: "中断子代理。",
  parameters: { type: "object", properties: { agent_id: { type: "string" } }, required: ["agent_id"] },
  async handler(args) { return unavailable("interrupt_agent", "需要 DSH 宿主的多代理运行时。"); },
};

const job_list: ToolDefinition = {
  name: "job_list",
  description: "列出后台任务。",
  parameters: { type: "object", properties: {} },
  async handler(args) { return unavailable("job_list", "需要 DSH 宿主的后台任务运行时。"); },
};

const job_output: ToolDefinition = {
  name: "job_output",
  description: "读取后台任务输出。",
  parameters: { type: "object", properties: { job_id: { type: "string" } }, required: ["job_id"] },
  async handler(args) { return unavailable("job_output", "需要 DSH 宿主的后台任务运行时。"); },
};

const job_kill: ToolDefinition = {
  name: "job_kill",
  description: "终止后台任务。",
  parameters: { type: "object", properties: { job_id: { type: "string" } }, required: ["job_id"] },
  async handler(args) { return unavailable("job_kill", "需要 DSH 宿主的后台任务运行时。"); },
};

// ── 宿主依赖工具（明确不可用） ──────────────────────────────

const ask_user_question: ToolDefinition = {
  name: "ask_user_question",
  description: "向用户提问。当前 NEXUS 聊天界面不支持结构化选项，Agent 应直接在回复中向用户提问。",
  parameters: { type: "object", properties: { question: { type: "string" }, options: { type: "array", items: { type: "string" } } }, required: ["question"] },
  async handler(args) {
    const q = String(args.question ?? "").trim();
    if (!q) return "[ask_user_question] question 不能为空";
    return `[ask_user_question] 请用户回答：${q}\n（当前环境不支持结构化选项，请在对话中直接回复。）`;
  },
};

const skill: ToolDefinition = {
  name: "skill",
  description: "加载技能目录中的技能说明。当前 NEXUS 未内置技能文件系统，返回内置技能名称。",
  parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  async handler(args) {
    const name = String(args.name ?? "").trim();
    if (!name) return "[skill] name 不能为空";
    return unavailable("skill", `技能「${name}」需要 DSH 宿主技能目录；当前仅保留工具定义。`);
  },
};

// ── 导出工具集 ─────────────────────────────────────────────────

export const TOOLS: ToolDefinition[] = [
  read,
  write,
  edit,
  patch,
  str_replace_editor,
  glob,
  grep,
  read_image,
  pwsh,
  webSearch,
  memory_save,
  memory_recall,
  calculator,
  current_time,
  echo,
  http_request,
  page_reader,
  run_tests,
  workspace_info,
  delegate,
  create_goal,
  get_goal,
  update_goal,
  todo_write,
  workflow,
  ralph,
  subagent,
  subagent_fork,
  send_message,
  list_agents,
  interrupt_agent,
  job_list,
  job_output,
  job_kill,
  ask_user_question,
  skill,
];

export const TOOL_MAP = new Map<string, ToolDefinition>(TOOLS.map((t) => [t.name, t]));

// 审批判定：默认模式下根据沙箱风险分级；无限制模式一律不弹审批。
export function needsApproval(name: string, args: Record<string, any> = {}, mode: SafetyMode = "default"): boolean {
  if (mode === "unrestricted") return false;
  return assessToolCall(name, args, mode).requiresApproval;
}

export function toolSchemas(): ToolSchema[] {
  return TOOLS.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

export type ToolExecutionResult = { content: string; status: "ok" | "error" | "blocked" | "approval_required" };

export async function executeTool(
  name: string,
  args: Record<string, any>,
  enabledTools?: string[],
  ctx?: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  if (enabledTools && enabledTools.length > 0 && !enabledTools.includes(name)) return { content: `工具 ${name} 未启用`, status: "error" };
  const tool = TOOL_MAP.get(name);
  if (!tool) return { content: `未知工具: ${name}`, status: "error" };
  const required: string[] = Array.isArray((tool.parameters as any)?.required) ? (tool.parameters as any).required : [];
  const missing = required.filter((k) => args[k] === undefined || args[k] === null || String(args[k]).trim() === "");
  if (missing.length) return { content: `[参数错误] 工具 ${name} 缺少必填参数: ${missing.join(", ")}。请修正参数后重新调用。`, status: "error" };

  const mode = ctx?.mode ?? "default";
  const assessment = assessToolCall(name, args, mode);
  if (assessment.blockedBySystemGuard) {
    return { content: `系统保护：${assessment.guardReason ?? "操作被拦截"}`, status: "blocked" };
  }
  if (mode === "default" && assessment.requiresApproval && !ctx?.approved) {
    return { content: `工具 ${name} 需要审批：${assessment.reasons.join("; ")}`, status: "approval_required" };
  }

  try {
    return { content: await tool.handler(args, { ...ctx, approved: ctx?.approved ?? false }), status: "ok" };
  } catch (err: any) {
    return { content: `工具错误: ${err?.message}`, status: "error" };
  }
}

// 统一沙箱入口：所有调用方（主会话/群聊）都应经过这里。
export async function executeToolSandboxed(
  name: string,
  args: Record<string, any>,
  ctx: SandboxContext & { enabledTools?: string[]; approved?: boolean },
): Promise<ToolExecutionResult> {
  return executeTool(name, args, ctx.enabledTools, ctx);
}

// 安全表达式求值器（calculator 工具与测试使用）
export function safeEvaluate(expression: string): number {
  const src = expression.trim().replace(/\*\*/g, "^");
  let pos = 0;

  const skipSpaces = () => { while (pos < src.length && /\s/.test(src[pos])) pos++; };
  const peek = () => src[pos];
  const eat = (ch: string) => {
    skipSpaces();
    if (src[pos] !== ch) throw new Error(`期望 '${ch}'`);
    pos++;
  };

  const parseNumber = (): number => {
    skipSpaces();
    const start = pos;
    while (pos < src.length && /[0-9.]/.test(src[pos])) pos++;
    if (start === pos) throw new Error("缺少数字");
    const n = Number(src.slice(start, pos));
    if (!isFinite(n)) throw new Error("数字格式错误");
    return n;
  };

  const parseIdentifier = (): string => {
    skipSpaces();
    const start = pos;
    while (pos < src.length && /[a-zA-Z_]/.test(src[pos])) pos++;
    if (start === pos) throw new Error("缺少标识符");
    return src.slice(start, pos);
  };

  const applyFunction = (name: string, args: number[]): number => {
    if (name === "sqrt") {
      if (args.length !== 1 || args[0] < 0) throw new Error("sqrt 需要一个非负参数");
      return Math.sqrt(args[0]);
    }
    if (name === "sin") { if (args.length !== 1) throw new Error("sin 需要一个参数"); return Math.sin(args[0]); }
    if (name === "cos") { if (args.length !== 1) throw new Error("cos 需要一个参数"); return Math.cos(args[0]); }
    if (name === "tan") { if (args.length !== 1) throw new Error("tan 需要一个参数"); return Math.tan(args[0]); }
    if (name === "log") { if (args.length !== 1) throw new Error("log 需要一个参数"); return Math.log10(args[0]); }
    if (name === "ln") { if (args.length !== 1) throw new Error("ln 需要一个参数"); return Math.log(args[0]); }
    if (name === "abs") { if (args.length !== 1) throw new Error("abs 需要一个参数"); return Math.abs(args[0]); }
    throw new Error(`未知函数: ${name}`);
  };

  const parsePrimary = (): number => {
    skipSpaces();
    const ch = peek();
    if (ch === "(") {
      pos++;
      const v = parseExpr();
      eat(")");
      return v;
    }
    if (ch === undefined) throw new Error("表达式意外结束");
    if (/[0-9.]/.test(ch)) return parseNumber();
    if (/[a-zA-Z_]/.test(ch)) {
      const name = parseIdentifier();
      skipSpaces();
      if (peek() === "(") {
        pos++;
        const args: number[] = [];
        skipSpaces();
        if (peek() !== ")") {
          args.push(parseExpr());
          while (peek() === ",") { pos++; args.push(parseExpr()); }
        }
        eat(")");
        return applyFunction(name, args);
      }
      if (name === "Math" && peek() === ".") {
        pos++;
        const prop = parseIdentifier();
        if (prop === "E") return Math.E;
        if (prop === "PI") return Math.PI;
        throw new Error(`未知 Math 属性: ${prop}`);
      }
      if (name === "pi") return Math.PI;
      if (name === "e") return Math.E;
      throw new Error(`未知常量: ${name}`);
    }
    throw new Error(`非法字符: ${ch}`);
  };

  const parsePower = (): number => {
    const left = parsePrimary();
    skipSpaces();
    if (peek() === "^") {
      pos++;
      const right = parsePower();
      return Math.pow(left, right);
    }
    return left;
  };

  const parseUnary = (): number => {
    skipSpaces();
    if (peek() === "-") { pos++; return -parseUnary(); }
    if (peek() === "+") { pos++; return parseUnary(); }
    return parsePower();
  };

  const parseTerm = (): number => {
    let value = parseUnary();
    while (true) {
      skipSpaces();
      const op = peek();
      if (op === "*") { pos++; value *= parseUnary(); }
      else if (op === "/") { pos++; const d = parseUnary(); if (d === 0) throw new Error("除数为 0"); value /= d; }
      else if (op === "%") { pos++; const d = parseUnary(); if (d === 0) throw new Error("模数为 0"); value %= d; }
      else break;
    }
    return value;
  };

  const parseExpr = (): number => {
    let value = parseTerm();
    while (true) {
      skipSpaces();
      const op = peek();
      if (op === "+") { pos++; value += parseTerm(); }
      else if (op === "-") { pos++; value -= parseTerm(); }
      else break;
    }
    return value;
  };

  const result = parseExpr();
  skipSpaces();
  if (pos < src.length) throw new Error("存在无法解析的内容");
  if (typeof result !== "number" || !isFinite(result)) throw new Error("结果非有限数");
  return result;
}
