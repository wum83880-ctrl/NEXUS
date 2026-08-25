/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { safeEvaluate, blockedUrlReason } from "../src/lib/nexus/tools";

describe("safeEvaluate", () => {
  test("basic arithmetic", () => {
    expect(safeEvaluate("1+2*3")).toBe(7);
    expect(safeEvaluate("(1+2)*3")).toBe(9);
    expect(safeEvaluate("2^10")).toBe(1024);
    expect(safeEvaluate("2**10")).toBe(1024);
    expect(safeEvaluate("10%3")).toBe(1);
  });

  test("functions and constants", () => {
    expect(safeEvaluate("sqrt(16)")).toBe(4);
    expect(safeEvaluate("abs(-5)")).toBe(5);
    expect(safeEvaluate("pi")).toBeCloseTo(Math.PI);
    expect(safeEvaluate("log(100)")).toBeCloseTo(2);
    expect(safeEvaluate("ln(Math.E)")).toBeCloseTo(1);
  });

  test("rejects code execution attempts", () => {
    expect(() => safeEvaluate("constructor.constructor('return process')()")).toThrow();
    expect(() => safeEvaluate("String.fromCharCode(114)")).toThrow();
    expect(() => safeEvaluate("process")).toThrow();
  });

  test("rejects malformed expressions", () => {
    expect(() => safeEvaluate("1+")).toThrow();
    expect(() => safeEvaluate("(1+2")).toThrow();
    expect(() => safeEvaluate("1/0")).toThrow();
  });
});

describe("blockedUrlReason", () => {
  test("blocks localhost and private networks", () => {
    expect(blockedUrlReason("http://localhost:3000")).not.toBeNull();
    expect(blockedUrlReason("http://127.0.0.1")).not.toBeNull();
    expect(blockedUrlReason("http://10.0.0.1")).not.toBeNull();
    expect(blockedUrlReason("http://192.168.1.1")).not.toBeNull();
    expect(blockedUrlReason("http://169.254.169.254/latest/meta-data")).not.toBeNull();
    expect(blockedUrlReason("http://172.16.0.1")).not.toBeNull();
    expect(blockedUrlReason("file:///etc/passwd")).not.toBeNull();
  });

  test("allows public urls", () => {
    expect(blockedUrlReason("https://example.com")).toBeNull();
    expect(blockedUrlReason("https://www.baidu.com")).toBeNull();
  });
});
