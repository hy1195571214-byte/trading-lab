const security = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

function jsonError(status, detail) {
  return Response.json({ detail }, { status, headers: { ...security, "Cache-Control": "no-store" } });
}

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    if (incoming.pathname === "/api" || incoming.pathname.startsWith("/api/")) {
      let origin;
      try {
        origin = new URL(env.ORIGIN_URL);
        if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error();
      } catch {
        return jsonError(503, "Cloud backend is not configured.");
      }
      if (!env.ORIGIN_TOKEN || env.ORIGIN_TOKEN.length < 32) return jsonError(503, "Cloud backend access is not configured.");
      if (Number(request.headers.get("Content-Length") || 0) > 5 * 1024 * 1024) return jsonError(413, "Upload exceeds the 5 MB cloud limit.");
      const target = new URL(incoming.pathname + incoming.search, origin);
      const headers = new Headers(request.headers);
      headers.delete("Host");
      headers.delete("Authorization");
      headers.delete("Forwarded");
      headers.delete("X-Forwarded-Host");
      headers.delete("X-Forwarded-For");
      headers.set("X-Trading-Lab-Origin-Token", env.ORIGIN_TOKEN);
      headers.set("X-Forwarded-Proto", "https");
      headers.set("X-Forwarded-Host", incoming.host);
      headers.set("X-Forwarded-For", request.headers.get("CF-Connecting-IP") || "unknown");
      try {
        const forwarded = new Request(target, request);
        const upstream = await fetch(new Request(forwarded, { headers, redirect: "manual" }));
        if (upstream.status >= 300 && upstream.status < 400) return jsonError(502, "Cloud backend returned an unexpected redirect.");
        const response = new Response(upstream.body, upstream);
        for (const [key, value] of Object.entries(security)) response.headers.set(key, value);
        response.headers.set("Cache-Control", "no-store");
        return response;
      } catch {
        return jsonError(503, "Cloud backend is starting or temporarily unavailable. Please retry shortly.");
      }
    }
    const asset = await env.ASSETS.fetch(request);
    const response = new Response(asset.body, asset);
    for (const [key, value] of Object.entries(security)) response.headers.set(key, value);
    if ((response.headers.get("Content-Type") || "").includes("text/html")) {
      response.headers.set("Cache-Control", "no-cache");
      response.headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'");
    }
    return response;
  },
};
