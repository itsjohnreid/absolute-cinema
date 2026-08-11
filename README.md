# Absolute Cinema

Search any film and see its Letterboxd rating stretched across the full scale:
0% is the lowest rated film on Letterboxd, 100% is the highest.

Letterboxd's whole catalogue fits between 0.87★ and 4.68★, so a raw "4.32" tells
you less than it should. Rescaled, Heat is a 91.

## How it gets the data

No Letterboxd API key is involved — their API is invite-only, and it turns out
you don't need it.

| Job | Source | Why |
| --- | --- | --- |
| Search | TMDB API | Popularity-ranked autocomplete, free key, CORS-enabled |
| Score | Letterboxd film pages | Every page embeds schema.org JSON-LD containing the weighted average |
| Bridge | `letterboxd.com/tmdb/{id}/` | Redirects a TMDB id straight to the right Letterboxd film page |

The score shown is always Letterboxd's own number. TMDB only answers "which film
did you mean".

### Why there's still a proxy

`letterboxd.com` sends no `Access-Control-Allow-Origin` header, so a browser on
GitHub Pages cannot read film pages directly. `worker/index.js` is a small
Cloudflare Worker that fetches the page server-side, extracts the rating, and
returns JSON with CORS. It holds no secrets and caches for 24 hours, so
Letterboxd sees very little traffic.

### What doesn't work, and why

Letterboxd's search endpoints (`/search/films/`, `/s/search/`,
`/s/autocompletefilm`) all sit behind a Cloudflare challenge and return 403 —
hence TMDB for search. Their rating-sorted browse pages (`/films/by/rating/`)
are 403 *and* disallowed in `robots.txt` (`Disallow: /*/by/*`), so the scale's
endpoints can't be discovered programmatically. They're pinned instead; see
**Calibration**.

## Setup

### 1. TMDB token

Sign up at <https://www.themoviedb.org/settings/api> — instant, free, no
approval queue. Copy the **API Read Access Token** (the long `eyJ...` string,
not the short v3 key).

### 2. Deploy the proxy

Wrangler is a local dev dependency — no global install needed.

```sh
cd worker
npm install
npm run login     # opens a browser to authorise Cloudflare
```

Set `ALLOWED_ORIGIN` in `worker/wrangler.toml` to your Pages origin
(`https://your-username.github.io`), then:

```sh
npm run deploy
```

Wrangler prints a URL like `https://absolute-cinema.you.workers.dev`.

Other scripts: `npm run dev` (local Worker on :8787), `npm run tail` (live logs).

### 3. Fill in config.js

```js
TMDB_TOKEN: 'eyJhbGciOi...',
PROXY_URL:  'https://absolute-cinema.you.workers.dev',
```

The TMDB token is visible in your deployed source. That's normal for TMDB read
tokens, but treat it as public — rotate it if it gets abused.

### 4. Publish

```sh
git init && git add . && git commit -m "Absolute Cinema"
git branch -M main
git remote add origin git@github.com:your-username/absolute-cinema.git
git push -u origin main
```

Then **Settings → Pages → Source: Deploy from a branch → main / (root)**. No
build step.

## Calibration

```
score = (rating − 0.87) / (4.68 − 0.87) × 100
```

Both ends were measured by hand on 2026-08-11, because Letterboxd's rating
sorts are blocked to crawlers:

| End | Film | Rating |
| --- | --- | --- |
| 100% | Harakiri (1962) | 4.68★ |
| 0% | Dragonball Evolution (2009) | 0.87★ |

Runners-up, if you want to widen the scale: **12 Angry Men** 4.63, **Come and
See** 4.61, **Seven Samurai** 4.61 at the top; **Winnie the Pooh: Blood and
Honey** 1.09, **The Last Airbender** 1.19 at the bottom.

The choice of anchor film is fixed in `config.js`, but the Worker re-reads both
ratings once a day, so the scale tracks them as they drift. Results are clamped
to 0–100. If the refresh fails the built-in values are used and the footer says
so.

## Running locally

```sh
python3 -m http.server 8000
```

Point `PROXY_URL` at a local Worker (`cd worker && npm run dev`, port 8787), or
temporarily set `ALLOWED_ORIGIN = "http://localhost:8000"` and redeploy.

## Files

| File | Purpose |
| --- | --- |
| `index.html` / `styles.css` / `app.js` | The site |
| `config.js` | Token, proxy URL, anchors — the only file you edit |
| `worker/index.js` | Letterboxd fetch-and-parse proxy |
| `worker/package.json` | Wrangler as a local dev dependency |
| `worker/wrangler.toml` | Worker config |

Ratings from Letterboxd; search data from TMDB. Not affiliated with either.
This product uses the TMDB API but is not endorsed or certified by TMDB.
