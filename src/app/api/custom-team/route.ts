import { NextRequest, NextResponse } from "next/server";
import { TEAM, type TeamMember } from "@/lib/nexus/team";
import { db } from "@/lib/db";

const SETTING_KEY = "custom_team";

export async function GET() {
  try {
    const row = await db.setting.findUnique({ where: { key: SETTING_KEY } });
    let custom: TeamMember[] = [];
    if (row) {
      try {
        const parsed = JSON.parse(row.value);
        if (Array.isArray(parsed)) custom = parsed.filter((x) => x && x.id && x.name);
      } catch {}
    }
    return NextResponse.json({ team: [...TEAM, ...custom] });
  } catch {
    return NextResponse.json({ team: TEAM });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!body.name || !body.systemPrompt) {
    return NextResponse.json({ error: "缺少 name 或 systemPrompt" }, { status: 400 });
  }
  const member: TeamMember = {
    id: body.id || `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: String(body.name),
    icon: String(body.icon || "User"),
    role: String(body.role || "自定义角色"),
    description: String(body.description || ""),
    systemPrompt: String(body.systemPrompt),
    suggestedTools: Array.isArray(body.suggestedTools)
      ? body.suggestedTools.filter((x: any) => typeof x === "string")
      : [],
    color: String(body.color || "blue"),
  };

  const row = await db.setting.findUnique({ where: { key: SETTING_KEY } });
  let list: TeamMember[] = [];
  if (row) {
    try {
      const v = JSON.parse(row.value);
      if (Array.isArray(v)) list = v;
    } catch {}
  }
  list = [...list, member];
  await db.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value: JSON.stringify(list) },
    create: { key: SETTING_KEY, value: JSON.stringify(list) },
  });

  return NextResponse.json({ member });
}
