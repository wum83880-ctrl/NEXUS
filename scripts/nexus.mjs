#!/usr/bin/env node
/**
 * NEXUS 项目命令行工具
 *
 * 用法：
 *   nexus setup   # 安装依赖 + 初始化数据库 + 生成 .env
 *   nexus web     # 一键启动 Web(3000) + Stream(3003)，首次会自动 setup
 *   nexus clean   # 清理 node_modules / .next 等可再生成的大文件
 *   nexus doctor  # 检查环境与项目体积
 *   nexus help
 *
 * 跨平台：Windows 使用 nexus.cmd，Linux/macOS 使用 ./nexus。
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import os from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const streamDir = join(root, "mini-services", "nexus-stream");
const envPath = join(root, ".env");
const envExamplePath = join(root, ".env.example");
const dbDir = join(root, "db");
const dbPath = join(dbDir, "custom.db");

function log(...args) {
  console.log("[nexus]", ...args);
}

function error(...args) {
  console.error("[nexus][错误]", ...args);
}

function isWindows() {
  return process.platform === "win32";
}

function commandExists(cmd) {
  const probe = isWindows() ? "where" : "which";
  const r = spawnSync(probe, [cmd], { stdio: "ignore", shell: false });
  return r.status === 0;
}

function hasNodeModules(dir) {
  return existsSync(join(dir, "node_modules"));
}

function getPackageManager() {
  if (commandExists("bun")) return "bun";
  if (commandExists("npm")) return "npm";
  return null;
}

function run(cmd, args, opts = {}) {
  log(`$ ${cmd} ${args.join(" ")}`);
  // Windows 上 npm 是 .cmd 批处理，shell:false 无法直接 spawn，需要 shell:true
  const needShell = isWindows() && /^(npm|npx|bunx)(\.cmd)?$/i.test(cmd);
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd || root,
    stdio: "inherit",
    shell: needShell,
    env: { ...process.env, ...(opts.env || {}) },
  });
  if (r.status !== 0) {
    error(`命令失败: ${cmd} ${args.join(" ")}`);
    process.exit(r.status ?? 1);
  }
}

function ensureEnv() {
  if (existsSync(envPath)) return;

  mkdirSync(dbDir, { recursive: true });
  const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;
  writeFileSync(envPath, `DATABASE_URL=${dbUrl}\n`, "utf8");
  log(`已生成 .env: DATABASE_URL=${dbUrl}`);

  if (!existsSync(envExamplePath)) {
    writeFileSync(
      envExamplePath,
      "# 复制为 .env 后按需修改。setup 会自动生成绝对路径版本。\nDATABASE_URL=file:../db/custom.db\n",
      "utf8",
    );
  }
}

function ensureDb() {
  mkdirSync(dbDir, { recursive: true });
  const pm = getPackageManager();
  if (!pm) {
    error("未找到 bun 或 npm，请先安装 Node.js 环境。");
    process.exit(1);
  }
  const prismaCmd = pm === "bun" ? "bunx" : "npx";
  run(prismaCmd, ["prisma", "db", "push", "--accept-data-loss"]);
}

function installDeps() {
  const pm = getPackageManager();
  if (!pm) {
    error("未找到 bun 或 npm，请先安装 Node.js 环境。");
    process.exit(1);
  }

  log("安装主项目依赖...");
  run(pm, ["install"], { cwd: root });

  log("安装 mini-services/nexus-stream 依赖...");
  if (existsSync(streamDir)) {
    run(pm, ["install"], { cwd: streamDir });
  }
}

function setup() {
  log("开始配置 NEXUS 环境...");
  ensureEnv();
  installDeps();
  ensureDb();
  // 预编译 stream 服务（node 直跑，运行时不依赖 bun）
  log("编译 stream 服务...");
  buildStream();
  log("环境配置完成。运行 `nexus web` 启动。");
}

let pmCache;
function pmOf() {
  if (pmCache) return pmCache;
  pmCache = getPackageManager();
  return pmCache;
}
function prismaOrNx(pm) { return pm === "bun" ? "bunx" : "npx"; }

// 用项目自带的 typescript 编译 stream 服务 + 别名改写，产物到 mini-services/nexus-stream/dist
function buildStream() {
  const fs = fsMod();
  const outDir = join(streamDir, "dist");
  fs.mkdirSync(outDir, { recursive: true });
  const tsconfig = {
    compilerOptions: {
      target: "ES2022", module: "commonjs", moduleResolution: "node",
      esModuleInterop: true, skipLibCheck: true, strict: false,
      outDir, rootDir: root,
      resolveJsonModule: true,
      baseUrl: root,
      paths: { "@/*": ["./src/*"] },
    },
    include: [
      "mini-services/nexus-stream/index.ts",
      "src/lib/nexus/**/*.ts",
      "src/lib/db.ts",
      "src/lib/utils.ts",
    ],
  };
  // 临时目录里的 tsconfig 无法用相对 include，改为绝对路径
  tsconfig.include = tsconfig.include.map((p) => join(root, p));
  tsconfig.compilerOptions.baseUrl = root;
  // tsconfig 写到系统临时目录，避免每次 setup 在项目根残留 tsconfig.stream.json
  const cfgPath = join(os.tmpdir(), `nexus-stream-tsconfig-${Date.now()}.json`);
  fs.writeFileSync(cfgPath, JSON.stringify(tsconfig, null, 2), "utf8");
  try {
    run(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", cfgPath], { cwd: root });
  } finally {
    fs.rmSync(cfgPath, { force: true });
  }
  // @/ 别名 → 相对路径改写
  rewriteAliases(outDir);
  // type:commonjs 标记
  fs.writeFileSync(join(outDir, "package.json"), '{ "type": "commonjs" }\n', "utf8");
  log("stream 编译完成:", outDir);
}

