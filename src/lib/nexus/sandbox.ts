// NEXUS Tool Sandbox
// 统一工具沙箱：风险分级 + 系统保护层 + 默认模式审批门 + 文件/命令/网络策略。
// 设计目标：
//  - 所有工具调用必须经过 executeToolSandboxed（由 tools.ts 暴露）。
//  - 系统保护层不依赖模式，始终拦截破坏本机系统的操作。
//  - 默认模式只拦截高风险操作；无限制模式放开常规审批，但系统保护仍生效。

import path from "path";
import { promises as fs } from "fs";

export type SafetyMode = "default" | "unrestricted";
export type RiskLevel = "safe" | "low" | "high" | "system_critical";

export interface SandboxContext {
  mode: SafetyMode;
  workspaceRoot: string;
  sessionId?: string;
  roomId?: string;
}

export interface RiskAssessment {
  risk: RiskLevel;
  reasons: string[];
  requiresApproval: boolean;
  blockedBySystemGuard: boolean;
  guardReason?: string;
}

export const SYSTEM_CRITICAL_DIRS: string[] = [
  // Windows
  "C:\\Windows",
  "C:\\Program Files",
  "C:\\Program Files (x86)",
  "C:\\ProgramData",
  "C:\\System Volume Information",
  "C:\\Recovery",
  "C:\\$Recycle.Bin",
  // Linux/macOS
  "/",
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/lib",
  "/lib64",
  "/proc",
  "/sbin",
  "/sys",
  "/usr",
  "/var",
  "/System",
  "/Library",
  "/Applications",
  "/private/etc",
  "/private/var",
];

const SYSTEM_CRITICAL_FILES: string[] = [
  "/etc/passwd",
  "/etc/shadow",
  "/etc/sudoers",
  "/etc/hosts",
  "C:\\Windows\\System32\\drivers\\etc\\hosts",
  "C:\\boot.ini",
  "C:\\pagefile.sys",
];

const SENSITIVE_PROJECT_FILES = [
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  "db/custom.db",
  "prisma/dev.db",
];

const SENSITIVE_EXTENSIONS = [".pem", ".key", ".p12", ".pfx", ".id_rsa", ".ppk"];

// 工作区根目录，统一从 process.cwd() 获取；测试可覆盖。
export function workspaceRoot(): string {
  const env = process.env.NEXUS_WORKSPACE;
  if (env && env.trim()) return path.resolve(env.trim());
  return process.cwd();
}

function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, "/");
}

function isPathInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function isSystemPath(p: string): boolean {
  const abs = path.resolve(p);
  const normalized = normalizeSlashes(abs).toLowerCase();
  for (const dir of SYSTEM_CRITICAL_DIRS) {
    const d = normalizeSlashes(dir).toLowerCase().replace(/\/+$/, "");
    // 根目录（"/"、盘符根 "c:/"）只能精确相等判断：startsWith 会把 Unix 上所有绝对路径误判
    const isRoot = d === "" || /^[a-z]:$/.test(d);
    if (isRoot) {
      if (normalized === d || normalized === d + "/") return true;
      if (/^[a-z]:\/?$/.test(normalized)) return true;
      continue;
    }
    if (normalized === d || normalized.startsWith(d + "/")) return true;
  }
  for (const file of SYSTEM_CRITICAL_FILES) {
    if (normalized === normalizeSlashes(file).toLowerCase()) return true;
  }
  return false;
}

function isSensitiveProjectPath(p: string): boolean {
  const abs = path.resolve(p);
  const normalized = normalizeSlashes(abs).toLowerCase();
  const root = normalizeSlashes(workspaceRoot()).toLowerCase();
  for (const name of SENSITIVE_PROJECT_FILES) {
    const full = normalizeSlashes(path.join(workspaceRoot(), name)).toLowerCase();
    if (normalized === full) return true;
  }
  const rel = path.relative(workspaceRoot(), abs);
  const relNorm = normalizeSlashes(rel).toLowerCase();
  if (relNorm.startsWith(".nexus/") || relNorm === ".nexus") return true;
  for (const ext of SENSITIVE_EXTENSIONS) {
    if (abs.toLowerCase().endsWith(ext)) return true;
  }
  return false;
}

