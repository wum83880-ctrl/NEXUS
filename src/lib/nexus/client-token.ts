// 客户端访问令牌：当配置了 NEXT_PUBLIC_NEXUS_ACCESS_TOKEN 时，
// 自动为所有 fetch 请求附加 x-nexus-token 头，Socket 连接也携带 auth.token。
export function getClientToken(): string {
  return (typeof process !== "undefined" && (process.env.NEXT_PUBLIC_NEXUS_ACCESS_TOKEN as string | undefined)) || "";
}

export function applyClientTokenToFetch() {
  if (typeof window === "undefined") return;
  const token = getClientToken();
  if (!token) return;
  const original = window.fetch.bind(window);
  const wrapped = (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (!headers.has("x-nexus-token")) {
      headers.set("x-nexus-token", token);
    }
    return original(input, { ...init, headers });
  };
  window.fetch = wrapped as typeof fetch;
}
