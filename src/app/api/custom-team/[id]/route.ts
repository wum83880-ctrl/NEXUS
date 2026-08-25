import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

const SETTING_KEY = "custom_team";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await db.setting.findUnique({ where: { key: SETTING_KEY } });
  if (!row) return NextResponse.json({ ok: true });
  try {
    const list = JSON.parse(row.value);
    if (!Array.isArray(list)) return NextResponse.json({ ok: true });
    const next = list.filter((x: any) => x && x.id !== id);
    await db.setting.update({ where: { key: SETTING_KEY }, data: { value: JSON.stringify(next) } });
  } catch {}
  return NextResponse.json({ ok: true });
}
