/** Deployment identity is configuration, never an original author's hostname. */
export function siteOrigin(config: { SITE_ORIGIN?: string }): string {
  if (!config.SITE_ORIGIN) throw new Error("请配置 SITE_ORIGIN 为当前站点的 HTTPS 地址。");
  const url = new URL(config.SITE_ORIGIN);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("SITE_ORIGIN 必须是站点源地址，不含路径、查询参数或凭据。");
  }
  return url.origin;
}
