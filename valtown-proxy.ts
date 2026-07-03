// ===================================================================
//  SFLIX native-player proxy — val.town HTTP val
//  -------------------------------------------------------------------
//  Same CORS proxy as cloudflare-worker.js, in val.town's format.
//
//  DEPLOY (~1 min, no build/subdomain):
//    1. Go to https://val.town and sign in (Google or GitHub).
//    2. Click "New" -> "HTTP" (an HTTP endpoint val).
//    3. Delete the template code, paste THIS ENTIRE FILE, it auto-saves/deploys.
//    4. Copy the val's URL shown at the top (looks like
//       https://<username>-<valname>.web.val.run) and send it to me,
//       or put it in NATIVE_PROXY_URL in script.js (with a trailing slash).
// ===================================================================

const REQ_HEADER_MAP: Record<string, string> = {
  "x-cookie": "cookie",
  "x-referer": "referer",
  "x-origin": "origin",
  "x-user-agent": "user-agent",
  "x-x-real-ip": "x-real-ip",
};
const SKIP_REQ = new Set([
  "host", "origin", "referer", "content-length", "connection",
  "x-forwarded-for", "x-forwarded-proto", "x-forwarded-host",
]);
const SKIP_RESP = new Set(["connection", "transfer-encoding", "keep-alive", "content-length"]);
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const destination = new URL(req.url).searchParams.get("destination");
  if (!destination) return new Response("Missing ?destination", { status: 400, headers: CORS });

  const fwd = new Headers();
  for (const [name, value] of req.headers) {
    const lower = name.toLowerCase();
    if (REQ_HEADER_MAP[lower]) fwd.set(REQ_HEADER_MAP[lower], value);
    else if (!SKIP_REQ.has(lower) && !lower.startsWith("cf-")) fwd.set(name, value);
  }

  let upstream: Response;
  try {
    upstream = await fetch(destination, {
      method: req.method,
      headers: fwd,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
      redirect: "follow",
    });
  } catch (e) {
    return new Response("Proxy fetch failed: " + String(e), { status: 502, headers: CORS });
  }

  const headers = new Headers();
  for (const [name, value] of upstream.headers) {
    const lower = name.toLowerCase();
    if (lower === "set-cookie") headers.append("X-Set-Cookie", value);
    else if (!SKIP_RESP.has(lower)) headers.set(name, value);
  }
  headers.set("X-Final-Destination", upstream.url || destination);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);

  return new Response(upstream.body, { status: upstream.status, headers });
}
