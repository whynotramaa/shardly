"use client";
import { useState } from "react";
import { Icon } from "@/components/ui";

export default function ApiAccess({ onChanged }: { onChanged: () => void }) {
  const [token, setToken] = useState(""), [message, setMessage] = useState("");
  function save(clear = false) {
    try { if (clear) sessionStorage.removeItem("shardly-api-token"); else sessionStorage.setItem("shardly-api-token", token); setToken(""); setMessage(clear ? "API token cleared for this tab." : "API token saved for this tab. It is not included in exports."); onChanged(); }
    catch { setMessage("Session storage is unavailable. Enable it to use an authenticated API."); }
  }
  return <section className="source"><span className="source-icon"><Icon name="sliders" size={18} /></span><div className="source-body"><h2>API access</h2><p className="hint">For an authenticated server, enter its administrator token. Local servers can run without one. The token stays in this browser tab's session storage.</p><form className="inline-form" onSubmit={e => { e.preventDefault(); save(); }}><input type="password" aria-label="API administrator token" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} maxLength={4096} placeholder="Administrator token" /><button className="button small" disabled={token.length < 24}>Use token</button><button type="button" className="button ghost small" onClick={() => save(true)}>Clear</button></form>{message && <p className="hint" role="status">{message}</p>}</div></section>;
}
