/// <reference types="bun-types" />
// 新工具注册与沙箱风险分级回归测试
import { beforeAll, describe, expect, test } from "bun:test";
import { TOOLS, TOOL_MAP, needsApproval, toolSchemas, parseUnifiedDiff, applyHunks } from "../src/lib/nexus/tools";
import { assessToolCall } from "../src/lib/nexus/sandbox";
import { deriveTitle, projectGraph } from "../src/lib/nexus/projections";
import { extractImports } from "../src/lib/nexus/code-graph";
import type { SessionEvent } from "../src/lib/nexus/types";

describe("tool registry", () => {
  test("registers the agent utility tools", () => {
    for (const name of ["memory_save", "memory_recall", "calculator", "current_time", "echo", "http_request"]) {
      expect(TOOL_MAP.has(name), `missing tool ${name}`).toBe(true);
    }
  });

  test("every registered tool has valid schema + unique name", () => {
    const names = new Set<string>();
    for (const t of TOOLS) {
      expect(typeof t.name).toBe("string");
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.parameters?.type).toBe("object");
      expect(names.has(t.name)).toBe(false);
      names.add(t.name);
    }
  });

  test("toolSchemas conforms to function-calling shape", () => {
    const schemas = toolSchemas();
    expect(schemas.length).toBe(TOOLS.length);
    const http = schemas.find((s) => s.function.name === "http_request");
    expect(http?.function.parameters.properties.method.default).toBe("GET");
    expect(Array.isArray(http?.function.parameters.required)).toBe(true);
  });
});

describe("new tool risk assessment", () => {
  test("http GET is safe, write method requires approval in default mode", () => {
    expect(needsApproval("http_request", { url: "https://example.com", method: "GET" }, "default")).toBe(false);
    expect(needsApproval("http_request", { url: "https://example.com", method: "POST" }, "default")).toBe(true);
    expect(needsApproval("http_request", { url: "https://example.com", method: "DELETE" }, "unrestricted")).toBe(false);
  });

  test("memory/calculator/echo are safe in default mode", () => {
    expect(assessToolCall("memory_save", { key: "k", value: "v" }, "default").requiresApproval).toBe(false);
    expect(assessToolCall("memory_recall", {}, "default").requiresApproval).toBe(false);
    expect(assessToolCall("calculator", { expression: "1+1" }, "default").requiresApproval).toBe(false);
    expect(assessToolCall("echo", { text: "x" }, "default").requiresApproval).toBe(false);
  });

  test("http_request to localhost is system-blocked by SSRF guard", () => {
    const a = assessToolCall("http_request", { url: "http://localhost:3000" }, "default");
    expect(a.blockedBySystemGuard).toBe(true);
  });
});

describe("projectGraph turn_end cleanup", () => {
  test("running nodes are finalized on turn_end (no stuck running)", () => {
    const events = [
      evt({ seq: 1, type: "graph/turn_start", data: { turn: 1 } }),
      evt({ seq: 2, type: "graph/node_start", data: { node: "llm_call", turn: 1 } }),
      // 缺少 graph/node_end for llm_call —— 缺事件时的兜底
      evt({ seq: 3, type: "graph/turn_end", data: { turn: 1 } }),
    ];
    const graph = projectGraph(events);
    const llm = graph.nodes.find((n) => n.id === "t1-llm_call");
    expect(llm).toBeDefined();
    expect(llm!.status).toBe("done");
  });
});

describe("deriveTitle surrogate-pair safety", () => {
  test("truncation does not split a surrogate pair", () => {
    // 43 个码点：截断边界正好落在 emoji 之后
    const long = "测试".repeat(20) + "😀" + "尾" + "x";
    const title = deriveTitle(long);
    const body = title.endsWith("…") ? title.slice(0, -1) : title;
    // 末尾不应是孤立代理对半截
    const last = body.charCodeAt(body.length - 1);
    expect(last >= 0xd800 && last <= 0xdfff).toBe(false);
    // 码点数不超过 42（不含省略号）
    expect(Array.from(body).length).toBeLessThanOrEqual(42);
    // 完整短标题原样返回
    expect(deriveTitle("你好 NEXUS")).toBe("你好 NEXUS");
  });
});

