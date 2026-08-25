// NEXUS 工作区代码图谱 — 扫描工作区文件 → LLM 归纳每个文件职责 → 存为图谱
// 图谱随工具调用（write/edit/pwsh）自动增量维护，并注入系统上下文
import { promises as fs } from "fs";
import path from "path";
import { db } from "@/lib/db";
import { workspaceRoot } from "./sandbox";

export interface CodeGraphNode {
  id: string;            // 相对路径
  summary: string;       // LLM 归纳的职责
  kind: string;          // file | dir | config
  ext: string;
  loc: number;           // 行数
  imports: string[];     // 依赖的本地模块（相对路径/别名）
  updatedAt: string;
}

// 确定性提取文件头部 import/require 的本地模块依赖（无需 LLM，供图谱上下文与扫描清单使用）
export function extractImports(content: string, filePath: string): string[] {
  const specs = new Set<string>();
  for (const line of content.split("\n")) {
    const fm = line.match(/\bfrom\s+["']([^"']+)["']/);
    if (fm) specs.add(fm[1]);
    const rm = line.match(/\brequire\(\s*["']([^"']+)["']\s*\)/);
    if (rm) specs.add(rm[1]);
    const dm = line.match(/\bimport\(\s*["']([^"']+)["']\s*\)/);
    if (dm) specs.add(dm[1]);
  }
  const resolved: string[] = [];
  for (const spec of specs) {
    try {
      if (spec.startsWith("@/")) { resolved.push("src/" + spec.slice(2) + " (alias)"); continue; }
      if (spec.startsWith(".")) {
        const abs = path.resolve(path.dirname(path.resolve(workspaceRoot(), filePath)), spec);
        const rel = path.relative(workspaceRoot(), abs).replace(/\\/g, "/");
        if (rel && !rel.startsWith("..")) { resolved.push(rel); continue; }
        resolved.push(spec);
      }
    } catch {}
  }
  return [...new Set(resolved)].slice(0, 24);
}

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", ".nexus", "out", "build", "dist", ".cache", ".turbo", ".playwright-mcp", "coverage"]);
const CODE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css", ".md", ".prisma", ".yml", ".yaml", ".html"]);
const MAX_FILE_BYTES = 200_000;

/** 递归扫描工作区，返回相对路径列表（含行数与本地依赖，限制数量防爆炸） */
export async function scanWorkspace(root: string, maxFiles = 300): Promise<{ rel: string; loc: number; imports: string[] }[]> {
  const out: { rel: string; loc: number; imports: string[] }[] = [];
  async function walk(dir: string, depth: number) {
    if (depth > 8 || out.length >= maxFiles) return;
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= maxFiles) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
        await walk(full, depth + 1);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (!CODE_EXTS.has(ext)) continue;
        try {
          const stat = await fs.stat(full);
          if (stat.size > MAX_FILE_BYTES) continue;
          const content = await fs.readFile(full, "utf8");
          out.push({ rel: path.relative(root, full).replace(/\\/g, "/"), loc: content.split("\n").length, imports: extractImports(content, path.relative(root, full).replace(/\\/g, "/")) });
        } catch {}
      }
    }
  }
  await walk(root, 0);
  return out;
}

/** 获取某会话的图谱节点 */
export async function getGraph(sessionId: string): Promise<CodeGraphNode[]> {
  const rows = await db.codeGraphNode.findMany({ where: { sessionId }, orderBy: { id: "asc" } });
  return rows.map((r) => {
    let imports: string[] = [];
    try { const v = JSON.parse((r as any).imports || "[]"); if (Array.isArray(v)) imports = v.filter((x) => typeof x === "string"); } catch {}
    return {
      id: r.id, summary: r.summary, kind: r.kind,
      ext: r.ext, loc: r.loc, imports, updatedAt: r.updatedAt.toISOString(),
    };
  });
}

/** 写入/更新一批节点（LLM 分析结果）；imports 未提供时从实际文件内容提取 */
export async function upsertNodes(sessionId: string, nodes: { id: string; summary: string; kind?: string; ext?: string; loc?: number; imports?: string[] }[]) {
  for (const n of nodes) {
    let imports = Array.isArray(n.imports) ? n.imports.filter((x) => typeof x === "string") : [];
    if (imports.length === 0) {
      try {
        const abs = path.resolve(workspaceRoot(), n.id);
        const content = await fs.readFile(abs, "utf8");
        imports = extractImports(content, n.id);
      } catch {}
    }
    const data = {
      summary: String(n.summary).slice(0, 500),
      kind: n.kind || "file",
      ext: n.ext || path.extname(n.id).toLowerCase(),
      loc: Number(n.loc) || 0,
      imports: JSON.stringify(imports),
      updatedAt: new Date(),
    };
    await db.codeGraphNode.upsert({
      where: { sessionId_id: { sessionId, id: n.id } },
      update: data,
      create: { sessionId, id: n.id, ...data },
    }).catch(() => {});
  }
}

/** 删除节点（文件被删时） */
export async function removeNode(sessionId: string, id: string) {
  await db.codeGraphNode.deleteMany({ where: { sessionId, id } }).catch(() => {});
}

/** 把图谱渲染成紧凑文本，注入 LLM 上下文 */
export function graphToContext(nodes: CodeGraphNode[]): string {
  if (nodes.length === 0) return "";
  const lines = nodes.map((n) => {
    const deps = (n.imports || []).length ? `（依赖: ${n.imports.slice(0, 8).join(", ")}${n.imports.length > 8 ? " …" : ""}）` : "";
    return `- ${n.id} (${n.loc}行): ${n.summary}${deps}`;
  });
  return `\n\n## 项目代码图谱（工作区结构 + 本地依赖关系，修改文件时请保持此认知）\n${lines.join("\n")}`;
}

/** 检测被修改的文件路径（从工具参数提取），返回归一化相对路径 */
export function extractTouchedPaths(toolName: string, args: Record<string, any>, root: string): string[] {
  const paths: string[] = [];
  // 相对路径必须以工作区根为基准解析（executeTool 的 cwd 是 workspaceRoot，不是 process.cwd()）
  const base = path.resolve(root || workspaceRoot());
  const candidates = [args?.path, args?.file_path, args?.cwd];
  for (const c of candidates) {
    if (typeof c !== "string" || !c.trim()) continue;
    try {
      const abs = path.isAbsolute(c.trim()) ? path.resolve(c.trim()) : path.resolve(base, c.trim());
      const rel = path.relative(base, abs).replace(/\\/g, "/");
      if (rel && !rel.startsWith("..")) paths.push(rel);
    } catch {}
  }
  // pwsh 命令里的常见写法粗提：> file / Set-Content file 等（避免误匹配 => / -> / >= 等符号）
  if (toolName === "pwsh" && typeof args?.command === "string") {
    const re = /(?:[^>]|^)>(?!>)|(?:Set-Content|Out-File|Add-Content)\s+["']?([^\s"']+\.(?:ts|tsx|js|jsx|mjs|json|css|html|md))/gi;
    let m;
    while ((m = re.exec(args.command))) {
      if (!m[1]) continue;
      try {
        const rel = path.relative(base, path.isAbsolute(m[1]) ? path.resolve(m[1]) : path.resolve(base, m[1])).replace(/\\/g, "/");
        if (rel && !rel.startsWith("..")) paths.push(rel);
      } catch {}
    }
  }
  return [...new Set(paths)];
}
