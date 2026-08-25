// NEXUS memory store
import { db } from "@/lib/db";

export interface MemoryItem { id: string; namespace: string; key: string; value: string; pinned: boolean; createdAt: string; updatedAt: string; }

export async function listMemory(namespace?: string): Promise<MemoryItem[]> {
  const rows = await db.memory.findMany({ where: namespace ? { namespace } : undefined, orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }], take: 500 });
  return rows.map((r) => ({ id: r.id, namespace: r.namespace, key: r.key, value: r.value, pinned: r.pinned, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() }));
}

export async function saveMemory(namespace: string, key: string, value: string, pinned = false): Promise<MemoryItem> {
  const row = await db.memory.upsert({ where: { namespace_key: { namespace, key } }, update: { value, pinned }, create: { namespace, key, value, pinned } });
  return { id: row.id, namespace: row.namespace, key: row.key, value: row.value, pinned: row.pinned, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

export async function recallMemory(namespace: string, key?: string): Promise<MemoryItem[]> {
  const rows = await db.memory.findMany({ where: key ? { namespace, key } : { namespace }, orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }], take: 50 });
  return rows.map((r) => ({ id: r.id, namespace: r.namespace, key: r.key, value: r.value, pinned: r.pinned, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() }));
}

export async function deleteMemory(id: string): Promise<void> { await db.memory.delete({ where: { id } }).catch(() => {}); }
export async function toggleMemoryPin(id: string, pinned: boolean): Promise<void> { await db.memory.update({ where: { id }, data: { pinned } }).catch(() => {}); }
