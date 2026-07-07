# Deploy sokonimall.com (Cloudflare Pages — static site)

The storefront in `website/` is **plain HTML/JS** — no build step, no Wrangler Worker.

## Correct Cloudflare Pages settings

In **Workers & Pages → sokoni → Settings → Builds**:

| Setting | Value |
|---------|--------|
| **Path (root directory)** | `website` |
| **Build command** | *(leave empty)* |
| **Deploy command** | `npx wrangler deploy` |

The repo includes `website/wrangler.toml`, which tells Wrangler to publish the static
HTML/JS/CSS in that folder (not a Worker script). Without that file, `wrangler deploy`
fails because it has nothing to deploy.

Then **Deployments → Retry deployment** (or push to `main`).

## After deploy

- https://sokonimall.com/#reviews — Reviews section + form  
- Reviews API (live data): https://bot.sokonimall.com/api/reviews  

## Local preview

```bash
cd website
npx serve .
```

Open http://localhost:3000 (or the port `serve` prints).