function fsMod() { return fsModule; }

// ESM 顶层不能用 require：用 createRequire 桥接（buildStream/rewriteAliases 用）
import { createRequire } from "node:module";
const nodeRequire = createRequire(import.meta.url);
function requireMod(id) { return nodeRequire(id); }
const fsModule = nodeRequire("node:fs");

function rewriteAliases(dir) {
  const path = requireMod("node:path");
  // dist 布局：<dist>/mini-services/nexus-stream/index.js 与 <dist>/src/lib/nexus/*.js
  // index.js 相对 src 应为 ../../../src/...（三层），而非五层
  const distSrc = join(dir, "src");
  const fs = fsMod();
  let count = 0;
  function walk(d) {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) { walk(p); continue; }
      if (!f.name.endsWith(".js")) continue;
      let src = fs.readFileSync(p, "utf8");
      const replaced = src.replace(/require\("@\/([^"]+)"\)/g, (m, p1) => {
        count++;
        const target = path.join(distSrc, p1);
        let rel = path.relative(path.dirname(p), target).replace(/\\/g, "/");
        if (!rel.startsWith(".")) rel = "./" + rel;
        return 'require("' + rel + '")';
      });
      if (replaced !== src) fs.writeFileSync(p, replaced, "utf8");
    }
  }
  walk(dir);
  log(`别名改写: ${count} 处`);
}

function startChild(cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    cwd: opts.cwd || root,
    stdio: "inherit",
    shell: false,
    env: { ...process.env, ...(opts.env || {}) },
  });
  child.on("error", (err) => {
    error(`子进程启动失败: ${err.message}`);
    // 启动失败（如 ENOENT：bun 未安装）不能静默继续：提示用户
    if (err.code === "ENOENT") {
      error(`命令不存在: ${cmd}。请安装对应运行时，或先运行 ` + "nexus setup" + ` 生成编译产物。`);
    }
  });
  // 子进程崩溃感知：不复位会让 Web 照常起来但聊天静默不可用
  child.on("exit", (code, signal) => {
    if (code !== 0 && code !== null && !shuttingDownRef.current) {
      error(`子进程退出: ${cmd} ${args.join(" ")} (code=${code ?? "null"} signal=${signal ?? "none"})`);
      shutdown(signal || "SIGTERM");
    }
  });
  return child;
}

let shuttingDownRef = { current: false };

