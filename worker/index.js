/**
 * Absolute Cinema — Letterboxd rating proxy (Cloudflare Worker)
 *
 * Letterboxd has no public API key you can get, and letterboxd.com sends no
 * CORS headers, so a static site can't read it directly. This Worker fetches
 * a public film page server-side and returns the rating its schema.org
 * JSON-LD already contains.
 *
 * Endpoints:
 *   GET /rating?tmdb=496243   -> { rating, ratingCount, name, year, slug, url }
 *   GET /rating?slug=heat-1995
 *   GET /anchors?hi=harakiri&lo=dragonball-evolution
 *
 * Var (wrangler.toml): ALLOWED_ORIGINS — comma-separated list of origins
 * allowed to call this Worker. No secrets needed.
 */

const LB = 'https://letterboxd.com';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Film pages are cacheable for a day; ratings move slowly and this keeps
// request volume to Letterboxd low.
const CACHE_SECONDS = 86400;

export default {
  async fetch(request, env, ctx) {
    const origin = allowedOrigin(request.headers.get('Origin'), env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(origin) });
    }
    if (request.method !== 'GET') {
      return json({ error: 'Only GET is supported.' }, 405, origin);
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === '/rating') {
        const slug = url.searchParams.get('slug');
        const tmdb = url.searchParams.get('tmdb');
        if (!slug && !tmdb) {
          return json({ error: 'Pass ?tmdb= or ?slug=.' }, 400, origin);
        }
        const path = slug ? `/film/${clean(slug)}/` : `/tmdb/${digits(tmdb)}/`;
        return json(await filmRating(path, ctx), 200, origin);
      }

      if (url.pathname === '/anchors') {
        const hi = clean(url.searchParams.get('hi') || '');
        const lo = clean(url.searchParams.get('lo') || '');
        if (!hi || !lo) return json({ error: 'Pass ?hi= and ?lo=.' }, 400, origin);
        const [highest, lowest] = await Promise.all([
          filmRating(`/film/${hi}/`, ctx),
          filmRating(`/film/${lo}/`, ctx),
        ]);
        return json({ highest, lowest }, 200, origin);
      }

      return json({ error: 'Unknown endpoint.' }, 404, origin);
    } catch (err) {
      const status = err.status || 502;
      return json({ error: String(err.message || err) }, status, origin);
    }
  },
};

/** Fetches a Letterboxd film page and pulls the rating out of its JSON-LD. */
async function filmRating(path, ctx) {
  const target = LB + path;
  const cache = caches.default;
  const cacheKey = new Request(target, { method: 'GET' });

  let res = await cache.match(cacheKey);
  if (!res) {
    res = await fetch(target, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      redirect: 'follow',
      cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
    });
    if (res.ok) {
      const copy = new Response(res.clone().body, res);
      copy.headers.set('Cache-Control', `public, max-age=${CACHE_SECONDS}`);
      ctx.waitUntil(cache.put(cacheKey, copy));
    }
  }

  if (res.status === 404) throw httpError('That film has no Letterboxd page.', 404);
  if (res.status === 403) {
    throw httpError('Letterboxd declined the request. Try again shortly.', 503);
  }
  if (!res.ok) throw httpError(`Letterboxd returned ${res.status}.`, 502);

  const finalUrl = res.url || target;
  const data = parseJsonLd(await res.text());
  const agg = data?.aggregateRating;

  if (!agg || typeof agg.ratingValue !== 'number') {
    throw httpError('That film has no Letterboxd rating yet.', 404);
  }

  return {
    rating: agg.ratingValue,
    ratingCount: agg.ratingCount ?? null,
    name: data.name ?? null,
    year: yearFrom(data.dateCreated),
    directors: directorsFrom(data.director),
    poster: typeof data.image === 'string' ? data.image : null,
    slug: slugFrom(finalUrl),
    url: finalUrl,
  };
}

/**
 * Letterboxd wraps its JSON-LD in CDATA-ish /* *\/ comment markers, so the
 * script contents need stripping before JSON.parse.
 */
function parseJsonLd(html) {
  const match = html.match(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/i
  );
  if (!match) return null;
  const body = match[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function directorsFrom(director) {
  if (!director) return [];
  const list = Array.isArray(director) ? director : [director];
  return list.map((d) => d?.name).filter(Boolean);
}

function yearFrom(dateCreated) {
  const year = Number(String(dateCreated || '').slice(0, 4));
  return Number.isInteger(year) && year > 1800 ? year : null;
}

function slugFrom(url) {
  return url.match(/\/film\/([^/]+)\//)?.[1] ?? null;
}

const clean = (s) => String(s).toLowerCase().replace(/[^a-z0-9-]/g, '');
const digits = (s) => String(s).replace(/\D/g, '');

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Echoes back the caller's origin if it's on the allowlist, so the same
 * deployment can serve both the Pages site and a local dev server. Falls back
 * to the first configured origin, which keeps unlisted callers blocked.
 */
function allowedOrigin(requestOrigin, env) {
  const list = (env.ALLOWED_ORIGINS || env.ALLOWED_ORIGIN || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.includes('*')) return '*';
  return list.includes(requestOrigin) ? requestOrigin : list[0];
}

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors(origin),
      'Content-Type': 'application/json',
      'Cache-Control': status === 200 ? `public, max-age=${CACHE_SECONDS}` : 'no-store',
    },
  });
}
