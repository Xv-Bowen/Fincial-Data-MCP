"use client";
import { useEffect, useState } from "react";

type Readiness = { ready: boolean; message: string; active_connections: number };
export function OAuthConnection() {
  const [status, setStatus] = useState<Readiness | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  async function refresh() {
    setBusy(true);
    try {
      const response = await fetch("/api/oauth/status", { cache: "no-store" });
      const result = await response.json() as Readiness & { error_description?: string };
      if (!response.ok) throw new Error(result.message || result.error_description || "检查失败，请重新登录后重试。");
      setStatus(result); setMessage("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "检查失败。"); }
    finally { setBusy(false); }
  }
  useEffect(() => { void refresh(); }, []);
  async function revoke() {
    setBusy(true);
    try {
      const response = await fetch("/api/oauth/revoke-all", { method: "POST" });
      const result = await response.json() as { revoked?: boolean; error_description?: string };
      if (!response.ok) throw new Error(result.error_description || "撤销失败，请重试。");
      setStatus(previous => previous ? { ...previous, active_connections: 0 } : null);
      setMessage("已撤销全部外部连接。客户端需要重新授权后才能继续查询。"); setConfirming(false);
    } catch (error) { setMessage(error instanceof Error ? error.message : "撤销失败。"); }
    finally { setBusy(false); }
  }
  return <div className="oauth-status" aria-busy={busy}>
    <p className={status?.ready ? "provider-status" : "provider-status pending"}>{status ? status.ready ? "外部连接入口已就绪" : "外部连接入口待开放或修复" : "正在检查外部连接入口…"}</p>
    {status && <><p className="sub">{status.message}</p><p className="small">当前有效的外部授权：{status.active_connections} 个。现有 ChatGPT 内置连接单独管理。</p></>}
    <div className="query-actions"><button className="secondary" disabled={busy} onClick={() => void refresh()}>{busy ? "处理中…" : "重新检查"}</button>{!!status?.active_connections && <button className="secondary" disabled={busy} onClick={() => setConfirming(true)}>撤销外部连接</button>}</div>
    {confirming && <div className="revoke-confirm"><p>撤销后，Claude 和手动添加的 ChatGPT 连接会立即失效。要继续吗？</p><button className="primary" disabled={busy} onClick={() => void revoke()}>确认撤销全部</button><button className="secondary" disabled={busy} onClick={() => setConfirming(false)}>保留连接</button></div>}
    {message && <p className="feedback" role="status">{message}</p>}
  </div>;
}