function web() {
  const pm = getPackageManager();
  if (!pm) {
    error("未找到 bun 或 npm。");
    process.exit(1);
  }

  ensureEnv();

  if (!hasNodeModules(root) || !hasNodeModules(streamDir)) {
    log("检测到依赖未安装，先执行 setup...");
    installDeps();
    ensureDb();
    // 依赖就绪后必须编译 stream 产物：无 bun 时 web 启动依赖 dist 直跑 node，
    // 缺这一步会导致聊天功能静默不可用
    buildStream();
  } else if (!existsSync(dbPath)) {
    log("数据库不存在，初始化...");
    ensureDb();
  }

  const children = [];

  const shutdown = (signal) => {
    if (shuttingDownRef.current) return;
    shuttingDownRef.current = true;
    log(`收到 ${signal}，正在关闭服务...`);
    for (const child of children) {
      try {
        if (isWindows()) {
          spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        } else {
          child.kill(signal || "SIGTERM");
        }
      } catch {
        // ignore
      }
    }
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // 端口冲突预检（同步探测）：3003（stream）/3000（web）被占用时给出明确提示
  const portInUseSync = (port) => {
    const probe = process.execPath;
    const code = `const s=require('net').connect({port:${port},host:'127.0.0.1'});s.once('connect',()=>{console.log('BUSY');process.exit(0)});s.once('error',()=>{console.log('FREE');process.exit(0)});s.setTimeout(800,()=>{console.log('FREE');process.exit(0)});`;
    const r = spawnSync(probe, ["-e", code], { timeout: 2000, stdio: ["ignore", "pipe", "ignore"] });
    return (r.stdout || "").toString().includes("BUSY");
  };
  if (portInUseSync(3003)) {
    error("端口 3003 已被占用（可能是已有 NEXUS 或其它服务在运行）。请先停止旧实例，或设置 NEXUS_FORCE=1 强制继续（将无法连接聊天流）。");
    if (!process.env.NEXUS_FORCE) process.exit(1);
  }
  if (portInUseSync(3000)) {
    error("端口 3000 已被占用，Web 服务将无法绑定。请先停止占用 3000 的进程，或设置 NEXUS_FORCE=1 强制继续。");
    if (!process.env.NEXUS_FORCE) process.exit(1);
  }

  log("启动 Stream 服务 (port 3003)...");
  // stream 服务用 node 直接跑编译产物（不依赖 bun）；无产物时回退 bun --hot 源码
  // 崩溃自动重启（最多 5 次，指数退避），避免前端永久"已断开"
  const distIndex = join(streamDir, "dist", "mini-services", "nexus-stream", "index.js");
  const startStreamOnce = () => {
    const child = existsSync(distIndex)
      ? startChild(process.execPath, [distIndex], { cwd: root, env: { NEXUS_WORKSPACE: root, NEXUS_BIND: process.env.NEXUS_BIND || "" } })
      : startChild("bun", ["index.ts"], { cwd: streamDir, env: { NEXUS_WORKSPACE: root, NEXUS_BIND: process.env.NEXUS_BIND || "" } });
    children.push(child);
    return child;
  };
  let streamRestarts = 0;
  const streamChild = startStreamOnce();
  streamChild.on("exit", (code) => {
    if (shuttingDownRef.current) return;
    if (streamRestarts < 5) {
      streamRestarts++;
      const delay = streamRestarts * 1500;
      log(`stream 服务退出 (code=${code ?? "null"})，${delay / 1000}s 后自动重启 (${streamRestarts}/5)...`);
      setTimeout(() => { if (!shuttingDownRef.current) { const nc = startStreamOnce(); nc.on("exit", arguments.callee); } }, delay);
    } else {
      error("stream 服务连续崩溃 5 次，已停止自动重启。请检查 mini-services/nexus-stream 或重新运行 nexus setup。");
    }
  });

  log("启动 Web 服务 (http://localhost:3000)...");
  // Web 服务：bun 存在用 bun run dev，否则直接 node 跑 next dev
  if (pm === "bun") {
    children.push(startChild("bun", ["run", "dev"], { cwd: root }));
  } else {
    children.push(startChild(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "-p", "3000"], { cwd: root }));
  }

  // 等服务就绪后自动打开浏览器（只打开一次，防止重复弹窗）
  let browserOpened = false;
  const openBrowser = () => {
    if (browserOpened) return;
    browserOpened = true;
    const url = "http://localhost:3000";
    log(`正在打开浏览器: ${url}`);
    try {
      if (isWindows()) {
        // Start-Process 单参数语义稳定；cmd start 在部分环境下会把 URL 拆参弹多窗
        spawn("powershell", ["-NoProfile", "-Command", `Start-Process '${url}'`], { detached: true, stdio: "ignore" }).unref();
      } else {
        spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
      }
    } catch { /* 打不开就让用户手动访问 */ }
  };
  const waitReady = setInterval(() => {
    fetch("http://localhost:3000").then((r) => {
      if (r.ok || r.status < 500) {
        clearInterval(waitReady);
        clearTimeout(giveUp);
        openBrowser();
      }
    }).catch(() => {});
  }, 1000);
  // 最多等 60 秒
  const giveUp = setTimeout(() => clearInterval(waitReady), 60000);

  log("NEXUS 已启动。Ctrl+C 停止。");
}

