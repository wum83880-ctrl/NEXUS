/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
  assessToolCall,
  blockedUrlReason,
  isSystemDestructiveCommand,
  resolveSandboxedPath,
} from "../src/lib/nexus/sandbox";
import path from "path";

describe("sandbox risk assessment", () => {
  test("safe read-only bash command is low risk in default mode", () => {
    const a = assessToolCall("bash", { command: "ls -la" }, "default");
    expect(a.risk).toBe("low");
    expect(a.requiresApproval).toBe(false);
  });

  test("script/write bash command requires approval in default mode", () => {
    const a = assessToolCall("bash", { command: "node script.js" }, "default");
    expect(a.risk).toBe("high");
    expect(a.requiresApproval).toBe(true);
  });

  test("system destructive command is always blocked", () => {
    const d = assessToolCall("bash", { command: "rm -rf /" }, "default");
    const u = assessToolCall("bash", { command: "rm -rf /" }, "unrestricted");
    expect(d.blockedBySystemGuard).toBe(true);
    expect(u.blockedBySystemGuard).toBe(true);
  });

  test("file_read inside workspace is low risk by default", () => {
    const a = assessToolCall("file_read", { path: "README.md" }, "default");
    expect(a.risk).toBe("low");
    expect(a.requiresApproval).toBe(false);
  });

  test("file_write inside workspace is low risk in default mode", () => {
    const a = assessToolCall("file_write", { path: "output.txt", content: "x" }, "default");
    expect(a.risk).toBe("low");
    expect(a.requiresApproval).toBe(false);
  });

  test("file_write outside workspace requires approval in default mode", () => {
    const a = assessToolCall("file_write", { path: path.join(path.resolve(".."), "out.txt"), content: "x" }, "default");
    expect(a.risk).toBe("high");
    expect(a.requiresApproval).toBe(true);
  });

  test("http GET public is low risk, write method requires approval", () => {
    const get = assessToolCall("http_request", { url: "https://example.com" }, "default");
    const post = assessToolCall("http_request", { url: "https://example.com", method: "POST" }, "default");
    expect(get.requiresApproval).toBe(false);
    expect(post.requiresApproval).toBe(true);
  });
});

describe("system destructive command guard", () => {
  test("blocks root deletion, format, shutdown", () => {
    expect(isSystemDestructiveCommand("rm -rf /").blocked).toBe(true);
    expect(isSystemDestructiveCommand("rm -rf C:\\").blocked).toBe(true);
    expect(isSystemDestructiveCommand("format C:").blocked).toBe(true);
    expect(isSystemDestructiveCommand("shutdown /s").blocked).toBe(true);
  });

  test("allows ordinary file deletion", () => {
    expect(isSystemDestructiveCommand("rm -rf ./tmp/build").blocked).toBe(false);
  });
});

describe("path sandbox", () => {
  test("workspace path is allowed in default mode", () => {
    const r = resolveSandboxedPath("README.md", "default", "read");
    expect(r.path).toBe(path.resolve("README.md"));
  });

  test("outside workspace requires approval in default mode", () => {
    const r = resolveSandboxedPath(path.join(path.resolve(".."), "some.txt"), "default", "read");
    expect(r.requiresApproval).toBe(true);
  });

  test("system path is blocked even in unrestricted mode", () => {
    const sysPath = process.platform === "win32" ? "C:\\Windows\\System32" : "/etc";
    const r = resolveSandboxedPath(sysPath, "unrestricted", "read");
    expect(r.blocked).toBe(true);
  });
});

describe("blockedUrlReason hardening", () => {
  test("blocks local and metadata addresses", () => {
    expect(blockedUrlReason("http://localhost:3000")).not.toBeNull();
    expect(blockedUrlReason("http://127.0.0.1")).not.toBeNull();
    expect(blockedUrlReason("http://169.254.169.254/latest/meta-data")).not.toBeNull();
    expect(blockedUrlReason("http://10.0.0.1")).not.toBeNull();
  });

  test("blocks decimal ip and nip.io aliases", () => {
    expect(blockedUrlReason("http://2130706433/")).not.toBeNull();
    expect(blockedUrlReason("http://127.0.0.1.nip.io/")).not.toBeNull();
  });

  test("blocks ipv4-mapped ipv6 localhost/inner variants", () => {
    expect(blockedUrlReason("http://[::ffff:7f00:1]/")).not.toBeNull();
    expect(blockedUrlReason("http://[::ffff:127.0.0.1]/")).not.toBeNull();
    expect(blockedUrlReason("http://[::ffff:0a00:0001]/")).not.toBeNull();
    expect(blockedUrlReason("http://[::7f00:1]/")).not.toBeNull();
  });

  test("allows public urls", () => {
    expect(blockedUrlReason("https://example.com")).toBeNull();
    expect(blockedUrlReason("https://www.baidu.com")).toBeNull();
    expect(blockedUrlReason("http://[2001:db8::1]/")).toBeNull();
  });
});
