// 跨平台启动 Next standalone 服务（生产模式）。
// 生产环境同样需要 socket 流服务（:3003）：聊天/群聊全部依赖它。
// 优先用编译产物（node 直跑，无需 bun）；无产物且无 bun 时给出明确提示（否则聊天功能静默不可用）。
import { spawn, spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

// 兼容 Node <20.11（import.meta.dirname 是 20.11 才有的）
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = resolve(root, ".next", "standalone", "server.js");
const streamDir = resolve(root, "mini-services", "nexus-stream");
const distIndex = resolve(streamDir, "dist", "mini-services", "nexus-stream", "index.js");

const children = [];

// 1) socket 流服务（:3003，绑定 127.0.0.1）——优先编译产物
if (existsSync(distIndex)) {
  const stream = spawn(process.execPath, [distIndex], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, NEXUS_WORKSPACE: root },
  });
  children.push(stream);
  console.log("[start-standalone] stream 服务已启动 (dist 产物, :3003)");
} else {
  const bunCheck = spawnSync("bun", ["--version"], { stdio: "ignore" });
  if (bunCheck.status === 0) {
    const stream = spawn("bun", ["index.ts"], {
      cwd: streamDir,
      stdio: "inherit",
      env: { ...process.env, NEXUS_WORKSPACE: root },
    });
    children.push(stream);
    console.log("[start-standalone] stream 服务已启动 (bun 源码, :3003)");
  } else {
    console.error("[start-standalone] 警告：未找到 stream 编译产物且未安装 bun，聊天/群聊将不可用。");
    console.error("             请先运行 `node scripts/nexus.mjs setup` 生成编译产物，或安装 bun。");
  }
}

// 2) Next standalone 服务
const child = spawn(process.execPath, [serverPath], {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: process.env.PORT || "3000",
    HOSTNAME: process.env.HOSTNAME || "0.0.0.0",
  },
});
children.push(child);

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try { c.kill("SIGTERM"); } catch { /* ignore */ }
  }
  setTimeout(() => process.exit(code), 1500).unref();
}

for (const c of children) {
  c.on("exit", (code) => { if (!shuttingDown) shutdown(code ?? 1); });
  c.on("error", (err) => {
    console.error("[start-standalone] 子进程启动失败:", err.message);
    shutdown(1);
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