function evt(partial: Partial<SessionEvent> & Pick<SessionEvent, "type" | "data" | "seq">): SessionEvent {
  return {
    id: `e-${partial.seq}`,
    sessionId: "s1",
    createdAt: new Date().toISOString(),
    ...partial,
  } as SessionEvent;
}

describe("programming tool additions", () => {
  test("registers page_reader / run_tests / workspace_info", () => {
    for (const name of ["page_reader", "run_tests", "workspace_info"]) {
      expect(TOOL_MAP.has(name), `missing tool ${name}`).toBe(true);
    }
  });

  test("run_tests schema whitelists command enum", () => {
    const t = TOOL_MAP.get("run_tests");
    expect(t).toBeDefined();
    const cmd = (t!.parameters as any).properties.command;
    expect(cmd.enum).toEqual(["test", "typecheck", "build"]);
    expect(cmd.default).toBe("test");
  });

  test("page_reader to localhost is system-blocked (SSRF guard)", () => {
    const a = assessToolCall("page_reader", { url: "http://169.254.169.254/latest/meta-data" }, "default");
    expect(a.blockedBySystemGuard).toBe(true);
  });

  test("run_tests and workspace_info are safe in default mode", () => {
    expect(assessToolCall("run_tests", { command: "test" }, "default").requiresApproval).toBe(false);
    expect(assessToolCall("workspace_info", {}, "default").requiresApproval).toBe(false);
  });
});

describe("extractImports", () => {
  test("extracts relative and alias imports", () => {
    const src = `import { db } from "@/lib/db";
import { TOOLS } from "./tools";
import path from "path";
const x = require("../utils");
const y = import("lodash");`;
    const imports = extractImports(src, "src/lib/nexus/tools.ts");
    expect(imports).toContain("src/lib/db (alias)");
    // ./tools → 解析为同目录相对路径
    expect(imports).toContain("src/lib/nexus/tools");
    // ../utils → 上跳一层
    expect(imports).toContain("src/lib/utils");
    // npm 包（lodash）不进入本地依赖
    expect(imports.some((i) => i.startsWith("node_modules") || i === "lodash")).toBe(false);
  });

  test("resolves relative specifiers to project-relative paths (no ext guessing)", () => {
    const src = `import { cn } from "./utils";`;
    const imports = extractImports(src, "src/lib/index.ts");
    expect(imports).toContain("src/lib/utils");
  });

  test("ignores npm package names (no local resolution)", () => {
    const src = `import React from "react"; import { z } from "zod";`;
    expect(extractImports(src, "src/a.ts")).toHaveLength(0);
  });
});

describe("projectGraph decision nodes", () => {
  test("decision/record creates a clickable decision node", () => {
    const events = [
      evt({ seq: 1, type: "graph/turn_start", data: { turn: 1 } }),
      evt({ seq: 2, type: "decision/record", data: { turn: 1, protocol: "native", hasToolCalls: true } }),
      evt({ seq: 3, type: "graph/turn_end", data: { turn: 1 } }),
    ];
    const graph = projectGraph(events);
    const dn = graph.nodes.find((n) => n.kind === "decision");
    expect(dn).toBeDefined();
    expect(dn!.id).toContain("decision:0");
    expect((dn!.meta as any)?.decisionIndex).toBe(0);
    expect(dn!.status).toBe("done");
    // 有入边/出边连到 llm_call
    expect(graph.edges.some((e) => e.to === dn!.id)).toBe(true);
    expect(graph.edges.some((e) => e.from === dn!.id)).toBe(true);
  });

  test("multiple decisions per turn get distinct indices", () => {
    const events = [
      evt({ seq: 1, type: "graph/turn_start", data: { turn: 1 } }),
      evt({ seq: 2, type: "decision/record", data: { turn: 1, protocol: "native" } }),
      evt({ seq: 3, type: "decision/record", data: { turn: 1, protocol: "text" } }),
      evt({ seq: 4, type: "graph/turn_end", data: { turn: 1 } }),
    ];
    const graph = projectGraph(events);
    const dns = graph.nodes.filter((n) => n.kind === "decision").sort((a, b) => a.id.localeCompare(b.id));
    expect(dns.length).toBe(2);
    expect((dns[0].meta as any).decisionIndex).toBe(0);
    expect((dns[1].meta as any).decisionIndex).toBe(1);
  });
});

