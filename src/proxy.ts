import { NextResponse, type NextRequest } from "next/server";

// 基础防护：阻止跨站浏览器直接调用 /api。
// 本地 curl / 服务端调用不受影响（没有 Origin）。

// 轻量内存限流：同一 IP 每分钟最多 RATE_LIMIT 次 API 请求，防刷接口/费用滥用。
const RATE_LIMIT = 300;
const RATE_WINDOW_MS = 60_000;
const rateHits = new Map<string, number[]>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const arr = (rateHits.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_LIMIT) {
    rateHits.set(key, arr);
    return true;
  }
  arr.push(now);
  rateHits.set(key, arr);
  if (rateHits.size > 10_000) {
    // 简单防内存膨胀：只保留近一个窗口内有请求的 key
    for (const [k, v] of rateHits) {
      if (v.every((t) => now - t >= RATE_WINDOW_MS)) rateHits.delete(k);
    }
  }
  return false;
}

export function proxy(req: NextRequest) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");

  // 可选访问令牌：设置 NEXUS_ACCESS_TOKEN 后，所有 /api 请求必须携带该令牌。
  // 鉴权优先于限流：未授权请求直接 401，不消耗限流配额（防止被刷 401 把同 IP 合法用户挤到 429）。
  const token = process.env.NEXUS_ACCESS_TOKEN;
  if (token) {
    const auth = req.headers.get("authorization") || "";
    const headerToken = req.headers.get("x-nexus-token") || "";
    const ok =
      auth === `Bearer ${token}` ||
      headerToken === token;
    if (!ok) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }
  }

  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host) {
        return NextResponse.json({ error: "跨域请求被拒绝" }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: "非法 Origin" }, { status: 403 });
    }
  }

  // 客户端 IP：优先 x-real-ip（可信反代设置）；x-forwarded-for 首段完全由客户端可控，
  // 直接信任可被伪造绕过限流，仅作为最后回退。注意：直连场景下两者均可伪造，
  // 生产部署请置于可信反代之后并设置 NEXUS_ACCESS_TOKEN。
  const xReal = req.headers.get("x-real-ip");
  const xff = req.headers.get("x-forwarded-for");
  const clientIp = xReal || (xff ? xff.split(",")[0]?.trim() : "") || "local";
  if (isRateLimited(clientIp)) {
    return NextResponse.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
