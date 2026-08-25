// NEXUS 快照与回溯：每个阶段保存状态 + 项目文件备份，支持恢复到任意快照。
import { promises as fs } from "fs";
import path from "path";
import { db } from "@/lib/db";
import { getEvents } from "./events";

const SNAPSHOT_ROOT = path.join(process.cwd(), ".nexus", "snapshots");

// 备份时排除的大目录/文件
const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  ".nexus",
  "db",
  "download",
  "out",
  "build",
  ".turbo",
  ".cache",
]);

const EXCLUDE_FILES = new Set([
  "dev.log",
  "server.log",
  "bun.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  "custom.db",
]);

export interface CreateSnapshotInput {
  sessionId?: string;
  roomId?: string;
  label?: string;
  reason?: string;
  turn?: number;
  eventSeq?: number;
}

// ── 智能快照策略 ─────────────────────────────────────────────
const KEEP_BEFORE_TOOL = 5;

async function pruneAutoSnapshots(sessionId: string): Promise<number> {
  try {
    const autos = await db.snapshot.findMany({
      where: { sessionId, reason: "before_tool" },
      orderBy: { createdAt: "desc" },
      select: { id: true, fileBackupPath: true },
    });
    const stale = autos.slice(KEEP_BEFORE_TOOL);
    for (const s of stale) {
      if (s.fileBackupPath) await fs.rm(s.fileBackupPath, { recursive: true, force: true }).catch(() => {});
      await db.snapshot.delete({ where: { id: s.id } }).catch(() => {});
    }
    return stale.length;
  } catch {
    return 0;
  }
}

// 自动摘要标签
function autoLabel(input: CreateSnapshotInput, eventCount: number, fileCount: number): string {
  if (input.label && input.label !== "快照") return input.label;
  const reasonText: Record<string, string> = {
    manual: "手动快照",
    before_tool: "工具执行前",
    before_rewind: "回溯前保护",
    before_restore: "恢复前保护",
  };
  const base = reasonText[input.reason || "manual"] || "自动快照";
  const parts = [base];
  if (input.turn != null && input.turn > 0) parts.push(`第${input.turn}轮`);
  parts.push(`${eventCount}事件·${fileCount}文件`);
  return parts.join(" · ");
}

// 恢复点推荐：按新鲜度(40)/信息量(30)/意图(30)加权打分
export async function recommendSnapshot(sessionId: string): Promise<{ id: string; label: string; score: number; reason: string } | null> {
  const rows = await db.snapshot.findMany({ where: { sessionId }, orderBy: { createdAt: "desc" }, take: 50 });
  if (rows.length === 0) return null;
  const now = Date.now();
  let best: { id: string; label: string; score: number; reason: string } | null = null;
  for (const r of rows) {
    const ageH = (now - r.createdAt.getTime()) / 3600_000;
    const timeScore = Math.max(0, 40 * (1 - ageH / 24));
    const seqScore = Math.min(30, ((r.eventSeq ?? 0) / 1000) * 30);
    const intentScore = r.reason === "manual" ? 30 : (r.reason === "before_rewind" || r.reason === "before_restore") ? 15 : 5;
    const score = timeScore + seqScore + intentScore;
    if (!best || score > best.score) {
      best = {
        id: r.id,
        label: r.label,
        score: Math.round(score * 10) / 10,
        reason: r.reason === "manual"
          ? "你手动创建的检查点，意图最明确"
          : r.reason.startsWith("before_")
            ? "系统保护点，可安全往返"
            : "自动工具前快照",
      };
    }
  }
  return best;
}

