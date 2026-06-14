# Subwire Docs

Public documentation for the Subwire protocol and hosted app layer.

```sh
npm install
npm run dev
```

Build with:

```sh
npm run build
```

## Deploy

Hosted on Cloudflare Workers as static assets (live at `https://docs.subwire.ai`).
Pushes to `main` that touch `docs/**` deploy automatically via
[`.github/workflows/docs-deploy.yml`](../.github/workflows/docs-deploy.yml).
To deploy manually:

```sh
npm run deploy   # astro build && wrangler deploy
```
