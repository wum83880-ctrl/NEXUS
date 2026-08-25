/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { parseToolCallsFromText } from "../src/lib/nexus/tool-parser";

describe("parseToolCallsFromText", () => {
  test("parses fenced JSON", () => {
    const calls = parseToolCallsFromText('先分析\n```json\n{"tool":"web_search","args":{"query":"x"}}\n```\n然后总结');
    expect(calls).toHaveLength(1);
    expect(calls![0].name).toBe("web_search");
    expect(calls![0].arguments.query).toBe("x");
  });

  test("parses bare JSON", () => {
    const calls = parseToolCallsFromText('{"name":"calculator","arguments":{"expression":"1+1"}}');
    expect(calls).toHaveLength(1);
    expect(calls![0].name).toBe("calculator");
  });

  test("parses stringified arguments", () => {
    const calls = parseToolCallsFromText('{"tool":"write","args":{},"arguments":"{\\"path\\":\\"/tmp/a\\",\\"content\\":\\"hi\\"}"}');
    expect(calls).toHaveLength(1);
    expect(calls![0].arguments.path).toBe("/tmp/a");
  });

  test("returns null for plain text", () => {
    expect(parseToolCallsFromText("直接回答，不调用工具")).toBeNull();
  });
});
