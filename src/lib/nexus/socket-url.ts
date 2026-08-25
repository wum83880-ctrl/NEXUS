// NEXUS socket 连接地址解析
// 本地 dev（页面端口 3000）：直连 同host:3003（支持 localhost 与局域网 IP，stream 需 NEXUS_BIND=0.0.0.0）
// 部署态（80/443，Caddy 网关）：同源 + XTransformPort=3003 查询参数转发到后端
export function nexusSocketUrl(): string {
  if (typeof window === "undefined") return "/?XTransformPort=3003";
  const port = window.location.port;
  const host = window.location.hostname;
  if (port === "3000" || port === "3001" || port === "3002") {
    // dev：直连同一 host 的 3003（局域网 IP 时 stream 需 NEXUS_BIND=0.0.0.0）
    return `${window.location.protocol}//${host}:3003`;
  }
  return "/?XTransformPort=3003";
}