export async function createSnapshot(input: CreateSnapshotInput = {}): Promise<any> {
  // 自动记录快照时刻的事件游标与轮次：恢复时据此真实回滚会话事件
  let eventSeq = input.eventSeq ?? null;
  let turn = input.turn ?? null;
  if (input.sessionId) {
    const lastEvent = await db.sessionEvent.findFirst({
      where: { sessionId: input.sessionId },
      orderBy: { seq: "desc" },
      select: { seq: true, data: true },
    }).catch(() => null);
    if (lastEvent) {
      if (eventSeq == null) eventSeq = lastEvent.seq;
      if (turn == null) {
        try { turn = JSON.parse(lastEvent.data)?.turn ?? null; } catch {}
      }
    }
  }

  const row = await db.snapshot.create({
    data: {
      sessionId: input.sessionId || null,
      roomId: input.roomId || null,
      label: input.label || "快照",
      reason: input.reason || "manual",
      turn,
      eventSeq,
      data: "{}",
    },
  });

  let data: Record<string, any> = {};

  if (input.sessionId) {
    try {
      const events = await getEvents(input.sessionId);
      const decisions = await db.decision.findMany({
        where: { sessionId: input.sessionId },
        orderBy: { turn: "asc" },
      });
      data = {
        sessionId: input.sessionId,
        eventCount: events.length,
        events: events.map((e) => ({
          seq: e.seq,
          type: e.type,
          data: e.data,
          createdAt: e.createdAt,
        })),
        // 逐条容错：单条决策的 toolCalls 坏 JSON 只丢弃该条字段，绝不让整个快照捕获失败
        decisions: decisions.map((d) => ({
          id: d.id,
          turn: d.turn,
          provider: d.provider,
          model: d.model,
          protocol: d.protocol,
          thinking: d.thinking,
          hasToolCalls: d.hasToolCalls,
          toolCalls: (() => { try { return JSON.parse(d.toolCalls || "[]"); } catch { return []; } })(),
          contextSummary: d.contextSummary,
          durationMs: d.durationMs,
          inputTokens: d.inputTokens,
          outputTokens: d.outputTokens,
          createdAt: d.createdAt.toISOString(),
        })),
      };
    } catch {
      // 快照不因单次读取失败而中断
    }
  }

  const backupDir = path.join(SNAPSHOT_ROOT, row.id, "files");
  let fileCount = 0;
  try {
    await fs.mkdir(backupDir, { recursive: true });
    const manifest: string[] = [];
    fileCount = await copyProjectFiles(process.cwd(), backupDir, manifest);
    await fs.writeFile(path.join(SNAPSHOT_ROOT, row.id, "manifest.json"), JSON.stringify(manifest), "utf-8");
  } catch {
    // 文件备份失败不影响数据库快照
  }
  data.fileCount = fileCount;

  const finalLabel = autoLabel({ ...input, label: input.label || "快照" }, (data as any).eventCount ?? 0, fileCount);
  // 完整性校验：一个文件都没拷进去 → 备份失败，不留假备份
  const fileBackupPath = fileCount > 0 ? path.join(SNAPSHOT_ROOT, row.id) : null;
  await db.snapshot.update({
    where: { id: row.id },
    data: { data: JSON.stringify(data), fileBackupPath, label: finalLabel },
  });

  // before_tool 快照滚动清理
  if (input.sessionId && input.reason === "before_tool") {
    await pruneAutoSnapshots(input.sessionId);
  }

  return {
    id: row.id,
    sessionId: row.sessionId,
    roomId: row.roomId,
    label: finalLabel,
    reason: row.reason,
    turn: row.turn,
    eventSeq: row.eventSeq,
    data,
    fileBackupPath,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listSnapshots(filter?: { sessionId?: string; roomId?: string }) {
  const rows = await db.snapshot.findMany({
    where: {
      ...(filter?.sessionId ? { sessionId: filter.sessionId } : {}),
      ...(filter?.roomId ? { roomId: filter.roomId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map((r) => {
    // 深度信息：事件数/文件数/决策数来自快照 blob（解析失败静默为 0）
    let eventCount = 0, fileCount = 0, decisionCount = 0;
    try {
      const blob = JSON.parse(r.data || "{}");
      if (Array.isArray(blob?.events)) eventCount = blob.events.length;
      if (Array.isArray(blob?.decisions)) decisionCount = blob.decisions.length;
      fileCount = Number(blob?.fileCount) || 0;
    } catch {}
    return {
      id: r.id,
      sessionId: r.sessionId,
      roomId: r.roomId,
      label: r.label,
      reason: r.reason,
      turn: r.turn,
      eventSeq: r.eventSeq,
      eventCount,
      decisionCount,
      fileCount,
      fileBackupPath: r.fileBackupPath,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

export async function restoreSnapshot(id: string, opts: { pruneFiles?: boolean } = {}) {
  const row = await db.snapshot.findUnique({ where: { id } });
  if (!row) throw new Error("快照不存在");

  // 0) 先对当前状态做保护性快照：误恢复后可用它把状态"向前"补回（双向恢复）
  let guardSnapshotId: string | null = null;
  if (row.sessionId) {
    try {
      const guard = await createSnapshot({
        sessionId: row.sessionId,
        label: `恢复前 · ${row.label}`,
        reason: "before_restore",
      });
      guardSnapshotId = guard.id;
    } catch {
      // 保护快照失败不阻断恢复（DB 快照行仍会写入），但响应里如实反馈
    }
  }

  // 旧格式快照没记录 eventSeq/turn → 从 data blob 内嵌的事件/决策列表恢复游标
  let eventSeq = row.eventSeq ?? null;
  let turn = row.turn ?? null;
  let blobEvents: any[] = [];
  let blobDecisions: any[] = [];
  if (row.data && row.data !== "{}") {
    try {
      const blob = JSON.parse(row.data);
      blobEvents = Array.isArray(blob?.events) ? blob.events : [];
      blobDecisions = Array.isArray(blob?.decisions) ? blob.decisions : [];
      if (eventSeq == null && blobEvents.length) {
        eventSeq = blobEvents.reduce((mx: number, e: any) => Math.max(mx, Number(e?.seq) || 0), 0);
      }
      if (turn == null && blobDecisions.length) {
        turn = blobDecisions.reduce((mx: number, d: any) => Math.max(mx, Number(d?.turn) || 0), 0);
      }
    } catch {}
  }

  // 1) 双向回滚/回补会话事件与决策到快照时刻：
  //    快照比当前新（如恢复 rewind 前的保护快照）→ 把缺失事件/决策回插；
  //    快照比当前旧 → 删除其后的事件/决策（与旧行为一致）。
  let rolledBackEvents = 0;
  let restoredEvents = 0;
  let rolledBackDecisions = 0;
  let restoredDecisions = 0;
  if (row.sessionId && eventSeq != null) {
    // 事件与决策的回滚/回补放同一事务：中途失败整体回滚，避免留下半恢复状态。
    // （并发写入撞 @@unique([sessionId,seq]) 时事务重试由 Prisma 层处理，失败则整体回滚。）
    await db.$transaction(async (tx) => {
      const currentMax = (await tx.sessionEvent.findFirst({
        where: { sessionId: row.sessionId! },
        orderBy: { seq: "desc" },
        select: { seq: true },
      }))?.seq ?? 0;

      if (blobEvents.length > 0 && eventSeq > currentMax) {
        const toInsert: any[] = blobEvents
          .filter((e: any) => e && Number.isInteger(Number(e?.seq)) && Number(e.seq) > currentMax && Number(e.seq) <= eventSeq)
          .map((e: any) => ({
            sessionId: row.sessionId!,
            seq: Number(e.seq),
            type: String(e?.type || "assistant/message"),
            data: JSON.stringify(e?.data ?? {}),
          }));
        if (toInsert.length) {
          // 注：SQLite 的 Prisma createMany 不支持 skipDuplicates；过滤已保证 seq > currentMax
          await tx.sessionEvent.createMany({ data: toInsert });
          restoredEvents = toInsert.length;
        }
      } else if (eventSeq < currentMax) {
        const del = await tx.sessionEvent.deleteMany({
          where: { sessionId: row.sessionId!, seq: { gt: eventSeq } },
        });
        rolledBackEvents = del.count;
      }
      // eventSeq === currentMax：已处于目标状态，无需改动

      if (blobDecisions.length > 0) {
        // 决策没有可靠的 seq 锚点，用快照内嵌清单整体替换最准确
        const removed = await tx.decision.deleteMany({ where: { sessionId: row.sessionId! } });
        rolledBackDecisions = removed.count;
        const toCreate: any[] = blobDecisions
          .filter((d: any) => d && d.id)
          .map((d: any) => ({
            id: String(d.id),
            sessionId: row.sessionId!,
            turn: Number(d.turn) || 0,
            provider: String(d.provider || ""),
            model: String(d.model || ""),
            protocol: d.protocol === "text" ? "text" : "native",
            thinking: String(d.thinking ?? ""),
            hasToolCalls: !!d.hasToolCalls,
            toolCalls: JSON.stringify(Array.isArray(d.toolCalls) ? d.toolCalls : []),
            contextSummary: String(d.contextSummary ?? ""),
            durationMs: Number(d.durationMs) || 0,
            // 保留快照时刻的时间戳，避免恢复后决策列表时间全部变成恢复时刻
            ...(d.createdAt ? { createdAt: new Date(String(d.createdAt)) } : {}),
          }));
        if (toCreate.length) {
          await tx.decision.createMany({ data: toCreate });
          restoredDecisions = toCreate.length;
        }
      } else if (turn != null) {
        const delD = await tx.decision.deleteMany({
          where: { sessionId: row.sessionId!, turn: { gt: turn } },
        });
        rolledBackDecisions = delD.count;
      }
    });
  }

  // 2) 回滚项目文件；pruneFiles=true 时同时删除快照之后新增的文件（真·回退）
  let restoredFiles = 0;
  let prunedFiles = 0;
  let fileRestoreBlocked: string | null = null;
  if (row.fileBackupPath) {
    const backupDir = path.join(row.fileBackupPath, "files");
    try {
      const stat = await fs.stat(backupDir);
      if (stat.isDirectory()) {
        restoredFiles = await restoreProjectFiles(backupDir, process.cwd());
      } else {
        fileRestoreBlocked = "快照文件备份数据不完整（files 不是目录）";
      }
    } catch {
      fileRestoreBlocked = "快照的文件备份已被删除或不存在（.nexus/snapshots 目录被清理），只能恢复会话事件，项目文件无法回滚";
    }
    if (opts.pruneFiles && fileRestoreBlocked) {
      throw new Error(`无法执行"删除新增文件"：${fileRestoreBlocked}`);
    }
    if (opts.pruneFiles) {
      // 清单缺失/损坏时拒绝 prune，避免"删光项目文件"灾难
      const manifestRaw = await fs.readFile(path.join(row.fileBackupPath, "manifest.json"), "utf-8").catch(() => null);
      if (manifestRaw == null) throw new Error("无法读取快照文件清单，已中止删除新增文件（pruneFiles）");
      let parsed: any;
      try { parsed = JSON.parse(manifestRaw); } catch { throw new Error("快照文件清单损坏，已中止删除新增文件（pruneFiles）"); }
      if (!Array.isArray(parsed)) throw new Error("快照文件清单格式错误，已中止删除新增文件（pruneFiles）");
      prunedFiles = await pruneUntrackedFiles(process.cwd(), new Set<string>(parsed));
    }
  }

  // 3) 诚实反馈：什么都没恢复 → 明确失败，避免"显示成功实际没动"
  if (rolledBackEvents === 0 && rolledBackDecisions === 0 && restoredEvents === 0 && restoredDecisions === 0 && restoredFiles === 0 && prunedFiles === 0) {
    if (fileRestoreBlocked) {
      if (eventSeq == null || eventSeq >= ((await db.sessionEvent.findFirst({ where: { sessionId: row.sessionId! }, orderBy: { seq: "desc" }, select: { seq: true } }))?.seq ?? 0)) {
        throw new Error(`该快照已不可恢复：${fileRestoreBlocked}，且会话事件无需回滚`);
      }
    }
    if (eventSeq == null && !row.fileBackupPath) {
      throw new Error("该快照无可恢复内容（无事件游标、无文件备份）");
    }
    const eventNote = eventSeq == null ? "该快照未记录事件游标，会话事件未回滚（仅文件已恢复）" : null;
    return { ok: true, id: row.id, rolledBackEvents, rolledBackDecisions, restoredEvents, restoredDecisions, restoredFiles, prunedFiles, guardSnapshotId, note: fileRestoreBlocked ?? eventNote ?? "会话已处于该快照时刻的状态", fileRestoreBlocked };
  }

  return { ok: true, id: row.id, rolledBackEvents, rolledBackDecisions, restoredEvents, restoredDecisions, restoredFiles, prunedFiles, guardSnapshotId, ...(fileRestoreBlocked ? { fileRestoreBlocked } : {}) };
}

// 列出快照备份中的文件（来自 manifest，与备份同步）
export async function listSnapshotFiles(id: string): Promise<string[]> {
  const row = await db.snapshot.findUnique({ where: { id } });
  if (!row?.fileBackupPath) return [];
  const manifestRaw = await fs.readFile(path.join(row.fileBackupPath, "manifest.json"), "utf-8").catch(() => null);
  if (manifestRaw == null) return [];
  try {
    const parsed = JSON.parse(manifestRaw);
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}

// 单文件恢复：从快照备份把指定文件拷回工作区（路径必须是清单内的相对路径，防越界）
export async function restoreSnapshotFile(id: string, relPath: string): Promise<{ ok: boolean; error?: string; path?: string }> {
  const row = await db.snapshot.findUnique({ where: { id } });
  if (!row?.fileBackupPath) return { ok: false, error: "快照没有文件备份" };
  const rel = String(relPath || "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!rel || rel.includes("..")) return { ok: false, error: "非法路径" };
  const src = path.join(row.fileBackupPath, "files", ...rel.split("/"));
  const dest = path.join(process.cwd(), ...rel.split("/"));
  // 校验源文件确实存在于备份
  const srcStat = await fs.stat(src).catch(() => null);
  if (!srcStat || !srcStat.isFile()) return { ok: false, error: "备份中不存在该文件（清单可能已过期）" };
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(src, dest);
  return { ok: true, path: rel };
}

export async function deleteSnapshot(id: string) {
  const row = await db.snapshot.findUnique({ where: { id } });
  if (row?.fileBackupPath) {
    await fs.rm(row.fileBackupPath, { recursive: true, force: true }).catch(() => {});
  }
  await db.snapshot.delete({ where: { id } }).catch(() => {});
}

async function copyProjectFiles(srcDir: string, destDir: string, manifest: string[], rel = ""): Promise<number> {
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      await fs.mkdir(dest, { recursive: true });
      count += await copyProjectFiles(src, dest, manifest, relPath);
    } else if (entry.isFile()) {
      if (EXCLUDE_FILES.has(entry.name)) continue;
      await fs.copyFile(src, dest);
      manifest.push(relPath);
      count++;
    }
  }
  return count;
}

async function restoreProjectFiles(backupDir: string, destDir: string): Promise<number> {
  const entries = await fs.readdir(backupDir, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    const src = path.join(backupDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      await fs.mkdir(dest, { recursive: true });
      count += await restoreProjectFiles(src, dest);
    } else if (entry.isFile()) {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(src, dest);
      count++;
    }
  }
  return count;
}

// 删除快照备份中不存在（即快照之后新创建）的项目文件；排除目录与备份时一致
async function pruneUntrackedFiles(dir: string, manifest: Set<string>, rel = ""): Promise<number> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  let count = 0;
  for (const entry of entries) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      count += await pruneUntrackedFiles(full, manifest, relPath);
      // 目录清空后移除，保持树整洁
      const rest = await fs.readdir(full).catch(() => ["__keep__"]);
      if (rest.length === 0) await fs.rmdir(full).catch(() => {});
    } else if (entry.isFile()) {
      if (EXCLUDE_FILES.has(entry.name)) continue;
      if (!manifest.has(relPath)) {
        await fs.rm(full, { force: true }).catch(() => {});
        count++;
      }
    }
  }
  return count;
}
