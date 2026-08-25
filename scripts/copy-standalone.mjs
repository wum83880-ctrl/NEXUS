// 跨平台复制 Next standalone 所需的 static 和 public 文件。
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// 兼容 Node <20.11（import.meta.dirname 是 20.11 才有的）
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const staticSrc = resolve(root, ".next", "static");
const publicSrc = resolve(root, "public");
const standaloneNext = resolve(root, ".next", "standalone", ".next");
const standalonePublic = resolve(root, ".next", "standalone", "public");

if (existsSync(staticSrc)) {
  mkdirSync(standaloneNext, { recursive: true });
  cpSync(staticSrc, resolve(standaloneNext, "static"), { recursive: true });
  console.log("[copy-standalone] copied .next/static");
}

if (existsSync(publicSrc)) {
  mkdirSync(standalonePublic, { recursive: true });
  cpSync(publicSrc, standalonePublic, { recursive: true });
  console.log("[copy-standalone] copied public");
}
