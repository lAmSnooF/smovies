# Native player setup (optional, free)

SFLIX ships with two players, chosen **per profile** on the Edit/Add Profile screen:

- **Videasy** (default) — the embedded iframe player. Always works, no setup, but slower and shows the provider's own UI/ads.
- **Native (beta)** — scrapes a direct stream and plays it in a plain HTML5 `<video>`, like cineby. Much faster (no player app to boot), but it needs a small **free proxy** and doesn't cover every title. If a title can't be scraped, it automatically falls back to Videasy.

The Native option does nothing until you deploy the free proxy below and paste its URL into the code.

## Why a proxy is required

Browsers block cross-origin video (CORS), and streaming CDNs never send CORS headers — so a static site physically cannot fetch these streams directly. A tiny proxy fetches them server-side and re-adds the headers. Cloudflare Workers' **free tier** (100k requests/day, no credit card) is plenty.

## 1. Deploy the proxy (~5 minutes, free)

Use the self-contained Worker file in this repo — [`cloudflare-worker.js`](cloudflare-worker.js). It's protocol-compatible with the scraper, so there's no repo to hunt down and no build step.

1. Make a free account at <https://dash.cloudflare.com> (no card needed).
2. In the dashboard: **Workers & Pages → Create → Create Worker**. Give it a name (e.g. `sflix-proxy`) and click **Deploy**.
3. Click **Edit code**. Select all the template code and delete it.
4. Copy the **entire contents of [`cloudflare-worker.js`](cloudflare-worker.js)** from this repo and paste it into the editor.
5. Click **Deploy**. Copy your Worker URL — it looks like `https://sflix-proxy.YOUR-NAME.workers.dev`.

## 2. Point SFLIX at your proxy

In [`script.js`](script.js), set the constant near the top:

```js
const NATIVE_PROXY_URL = 'https://sflix-proxy.YOUR-NAME.workers.dev/';
```

Commit + push (GitHub Pages redeploys automatically).

## 3. Turn it on for a profile

Open **Manage Profiles → (a profile) → Player → Native**, Save. That profile now uses the native player, falling back to Videasy whenever a title has no scrapable source.

## Notes & caveats

- **Coverage isn't 100%.** The scrapers (`@movie-web/providers`) target third-party source sites that come and go; some titles won't resolve and will fall back to Videasy.
- **Maintenance.** If native playback starts failing broadly, bump the pinned `@movie-web/providers` version in `script.js` (`PROVIDERS_ESM`) to the latest.
- **Keep Videasy as your default profile player** — it's the reliable one; Native is the fast-when-it-works option.
