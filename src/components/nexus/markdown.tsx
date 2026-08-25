"use client";
import { useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * 简易 Markdown 渲染器
 * 支持：标题 / 粗体 / 斜体 / 行内代码 / 代码块 / 列表 / 链接 / 引用 / 表格 / 段落
 * 使用 dangerouslySetInnerHTML 输出，HTML 由本地解析器生成并已做转义
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// 代码块复制：模块级存储（代码经 HTML 转义后放入 data 属性不可靠），按钮只带索引
let codeBlockSeq = 0;
const codeStore = new Map<number, string>();
// 防长期会话内存增长：只保留最近 200 个代码块
function storeCode(code: string): number {
  const id = ++codeBlockSeq;
  codeStore.set(id, code);
  if (codeStore.size > 200) {
    const oldest = codeStore.keys().next().value;
    if (oldest !== undefined) codeStore.delete(oldest);
  }
  return id;
}
export function __getCodeBlock(id: number): string | undefined {
  return codeStore.get(id);
}

/** 行内格式：链接、行内代码、粗体、斜体 */
function inline(text: string): string {
  let s = escapeHtml(text);

  // 行内代码 `code`
  s = s.replace(/`([^`]+)`/g, (_m, c: string) => `<code>${c}</code>`);

  // 链接 [text](url) — url 仅允许 http/https/相对路径
  s = s.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_m, label: string, url: string) => {
      const safe = /^(https?:\/\/|\/|#)/.test(url) ? url : "#";
      return `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    }
  );

  // 粗体 **text**
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // 斜体 *text* / _text_
  s = s.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");
  s = s.replace(/(^|\W)_([^_]+)_(?!\w)/g, "$1<em>$2</em>");

  return s;
}

interface Block {
  type: "p" | "h1" | "h2" | "h3" | "h4" | "ul" | "ol" | "code" | "quote" | "table" | "hr";
  lines: string[];
  lang?: string;
}

function parseTable(headerLine: string, rows: string[]): string {
  const headers = headerLine.split("|").map((c) => c.trim()).filter(Boolean);
  const thead =
    "<thead><tr>" +
    headers.map((h) => `<th>${inline(h)}</th>`).join("") +
    "</tr></thead>";
  const tbody =
    "<tbody>" +
    rows
      .map(
        (r) =>
          "<tr>" +
          r
            .split("|")
            .map((c) => c.trim())
            .filter(Boolean)
            .map((c) => `<td>${inline(c)}</td>`)
            .join("") +
          "</tr>"
      )
      .join("") +
    "</tbody>";
  return `<table>${thead}${tbody}</table>`;
}

function toHtml(src: string): string {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 空行
    if (/^\s*$/.test(line)) { i++; continue; }

    // 代码块 ```
    const fence = line.match(/^```(\w+)?\s*$/);
    if (fence) {
      const lang = fence[1] || "";
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // 跳过结束 ```
      blocks.push({ type: "code", lines: buf, lang });
      continue;
    }

    // 水平线
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      blocks.push({ type: "hr", lines: [] });
      i++;
      continue;
    }

    // 标题
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length as 1 | 2 | 3 | 4;
      blocks.push({ type: (`h${level}` as Block["type"]), lines: [h[2]] });
      i++;
      continue;
    }

    // 引用
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ type: "quote", lines: buf });
      continue;
    }

    // 表格（含分隔行 |---|---|）
    if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:-]+\|/.test(lines[i + 1])) {
      const headerLine = line.replace(/^\s*\|/, "").replace(/\|\s*$/, "");
      i += 2; // 跳过分隔行
      const rows: string[] = [];
      while (i < lines.length && /\|/.test(lines[i]) && !/^\s*$/.test(lines[i])) {
        rows.push(lines[i].replace(/^\s*\|/, "").replace(/\|\s*$/, ""));
        i++;
      }
      blocks.push({ type: "table", lines: [headerLine, ...rows] });
      continue;
    }

    // 无序列表
    if (/^\s*([-*+])\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*([-*+])\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*([-*+])\s+/, ""));
        i++;
      }
      blocks.push({ type: "ul", lines: buf });
      continue;
    }

    // 有序列表
    if (/^\s*\d+\.\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ type: "ol", lines: buf });
      continue;
    }

    // 段落（合并连续非空行）
    const buf: string[] = [];
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^#{1,4}\s/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^\s*([-*+])\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push({ type: "p", lines: buf });
  }

  return blocks
    .map((b) => {
      switch (b.type) {
        case "code": {
          const id = storeCode(b.lines.join("\n"));
          return `<div class="nx-codeblock" style="position:relative">
  <button type="button" class="nx-copy-btn" data-copy-id="${id}" style="position:absolute;top:6px;right:8px;z-index:5;font-size:10px;line-height:1;padding:3px 8px;border-radius:6px;border:1px solid var(--border);background:var(--card);color:var(--muted-foreground);cursor:pointer;opacity:0;transition:opacity .15s">复制</button>
  <pre><code class="lang-${escapeHtml(b.lang || "text")}">${escapeHtml(b.lines.join("\n"))}</code></pre>
</div>`;
        }
        case "hr":
          return "<hr />";
        case "h1":
          return `<h1>${inline(b.lines[0])}</h1>`;
        case "h2":
          return `<h2>${inline(b.lines[0])}</h2>`;
        case "h3":
          return `<h3>${inline(b.lines[0])}</h3>`;
        case "h4":
          return `<h4>${inline(b.lines[0])}</h4>`;
        case "quote":
          return `<blockquote>${inline(b.lines.join(" "))}</blockquote>`;
        case "ul":
          return `<ul>${b.lines.map((l) => `<li>${inline(l)}</li>`).join("")}</ul>`;
        case "ol":
          return `<ol>${b.lines.map((l) => `<li>${inline(l)}</li>`).join("")}</ol>`;
        case "table":
          return parseTable(b.lines[0], b.lines.slice(1));
        case "p":
        default:
          return `<p>${inline(b.lines.join(" "))}</p>`;
      }
    })
    .join("\n");
}

export function Markdown({ content, className }: { content: string; className?: string }) {
  const html = useMemo(() => toHtml(content || ""), [content]);
  const ref = useRef<HTMLDivElement>(null);

  // 代码块复制（事件委托：内容经 dangerouslySetInnerHTML 注入，按钮是动态创建的）
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest?.("[data-copy-id]") as HTMLButtonElement | null;
      if (!btn) return;
      const id = Number(btn.dataset.copyId);
      const code = __getCodeBlock(id);
      if (code == null) return;
      navigator.clipboard.writeText(code).then(() => {
        const orig = btn.textContent;
        btn.textContent = "已复制 ✓";
        setTimeout(() => { btn.textContent = orig; }, 1200);
      }).catch(() => {});
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [html]);

  return (
    <div
      ref={ref}
      className={cn("nx-prose", className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
