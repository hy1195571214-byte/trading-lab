export type Any = Record<string, any>;
const API = "/api";
export async function req(path: string, opts: RequestInit = {}): Promise<any> {
  const r = await fetch(API + path, opts);
  if (!r.ok) {
    if (r.status === 401) window.dispatchEvent(new Event("trading-lab-auth-expired"));
    let m = `Request failed (${r.status})`;
    try {
      m = (await r.json()).detail || m;
    } catch {}
    throw Error(m);
  }
  if (r.headers.get("content-type")?.includes("application/json"))
    return r.json();
  return r;
}
