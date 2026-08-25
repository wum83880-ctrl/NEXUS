import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const data: any = {};
  if (typeof body.name === "string") data.name = body.name;
  if (typeof body.icon === "string") data.icon = body.icon;
  if (typeof body.description === "string") data.description = body.description;
  if (typeof body.category === "string") data.category = body.category;
  if (typeof body.prompt === "string") data.prompt = body.prompt;
  if (Array.isArray(body.suggestedTools)) data.suggestedTools = JSON.stringify(body.suggestedTools.filter((x: any) => typeof x === "string"));
  if (typeof body.starter === "string") data.starter = body.starter;
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "没有可更新字段" }, { status: 400 });
  const row = await db.customSkill.update({ where: { id }, data }).catch(() => null);
  if (!row) return NextResponse.json({ error: "技能不存在" }, { status: 404 });
  return NextResponse.json({ skill: row });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.customSkill.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
