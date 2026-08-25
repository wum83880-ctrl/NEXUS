import { NextRequest, NextResponse } from "next/server";
import { SKILLS, type Skill } from "@/lib/nexus/skills";
import { db } from "@/lib/db";

export async function GET() {
  try {
    const rows = await db.customSkill.findMany({ orderBy: { createdAt: "desc" } });
    const custom: Skill[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      icon: r.icon,
      description: r.description,
      category: r.category,
      prompt: r.prompt,
      suggestedTools: safeParse(r.suggestedTools),
      starter: r.starter,
    }));
    return NextResponse.json({ skills: [...SKILLS, ...custom] });
  } catch {
    return NextResponse.json({ skills: SKILLS });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!body.name || !body.prompt) {
    return NextResponse.json({ error: "缺少 name 或 prompt" }, { status: 400 });
  }
  const row = await db.customSkill.create({
    data: {
      name: String(body.name),
      icon: String(body.icon || "Sparkles"),
      description: String(body.description || ""),
      category: String(body.category || "通用"),
      prompt: String(body.prompt),
      suggestedTools: JSON.stringify(Array.isArray(body.suggestedTools) ? body.suggestedTools : []),
      starter: String(body.starter || ""),
    },
  });
  return NextResponse.json({
    skill: {
      id: row.id,
      name: row.name,
      icon: row.icon,
      description: row.description,
      category: row.category,
      prompt: row.prompt,
      suggestedTools: safeParse(row.suggestedTools),
      starter: row.starter,
    },
  });
}

function safeParse(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
