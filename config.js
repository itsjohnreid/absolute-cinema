/**
 * Absolute Cinema — configuration
 *
 * Two services, for two different jobs:
 *
 *   TMDB      — search only. Its autocomplete is popularity-ranked, so typing
 *               "parasite" surfaces the 2019 film first. Free key, CORS-enabled,
 *               called straight from the browser.
 *   Letterboxd — the score. Public film pages embed a schema.org aggregateRating
 *               holding the weighted average. No API key exists for this; the
 *               Worker in `worker/` fetches and parses the page, because
 *               letterboxd.com sends no CORS headers.
 *
 * See README.md for setup.
 */
window.AC_CONFIG = {
  /**
   * TMDB API Read Access Token (the long "eyJ..." JWT, not the short v3 key).
   * Free from https://www.themoviedb.org/settings/api
   *
   * This is a read-only token and it will be visible in your deployed source —
   * that is expected for TMDB, but treat it as public and rotate it if abused.
   */
  TMDB_TOKEN: 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI2YmM2ZmQxMWRiZGJmZjY5NzI1MzVmM2I2ZDhkYjMxYSIsIm5iZiI6MTc4NjQyNDk0NC43NTIsInN1YiI6IjZhN2FhZTcwOTFmNDNkMjEzODAzYmJkYyIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.CBscTEJjq96bNwnVYkMRHDewcE6NaKK2XdD50yMveRY',

  /**
   * Base URL of your deployed Letterboxd proxy, no trailing slash.
   * e.g. 'https://absolute-cinema.your-name.workers.dev'
   */
  PROXY_URL: 'https://absolute-cinema.vanillacode.workers.dev',

  /**
   * The ends of the scale, as Letterboxd weighted averages out of 5.
   *
   * Letterboxd's own rating-sorted browse pages are blocked to crawlers
   * (robots.txt disallows /*\/by/*), so these can't be discovered
   * automatically. They were measured by hand on 2026-08-11; the Worker
   * refreshes the two ratings daily from these films' pages, so the numbers
   * stay current even though the choice of film is fixed.
   *
   * Runners-up, if you ever want to widen the scale:
   *   ceiling — 12 Angry Men 4.63, Come and See 4.61, Seven Samurai 4.61
   *   floor   — Winnie the Pooh: Blood and Honey 1.09, The Last Airbender 1.19
   */
  ANCHORS: {
    highest: { slug: 'harakiri',             name: 'Harakiri',             year: 1962, rating: 4.68 },
    lowest:  { slug: 'dragonball-evolution', name: 'Dragonball Evolution', year: 2009, rating: 0.87 },
  },

  /** How long to reuse fetched values before refreshing, in hours. */
  ANCHOR_TTL_HOURS: 24,
};