export function isSystemDestructiveCommand(command: string): { blocked: boolean; reason?: string } {
  const c = command.trim().toLowerCase();
  if (!c) return { blocked: false };

  // 常见系统破坏模式
  const patterns: { re: RegExp; reason: string }[] = [
    { re: /(^|[;&|]\s*)(rm|rmdir)\s+(-[a-z]*r[a-z]*\s+)?(\/|\\|c:\\|c:\/|\.\/\s*$)/i, reason: "禁止删除文件系统根目录" },
    { re: /(^|[;&|]\s*)del\s+\/(f|s|q|a)+\s+\/(f|s|q|a)*\s+c:\\/i, reason: "禁止删除 Windows 系统盘" },
    { re: /(^|[;&|]\s*)(format|mkfs\.\w+|mkfs|fdisk|diskpart|dd|mformat|gdisk)\b/i, reason: "禁止格式化/改写磁盘设备" },
    { re: /(^|[;&|]\s*)(shutdown|reboot|poweroff|halt|init\s+0|init\s+6)\b/i, reason: "禁止关机/重启系统" },
    { re: /(^|[;&|]\s*)(chmod|chown)\s+(-[a-z]*r[a-z]*\s+)?(777|666|000|root|all)\s+(\/|\\|c:\\|c:\/)/i, reason: "禁止修改系统根目录权限" },
    { re: /(^|[;&|]\s*)reg\s+(delete|add)\s+hk(lm|cu|cr|u)\\/i, reason: "禁止修改注册表关键项" },
    { re: /(^|[;&|]\s*)sc\s+(delete|config)\s+\w+/i, reason: "禁止删除/修改系统服务" },
    { re: /(^|[;&|]\s*)(bcdedit|bootrec|fixboot|fixmbr|bootsect)\b/i, reason: "禁止修改系统引导" },
    { re: /(^|[;&|]\s*)taskkill\s+\/f\s+\/im\s+(system|wininit|lsass|csrss|smss)\.exe/i, reason: "禁止结束系统关键进程" },
    { re: /(^|[;&|]\s*)kill\s+-9\s+(1|0)\b/i, reason: "禁止杀死系统 1 号进程" },
    { re: /(^|[;&|]\s*)mount\s+\/dev\/\w+\s+\/|umount\s+\//i, reason: "禁止卸载/挂载根文件系统" },
    { re: /(^|[;&|]\s*)dd\s+.*of=\/dev\/(sd|hd|nvme|vd)/i, reason: "禁止向磁盘设备直接写入" },
  ];

  for (const p of patterns) {
    if (p.re.test(c)) return { blocked: true, reason: p.reason };
  }

  // 对 `cd / && rm -rf *` 这类间接破坏做粗检
  if (/(cd\s+\/|cd\s+c:\\)[\s\S]*(rm\s+-rf|del\s+\/f\s+\/s\s+\/q)/i.test(c)) {
    return { blocked: true, reason: "检测到切换到系统根目录后执行删除，已拦截" };
  }

  return { blocked: false };
}

function isHighRiskCommand(command: string): boolean {
  const c = command.trim().toLowerCase();
  if (!c) return false;

  const highRiskPatterns: RegExp[] = [
    /(^|[;&|]\s*)(rm|rmdir|mv|cp|del|erase|ren)\b/,
    /(^|[;&|]\s*)(sh|bash|zsh|fish|pwsh|powershell|cmd)\s+/,
    /(^|[;&|]\s*)(node|python|python3|bun|deno|ruby|perl|php|java|go)\s+/,
    /(^|[;&|]\s*)(npm|npx|pnpm|yarn|bun|pip|pip3|gem|brew|apt|apt-get|dnf|yum)\s+/,
    /(^|[;&|]\s*)(curl|wget)\s+.*(-X\s+(post|put|delete|patch)|--data|--upload-file|--request)/i,
    /(^|[;&|]\s*)(kill|killall|taskkill|pkill)\b/,
    /(^|[;&|]\s*)(chmod|chown)\b/,
    /(^|[;&|]\s*)(systemctl|service|sc|reg)\b/,
    /(^|[;&|]\s*)(tee|dd|mkfs|fdisk|diskpart|format)\b/,
    /(^|[;&|]\s*)(shutdown|reboot|poweroff|halt)\b/,
    />>|>|2>/,
  ];
  return highRiskPatterns.some((re) => re.test(c));
}

export function commandRisk(command: string): RiskLevel {
  const guard = isSystemDestructiveCommand(command);
  if (guard.blocked) return "system_critical";
  if (isHighRiskCommand(command)) return "high";
  return "low";
}

function pathRisk(p: string, operation: "read" | "write" | "list" | "delete"): RiskLevel {
  const abs = path.resolve(p);
  if (isSystemPath(abs)) return "system_critical";
  const inside = isPathInside(workspaceRoot(), abs);
  if (inside && !isSensitiveProjectPath(abs)) {
    // 写操作覆盖项目关键文件仍算高风险；普通工作区文件读写都放行。
    if (operation === "write" && isProjectCritical(abs)) return "high";
    return "low";
  }
  return "high";
}

function isProjectCritical(p: string): boolean {
  const abs = path.resolve(p);
  const normalized = normalizeSlashes(abs).toLowerCase();
  const root = normalizeSlashes(workspaceRoot()).toLowerCase();
  const critical = [
    "package.json",
    "next.config.ts",
    "tsconfig.json",
    ".env",
    "prisma/schema.prisma",
    "src/proxy.ts",
  ];
  return critical.some((name) => normalized === normalizeSlashes(path.join(workspaceRoot(), name)).toLowerCase());
}

export function resolveSandboxedPath(
  rawPath: string,
  mode: SafetyMode,
  operation: "read" | "write" | "list" | "delete",
  opts: { allowHighRisk?: boolean } = {},
): { path?: string; error?: string; requiresApproval?: boolean; blocked?: boolean } {
  if (!rawPath || typeof rawPath !== "string") return { error: "路径不能为空" };
  const abs = path.resolve(rawPath);
  const guard = isSystemPath(abs);
  if (guard) return { blocked: true, error: "系统保护：禁止访问系统关键路径" };

  const risk = pathRisk(abs, operation);
  if (risk === "system_critical") return { blocked: true, error: "系统保护：禁止访问系统关键路径" };

  // 无限制模式，或已通过审批的高风险调用：允许 high，但仍拦截 system_critical。
  if (mode === "unrestricted" || opts.allowHighRisk) {
    return { path: abs };
  }

  // default 模式
  if (risk === "high") return { requiresApproval: true, error: "该路径操作需要审批" };
  return { path: abs };
}

export function assessToolCall(name: string, args: Record<string, any>, mode: SafetyMode): RiskAssessment {
  const reasons: string[] = [];
  let risk: RiskLevel = "safe";

  const elevate = (r: RiskLevel, reason: string) => {
    if (r === "system_critical" || (r === "high" && risk !== "system_critical")) risk = r;
    else if (risk === "safe") risk = r;
    reasons.push(reason);
  };

  switch (name) {
    case "web_search":
    case "calculator":
    case "current_time":
    case "echo":
    case "memory_save":
    case "memory_recall":
    case "create_goal":
    case "get_goal":
    case "update_goal":
    case "todo_write":
    case "workflow":
    case "ralph":
    case "subagent":
    case "subagent_fork":
    case "send_message":
    case "list_agents":
    case "interrupt_agent":
    case "job_list":
    case "job_output":
    case "job_kill":
    case "ask_user_question":
    case "skill":
    case "run_tests":
    case "workspace_info":
    case "delegate":
      risk = "safe";
      break;
    case "page_reader":
      risk = "low";
      const url = String(args.url ?? "");
      const blocked = blockedUrlReason(url);
      if (blocked) {
        elevate("system_critical", blocked);
      }
      break;
    case "read":
    case "glob":
    case "grep":
    case "read_image":
    case "file_list":
    case "file_read": {
      const p = String(args.path ?? args.file_path ?? "");
      const op = name === "file_list" || name === "glob" || name === "grep" ? "list" : "read";
      const guard = isSystemPath(p);
      if (guard) {
        elevate("system_critical", "禁止访问系统关键路径");
        break;
      }
      const r = pathRisk(p, op);
      if (r === "system_critical") elevate("system_critical", "禁止访问系统关键路径");
      else if (r === "high") elevate("high", mode === "default" ? "路径不在工作区或为敏感文件，需要审批" : "路径不在工作区");
      else elevate("low", "工作区内读取");
      break;
    }
    case "write":
    case "edit":
    case "patch":
    case "str_replace_editor":
    case "file_write": {
      const viewOnly = name === "str_replace_editor" && String(args.command ?? "") === "view";
      const p = String(args.path ?? args.file_path ?? "");
      const guard = isSystemPath(p);
      if (guard) {
        elevate("system_critical", viewOnly ? "禁止访问系统关键路径" : "禁止写入系统关键路径");
        break;
      }
      const r = pathRisk(p, viewOnly ? "read" : "write");
      if (r === "system_critical") elevate("system_critical", viewOnly ? "禁止访问系统关键路径" : "禁止写入系统关键路径");
      else if (r === "high") elevate("high", viewOnly ? "读取工作区外或敏感文件，需要审批" : "写入工作区外或覆盖关键文件，需要审批");
      else elevate("low", viewOnly ? "工作区内读取" : "工作区内普通文件写入");
      break;
    }
    case "http_request": {
      const method = String(args.method ?? "GET").toUpperCase();
      const u = String(args.url ?? "");
      const blocked = blockedUrlReason(u);
      if (blocked) {
        elevate("system_critical", blocked);
        break;
      }
      if (method !== "GET" && method !== "HEAD") {
        elevate("high", "HTTP 写操作需要审批");
      } else {
        elevate("low", "HTTP 只读请求");
      }
      break;
    }
    case "pwsh":
    case "bash": {
      const cmd = String(args.command ?? "");
      const guard = isSystemDestructiveCommand(cmd);
      if (guard.blocked) {
        elevate("system_critical", guard.reason || "系统保护拦截");
        break;
      }
      const r = commandRisk(cmd);
      if (r === "system_critical") elevate("system_critical", "系统保护拦截");
      else if (r === "high") elevate("high", "脚本/写操作/系统操作需要审批");
      else elevate("low", "只读命令");
      break;
    }
    default:
      risk = "high";
      reasons.push("未知工具，默认按高风险处理");
  }

  const blockedBySystemGuard = (risk as RiskLevel) === "system_critical";
  const requiresApproval = mode === "default" && (risk as RiskLevel) === "high" && !blockedBySystemGuard;
  const guardReason = blockedBySystemGuard ? reasons.find((r) => r.includes("禁止") || r.includes("拦截")) : undefined;

  return { risk, reasons, requiresApproval, blockedBySystemGuard, guardReason };
}

export function blockedUrlReason(urlString: string): string | null {
  try {
    const u = new URL(urlString);
    const protocol = u.protocol.toLowerCase();
    if (protocol === "file:") return "file 协议禁止访问";
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");

    // 本地/回环/链路本地/云元数据/内网
    if (host === "localhost" || host === "0.0.0.0" || host === "::1" || host === "::" || host === "[::1]") return "禁止访问本地地址";
    if (/^127\./.test(host) || host === "127.0.0.1") return "禁止访问本地地址";
    if (/^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return "禁止访问内网地址";
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return "禁止访问内网地址";
    if (/^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./.test(host)) return "禁止访问云元数据/运营商保留地址";
    // IPv6 本地/内网识别（旧实现先剥离冒号再匹配 (::ffff:)? 前缀，逻辑自相矛盾，实测可被 ::ffff:7f00:1 绕过）：
    //  ① ::ffff:a.b.c.d / ::ffff:xxxx:xxxx（IPv4 映射）→ 还原 IPv4 再校验
    //  ② ::/96 兼容形式（前 6 组全零，如 ::7f00:1、::127.0.0.1）→ 末 32 位即 IPv4
    //  ③ fe80::/10 link-local 与 fc00::/7 ULA
    // 注意：不能对任意 IPv6 取末 32 位校验（2001:db8::1 等公网地址的低 32 位可能恰好落在 127/10 段，会误伤）。
    if (host.includes(":") && /^[0-9a-f:.]+$/i.test(host)) {
      const dotted = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
      if (dotted) {
        if (/^(127|10|192\.168|169\.254|172\.(1[6-9]|2\d|3[01])|0)\./.test(dotted[1])) return "禁止访问本地/内网地址";
      } else {
        let expanded = host;
        if (host.includes("::")) {
          const halves = host.split("::");
          const left = halves[0] ? halves[0].split(":") : [];
          const right = halves[1] ? halves[1].split(":") : [];
          const missing = Math.max(0, 8 - left.length - right.length);
          expanded = [...left, ...Array(missing).fill("0"), ...right].join(":");
        }
        const groups = expanded.split(":");
        if (groups.length === 8) {
          const g = groups.map((x) => parseInt(x, 16) || 0);
          const ipv4 = `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
          if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
            // ① IPv4 映射
            if (/^(127|10|192\.168|169\.254|172\.(1[6-9]|2\d|3[01])|0)\./.test(ipv4)) return "禁止访问本地/内网地址";
          } else if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) {
            // ② ::/96 兼容形式
            if (/^(127|10|192\.168|169\.254|172\.(1[6-9]|2\d|3[01])|0)\./.test(ipv4)) return "禁止访问本地/内网地址";
          } else if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xfe00) === 0xfc00) {
            // ③ link-local / ULA
            return "禁止访问本地/内网地址";
          }
        }
      }
    }
    if (/^0\./.test(host)) return "禁止访问保留地址";
    if (/^\[?::$/.test(host)) return "禁止访问未指定地址";

    // 数字 IP 变体：2130706433 / 0177.0.0.1 / 127.1 / 0x7f000001
    const decimalIp = /^\d{7,11}$/.test(host);
    if (decimalIp) {
      const n = Number(host);
      const ipv4 = `${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`;
      if (/^(127|10|192\.168|169\.254|172\.(1[6-9]|2\d|3[01])|0)\./.test(ipv4)) return "禁止访问本地/内网地址";
    }
    if (/^0x[0-9a-f]+$/i.test(host)) {
      try {
        const n = parseInt(host, 16);
        const ipv4 = `${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`;
        if (/^(127|10|192\.168|169\.254|172\.(1[6-9]|2\d|3[01])|0)\./.test(ipv4)) return "禁止访问本地/内网地址";
      } catch {}
    }
    if (/^(\d{1,3})(\.\d{1,3}){0,2}$/.test(host) && !/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      // 127.1、10.1 等缩写形式
      const parts = host.split(".").map(Number);
      if (parts[0] === 127 || parts[0] === 10 || parts[0] === 0) return "禁止访问本地/内网地址";
    }
    if (host.endsWith(".nip.io") || host.endsWith(".sslip.io")) return "禁止访问可能解析到内网的域名";

    // 常见云元数据域名
    if (/metadata\.google\.internal$/i.test(host) || host.includes("metadata.google.internal") || host.endsWith(".internal")) return "禁止访问云元数据/内部域名";
    return null;
  } catch {
    return "URL 格式错误";
  }
}

// 带 SSRF 防护的 fetch：手动跟随重定向，每次跳转都重新校验目标地址。
export async function guardedFetch(input: string, init: Parameters<typeof fetch>[1] = {}, maxRedirects = 5): Promise<Response> {
  let current = new URL(input).toString();
  for (let i = 0; i <= maxRedirects; i++) {
    const blocked = blockedUrlReason(current);
    if (blocked) throw new Error(`禁止访问：${blocked}`);
    const resp = await fetch(current, { ...init, redirect: "manual" });
    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get("location");
      if (!location) return resp;
      const next = new URL(location, current).toString();
      const nextBlocked = blockedUrlReason(next);
      if (nextBlocked) throw new Error(`重定向目标被拦截：${nextBlocked}`);
      current = next;
      continue;
    }
    return resp;
  }
  throw new Error("重定向次数过多");
}
