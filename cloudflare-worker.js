// ===================================================================
//  SFLIX native-player proxy — Cloudflare Worker
//  -------------------------------------------------------------------
//  A CORS proxy compatible with @movie-web/providers' makeSimpleProxyFetcher.
//  The site's "Native" player uses this to scrape a direct stream (browsers
//  block that cross-origin). Free: Cloudflare Workers give 100k requests/day.
//
//  DEPLOY (no build step, ~5 min):
//    1. dash.cloudflare.com  ->  Workers & Pages  ->  Create  ->  Create Worker
//    2. Name it (e.g. sflix-proxy), Deploy, then "Edit code".
//    3. Delete the template, paste THIS ENTIRE FILE, click Deploy.
//    4. Copy the Worker URL (https://sflix-proxy.<you>.workers.dev) and put it in
//       NATIVE_PROXY_URL in script.js (keep the trailing slash), then push.
// ===================================================================

// Request headers the browser can't set directly, so the scraper sends them
// renamed with an X- prefix; we rename them back before hitting the source.
const REQ_HEADER_MAP = {
  'x-cookie': 'cookie',
  'x-referer': 'referer',
  'x-origin': 'origin',
  'x-user-agent': 'user-agent',
  'x-x-real-ip': 'x-real-ip',
};

// Headers we must NOT forward from the incoming browser request to the source.
const SKIP_REQ = new Set([
  'host', 'origin', 'referer', 'content-length', 'connection',
  'x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host',
]);

// Hop-by-hop response headers to drop.
const SKIP_RESP = new Set(['connection', 'transfer-encoding', 'keep-alive', 'content-length']);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const destination = new URL(request.url).searchParams.get('destination');
    if (!destination) {
      return new Response('Missing ?destination', { status: 400, headers: CORS });
    }

    // Forward headers, un-mapping the X- prefixed ones and dropping browser-added ones.
    const fwd = new Headers();
    for (const [name, value] of request.headers) {
      const lower = name.toLowerCase();
      if (REQ_HEADER_MAP[lower]) fwd.set(REQ_HEADER_MAP[lower], value);
      else if (!SKIP_REQ.has(lower) && !lower.startsWith('cf-')) fwd.set(name, value);
    }

    let upstream;
    try {
      upstream = await fetch(destination, {
        method: request.method,
        headers: fwd,
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
        redirect: 'follow',
      });
    } catch (e) {
      return new Response('Proxy fetch failed: ' + e.message, { status: 502, headers: CORS });
    }

    // Pass the response back with CORS; rename Set-Cookie so the browser can read it,
    // and expose the final (post-redirect) URL the scraper needs.
    const headers = new Headers();
    for (const [name, value] of upstream.headers) {
      const lower = name.toLowerCase();
      if (lower === 'set-cookie') headers.append('X-Set-Cookie', value);
      else if (!SKIP_RESP.has(lower)) headers.set(name, value);
    }
    headers.set('X-Final-Destination', upstream.url || destination);
    for (const [k, v] of Object.entries(CORS)) headers.set(k, v);

    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
