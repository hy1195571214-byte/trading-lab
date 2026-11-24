export type Any = Record<string, any>;
const API = "/api";
export class ApiError extends Error {
  readonly detail: string;
  readonly status?: number;
  constructor(detail: unknown, status?: number) {
    let message = "";
    if (typeof detail === "string") message = detail;
    else if (detail != null) message = JSON.stringify(detail) ?? String(detail);
    super(message || `Request failed (${status})`);
    this.name = "ApiError";
    this.detail = message;
    this.status = status;
  }
}
export async function req(path: string, opts: RequestInit = {}): Promise<any> {
  const r = await fetch(API + path, opts);
  if (!r.ok) {
    if (r.status === 401) window.dispatchEvent(new Event("trading-lab-auth-expired"));
    let m = "";
    try {
      m = (await r.json()).detail || m;
    } catch {}
    throw new ApiError(m, r.status);
  }
  if (r.headers.get("content-type")?.includes("application/json"))
    return r.json();
  return r;
}