describe("patch tool (unified diff)", () => {
  test("parses multi-file multi-hunk diff", () => {
    const diff = [
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,3 +1,3 @@",
      " old1",
      "-del",
      "+add",
      " old3",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -5,2 +5,3 @@",
      " ctx5",
      "+ctx6",
    ].join("\n");
    const files = parseUnifiedDiff(diff);
    expect(files.length).toBe(2);
    expect(files[0].file).toBe("src/a.ts");
    expect(files[0].hunks.length).toBe(1);
    expect(files[0].hunks[0].lines.map((l) => l.type)).toEqual(["ctx", "del", "add", "ctx"]);
    expect(files[1].file).toBe("src/b.ts");
  });

  test("applies replacement hunk with context", () => {
    const src = "line1\nold line\nline3";
    const files = parseUnifiedDiff("--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n line1\n-old line\n+new line\n line3");
    const res = applyHunks(src, files[0].hunks);
    expect(res.ok).toBe(true);
    expect(res.result).toBe("line1\nnew line\nline3");
  });

  test("applies insertion hunk", () => {
    const src = "a\nb";
    const files = parseUnifiedDiff("--- a/x\n+++ b/x\n@@ -2,1 +2,2 @@\n b\n+c");
    const res = applyHunks(src, files[0].hunks);
    expect(res.ok).toBe(true);
    expect(res.result).toBe("a\nb\nc");
  });

  test("fails when context does not match", () => {
    const src = "completely\ndifferent\ncontent";
    const files = parseUnifiedDiff("--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n line1\n-old line\n+new line\n line3");
    const res = applyHunks(src, files[0].hunks);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("上下文不匹配");
  });

  test("supports offset fuzz for nearby context", () => {
    const src = "head\nline1\nold line\nline3";
    const files = parseUnifiedDiff("--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n line1\n-old line\n+new line\n line3");
    const res = applyHunks(src, files[0].hunks);
    expect(res.ok).toBe(true);
    expect(res.result).toContain("new line");
  });
});

describe("isMaskedApiKey boundary", () => {
  let isMaskedApiKey: (k: string) => boolean;
  let maskApiKey: (k: string) => string;
  beforeAll(async () => {
    // 动态导入：settings 依赖 PrismaClient，避免测试启动时实例化
    const mod = await import("../src/lib/nexus/settings");
    isMaskedApiKey = mod.isMaskedApiKey;
    maskApiKey = mod.maskApiKey;
  });

  test("recognizes normal masked key (3+4+4)", () => {
    expect(isMaskedApiKey(maskApiKey("sk-abcdefgh12345678"))).toBe(true);
  });

  test("recognizes short-key mask (****)", () => {
    expect(isMaskedApiKey("****")).toBe(true);
    expect(isMaskedApiKey(maskApiKey("short"))).toBe(true);
  });

  test("does not treat real keys as masked", () => {
    expect(isMaskedApiKey("sk-real-key-123456")).toBe(false);
    expect(isMaskedApiKey("")).toBe(false);
  });
});

describe("patch CRLF compatibility", () => {
  test("applies hunk to CRLF file preserving line endings", () => {
    const src = "line1\r\nold line\r\nline3";
    const files = parseUnifiedDiff("--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n line1\n-old line\n+new line\n line3");
    const res = applyHunks(src, files[0].hunks);
    expect(res.ok).toBe(true);
    expect(res.result).toBe("line1\r\nnew line\r\nline3");
  });
});