function confirmDelete(paths) {
  return new Promise((resolvePromise) => {
    console.log("将删除以下可再生成目录/文件：");
    for (const p of paths) {
      console.log(`  - ${p}`);
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("确认删除？(y/N) ", (ans) => {
      rl.close();
      resolvePromise(ans.trim().toLowerCase() === "y");
    });
  });
}

async function clean() {
  const targets = [
    join(root, "node_modules"),
    join(root, ".next"),
    join(root, "out"),
    join(root, "build"),
    join(root, "dev.log"),
    join(root, "server.log"),
    join(root, "*.tsbuildinfo"),
    join(streamDir, "node_modules"),
  ];

  const existing = targets.filter((p) => p.includes("*") ? false : existsSync(p));
  const globPatterns = targets.filter((p) => p.includes("*"));

  if (globPatterns.length > 0) {
    const { readdirSync } = await import("node:fs");
    const files = readdirSync(root).filter((f) => f.endsWith(".tsbuildinfo"));
    for (const f of files) existing.push(join(root, f));
  }

  if (existing.length === 0) {
    log("没有需要清理的大文件/缓存。");
    return;
  }

  const ok = await confirmDelete(existing);
  if (!ok) {
    log("已取消。");
    return;
  }

  for (const p of existing) {
    log(`删除 ${p}`);
    rmSync(p, { recursive: true, force: true });
  }

  log("清理完成。可运行 `nexus setup` 重新安装依赖。");
}

function formatMB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function doctor() {
  const { readdirSync, statSync } = await import("node:fs");
  const sizes = {
    "node_modules": 0,
    ".next": 0,
    "mini-services/nexus-stream/node_modules": 0,
    ".git": 0,
    db: 0,
  };

  for (const key of Object.keys(sizes)) {
    const p = join(root, key);
    if (!existsSync(p)) continue;
    let total = 0;
    const walk = (dir) => {
      let names;
      try {
        names = readdirSync(dir);
      } catch {
        return; // 权限受限/被占用目录：跳过而不是让 doctor 崩溃
      }
      for (const name of names) {
        const full = join(dir, name);
        let st;
        try {
          st = statSync(full);
        } catch {
          continue;
        }
        if (st.isDirectory()) walk(full);
        else total += st.size;
      }
    };
    walk(p);
    sizes[key] = total;
  }

  console.log("=== NEXUS Doctor ===");
  console.log(`Node: ${process.version}`);
  console.log(`Bun:  ${commandExists("bun") ? "已安装" : "未安装"}`);
  console.log(`Npm:  ${commandExists("npm") ? "已安装" : "未安装"}`);
  console.log(`.env: ${existsSync(envPath) ? "存在" : "缺失 (运行 nexus setup)"}`);
  console.log(`db:   ${existsSync(dbPath) ? "存在" : "缺失 (运行 nexus setup)"}`);
  console.log("");
  console.log("目录体积：");
  for (const [key, bytes] of Object.entries(sizes)) {
    if (bytes > 0) console.log(`  ${key.padEnd(40)} ${formatMB(bytes)}`);
  }
  const total = Object.values(sizes).reduce((a, b) => a + b, 0);
  console.log(`  ${"以上合计".padEnd(40)} ${formatMB(total)}`);
  console.log("");
  console.log("提示：node_modules 和 .next 都是可再生成的，空间紧张可运行 `nexus clean`。");
}

function help() {
  console.log(`
NEXUS 命令行工具

用法:
  nexus setup   安装依赖、初始化数据库、生成 .env
  nexus web     一键启动 Web + Stream（首次自动 setup）
  nexus clean   清理 node_modules / .next 等大文件
  nexus doctor  检查环境与项目体积
  nexus help    显示帮助

Windows 示例:
  nexus web

Linux/macOS 示例:
  ./nexus web
`);
}

const cmd = process.argv[2] || "help";

switch (cmd) {
  case "setup":
    setup();
    break;
  case "web":
    web();
    break;
  case "clean":
    await clean();
    break;
  case "doctor":
    await doctor();
    break;
  case "help":
  case "--help":
  case "-h":
    help();
    break;
  default:
    error(`未知命令: ${cmd}`);
    help();
    process.exit(1);
}
