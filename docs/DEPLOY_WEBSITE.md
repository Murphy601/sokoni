# Deploy sokonimall.com (Cloudflare Pages — static site)

The storefront in `website/` is **plain HTML/JS** — no build step, no Wrangler Worker.

## Correct Cloudflare Pages settings

In **Workers & Pages → sokoni → Settings → Builds**:

| Setting | Value |
|---------|--------|
| **Root directory** | `website` |
| **Build command** | *(leave empty)* |
| **Deploy command** | *(leave empty — remove `npx wrangler deploy`)* |

Then **Deployments → Retry deployment** (or push to `main`).

### Why `npx wrangler deploy` fails

That command deploys a **Cloudflare Worker**, not a static site. This project has no Worker entrypoint in `website/`, so the build fails at “Deploying”.

## After deploy

- https://sokonimall.com/#reviews — Reviews section + form  
- Reviews API (live data): https://bot.sokonimall.com/api/reviews  

## Local preview

```bash
cd website
npx serve .
```

Open http://localhost:3000 (or the port `serve` prints).
