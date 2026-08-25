import { NextRequest, NextResponse } from "next/server";
import { getSettings, saveSettings, sanitizeSettings } from "@/lib/nexus/settings";
export async function GET() { return NextResponse.json({ settings: sanitizeSettings(await getSettings()) }); }
export async function PATCH(req: NextRequest) { return NextResponse.json({ settings: sanitizeSettings(await saveSettings(await req.json().catch(() => ({})))) }); }
