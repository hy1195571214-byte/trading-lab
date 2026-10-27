import React, { createContext, useCallback, useEffect, useState } from "react";

export const AuthContext = createContext({ enabled: false, logout: async () => {} });

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"loading" | "login" | "ready" | "error">("loading");
  const [enabled, setEnabled] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const check = useCallback(async () => {
    setState("loading"); setError("");
    try {
      const response = await fetch("/api/auth/status", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(90000) });
      if (!response.ok) throw new Error("The cloud backend is not ready. Please retry shortly.");
      const status = await response.json();
      setEnabled(Boolean(status.auth_required));
      setState(!status.auth_required || status.authenticated ? "ready" : "login");
    } catch {
      setError("Unable to connect to the backend. A free cloud instance may take about a minute to wake up.");
      setState("error");
    }
  }, []);
  useEffect(() => {
    check();
    const expired = () => { setState("login"); setPassword(""); setError("Please sign in to continue."); };
    window.addEventListener("trading-lab-auth-expired", expired);
    return () => window.removeEventListener("trading-lab-auth-expired", expired);
  }, [check]);
  const logout = async () => {
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error();
      setPassword(""); setError(""); setState("login");
    } catch { setError("Sign out failed. Please retry."); }
  };
  if (state === "ready") return <AuthContext.Provider value={{ enabled, logout }}>{children}{error && <div className="auth-notice" role="alert">{error}</div>}</AuthContext.Provider>;
  return <div className="auth-screen"><section className="auth-card">
    <span className="tag lime">TRADING LAB · SHARED RESEARCH WORKSPACE</span>
    <h1>{state === "login" ? "Sign in to Trading Lab" : "Connecting to Trading Lab"}</h1>
    <p>Historical trading experiments, expert strategies and human oversight. Simulated capital only.</p>
    {state === "loading" && <p role="status">Connecting… The free cloud backend may need about a minute to wake up.</p>}
    {error && <p role="alert" className="error">{error}</p>}
    {state === "error" && <button className="primary" onClick={check}>Retry connection</button>}
    {state === "login" && <form onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setError("");
      try {
        const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ password }) });
        if (!response.ok) throw new Error(response.status === 429 ? "Too many attempts. Please wait before trying again." : "Sign in failed. Check the workspace password.");
        setPassword(""); await check();
      } catch (failure: any) { setError(failure.message || "Sign in failed."); }
      finally { setBusy(false); }
    }}>
      <label>Workspace password<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <button className="primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      <small>Use the password provided by your workspace owner. It is never saved in this browser.</small>
    </form>}
  </section></div>;
}
