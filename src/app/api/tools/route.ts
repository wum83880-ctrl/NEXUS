import { NextResponse } from "next/server";
import { TOOLS } from "@/lib/nexus/tools";
export async function GET() { return NextResponse.json({ tools: TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }); }
