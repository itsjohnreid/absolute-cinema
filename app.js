/**
 * Absolute Cinema
 *
 * Letterboxd weighted averages sit in a narrow band — the best film of all time
 * manages 4.68 out of 5, the worst still clears 0.87. This rescales a rating so
 * that the lowest rated film is 0% and the highest is 100%.
 *
 * TMDB provides search; Letterboxd provides the score, via the Worker proxy.
 */
(() => {
  'use strict';

  const CFG = window.AC_CONFIG || {};
  const TMDB = 'https://api.themoviedb.org/3';
  const ANCHOR_CACHE_KEY = 'ac:anchors:v2';

  const el = {
    form: document.querySelector('.search'),
    input: document.getElementById('q'),
    results: document.getElementById('results'),
    live: document.querySelector('.live'),
    empty: document.getElementById('empty'),
    readout: document.getElementById('readout'),
    score: document.getElementById('score'),
    caption: document.getElementById('score-caption'),
    title: document.getElementById('film-title'),
    credits: document.getElementById('film-credits'),
    raw: document.getElementById('raw'),
    poster: document.getElementById('poster'),
    marker: document.getElementById('marker'),
    notice: document.getElementById('notice'),
    calibration: document.getElementById('calibration'),
  };

  let anchors = CFG.ANCHORS;
  let activeIndex = -1;
  let currentResults = [];
  let searchToken = 0;

  // ---------- TMDB: search only ----------

  async function searchFilms(query, signal) {
    if (!CFG.TMDB_TOKEN) {
      throw new Error('No TMDB token. Set TMDB_TOKEN in config.js — see README.md.');
    }
    const url = new URL(`${TMDB}/search/movie`);
    url.search = new URLSearchParams({
      query,
      include_adult: 'false',
      language: 'en-US',
      page: '1',
    });

    const res = await fetch(url, {
      signal,
      headers: {
        Authorization: `Bearer ${CFG.TMDB_TOKEN}`,
        Accept: 'application/json',
      },
    });
    if (res.status === 401) throw new Error('TMDB rejected the token in config.js.');
    if (!res.ok) throw new Error(`TMDB returned ${res.status}.`);

    const data = await res.json();
    // TMDB returns popularity-ordered results; keep that order.
    return (data.results || []).slice(0, 8).map((r) => ({
      tmdbId: r.id,
      name: r.title,
      year: r.release_date ? Number(r.release_date.slice(0, 4)) : null,
    }));
  }

  /**
   * Directors aren't in search results, so they need a credits call per film.
   * Results render first and these fill in as they land — same-title films are
   * easier to tell apart by director than by year alone.
   */
  async function fetchDirectors(tmdbId, signal) {
    const res = await fetch(`${TMDB}/movie/${tmdbId}/credits`, {
      signal,
      headers: {
        Authorization: `Bearer ${CFG.TMDB_TOKEN}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.crew || [])
      .filter((p) => p.job === 'Director')
      .map((p) => p.name);
  }

  // ---------- Worker: Letterboxd ratings ----------

  async function proxy(path, params = {}, signal) {
    if (!CFG.PROXY_URL) {
      throw new Error('No proxy configured. Set PROXY_URL in config.js — see README.md.');
    }
    const url = new URL(CFG.PROXY_URL.replace(/\/+$/, '') + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || `Proxy returned ${res.status}.`);
    return data;
  }

  const fetchByTmdb = (tmdbId, signal) => proxy('/rating', { tmdb: tmdbId }, signal);

  // ---------- Anchors ----------

  /**
   * The anchor films are fixed (Letterboxd's rating-sorted pages are blocked
   * to crawlers), but their ratings drift, so refresh them daily.
   */
  async function loadAnchors() {
    const cached = readCache();
    if (cached) {
      applyAnchors(cached, 'cached');
      return;
    }

    applyAnchors(CFG.ANCHORS, 'built-in');

    try {
      const { highest, lowest } = await proxy('/anchors', {
        hi: CFG.ANCHORS.highest.slug,
        lo: CFG.ANCHORS.lowest.slug,
      });
      const fresh = {
        highest: { ...CFG.ANCHORS.highest, ...pick(highest) },
        lowest: { ...CFG.ANCHORS.lowest, ...pick(lowest) },
      };
      if (fresh.highest.rating > fresh.lowest.rating) {
        writeCache(fresh);
        applyAnchors(fresh, 'live');
      }
    } catch {
      // Built-in anchors are already applied; the scale still works.
    }
  }

  const pick = (r) => ({ rating: r.rating, name: r.name, year: r.year });

  function readCache() {
    try {
      const { savedAt, value } = JSON.parse(localStorage.getItem(ANCHOR_CACHE_KEY));
      const ttl = (CFG.ANCHOR_TTL_HOURS ?? 24) * 3600e3;
      return savedAt && Date.now() - savedAt < ttl ? value : null;
    } catch {
      return null;
    }
  }

  function writeCache(value) {
    try {
      localStorage.setItem(ANCHOR_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), value }));
    } catch {
      // Private browsing or full quota — caching is optional.
    }
  }

  function applyAnchors(value, source) {
    anchors = value;
    el.calibration.textContent =
      `Scale runs ${value.lowest.rating.toFixed(2)}★ to ` +
      `${value.highest.rating.toFixed(2)}★ (${source}).`;
  }

  const filmLabel = (film) => (film.year ? `${film.name} (${film.year})` : film.name);

  // ---------- Normalisation ----------

  /**
   * Clamped, so a film that overtakes an anchor between daily refreshes reads
   * 100 rather than running off the end of the scale.
   */
  function normaliseScore(rating) {
    const { rating: lo } = anchors.lowest;
    const { rating: hi } = anchors.highest;
    const span = hi - lo;
    if (!(span > 0)) return 50;
    return Math.max(0, Math.min(100, ((rating - lo) / span) * 100));
  }

  // ---------- Rendering ----------

  function showNotice(message) {
    el.notice.textContent = message;
    el.notice.hidden = false;
  }

  function clearNotice() {
    el.notice.hidden = true;
    el.notice.textContent = '';
  }

  function renderResults(films) {
    currentResults = films;
    activeIndex = -1;
    el.results.replaceChildren();

    if (!films.length) {
      const li = document.createElement('li');
      li.className = 'results__empty';
      li.textContent = 'No films match that search.';
      el.results.append(li);
    } else {
      films.forEach((film, i) => {
        const li = document.createElement('li');
        li.className = 'results__item';
        li.id = `result-${i}`;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');

        const name = document.createElement('span');
        name.className = 'results__name';
        name.textContent = film.name;

        const year = document.createElement('span');
        year.className = 'results__year';
        year.textContent = film.year ?? '';

        const director = document.createElement('span');
        director.className = 'results__director';
        director.dataset.for = String(film.tmdbId);

        li.append(name, year, director);
        // mousedown, so the pick lands before blur closes the list
        li.addEventListener('mousedown', (e) => {
          e.preventDefault();
          select(film);
        });
        el.results.append(li);
      });
    }

    el.results.hidden = false;
    el.input.setAttribute('aria-expanded', 'true');

    fillDirectors(films);
  }

  /**
   * Fills each row's director in as its credits call resolves. Rows are matched
   * by TMDB id rather than index, so a slow response landing after a newer
   * search can't write into the wrong row.
   */
  function fillDirectors(films) {
    const token = searchToken;
    films.forEach((film) => {
      fetchDirectors(film.tmdbId)
        .then((directors) => {
          if (token !== searchToken || !directors.length) return;
          film.directors = directors;
          const slot = el.results.querySelector(
            `.results__director[data-for="${film.tmdbId}"]`
          );
          if (slot) slot.textContent = directors.join(', ');
        })
        .catch(() => {
          // A missing director just leaves the slot empty.
        });
    });
  }

  function closeList() {
    el.results.hidden = true;
    el.input.setAttribute('aria-expanded', 'false');
    el.input.removeAttribute('aria-activedescendant');
    activeIndex = -1;
  }

  function moveActive(delta) {
    if (el.results.hidden || !currentResults.length) return;
    const items = [...el.results.querySelectorAll('.results__item')];
    if (!items.length) return;
    activeIndex = (activeIndex + delta + items.length) % items.length;
    items.forEach((item, i) => {
      const on = i === activeIndex;
      item.setAttribute('aria-selected', String(on));
      if (on) {
        item.scrollIntoView({ block: 'nearest' });
        el.input.setAttribute('aria-activedescendant', item.id);
      }
    });
  }

  async function select(film) {
    closeList();
    el.input.value = film.name;
    clearNotice();
    setBusy(true);

    try {
      const data = await fetchByTmdb(film.tmdbId);
      render({ ...film, ...data }, data.rating);
    } catch (err) {
      showNotice(`${film.name}: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  function render(film, rating) {
    const score = normaliseScore(rating);

    el.empty.hidden = true;
    el.readout.hidden = false;

    el.title.textContent = filmLabel(film);
    el.credits.textContent = film.directors?.length
      ? `Directed by ${film.directors.join(', ')}`
      : '';

    const rows = [
      dataRow('Letterboxd', `${rating.toFixed(2)} / 5`),
      dataRow('Position on scale', `${score.toFixed(1)}%`),
    ];
    if (film.ratingCount) {
      rows.push(dataRow('Ratings', film.ratingCount.toLocaleString()));
    }
    el.raw.replaceChildren(...rows);

    if (film.poster) {
      el.poster.src = film.poster;
      el.poster.alt = `Poster for ${film.name}`;
      el.poster.hidden = false;
    } else {
      el.poster.hidden = true;
      el.poster.removeAttribute('src');
    }

    el.marker.hidden = false;
    el.marker.style.left = `${score}%`;
    el.caption.textContent = `normalised from ${rating.toFixed(2)}★`;

    countUp(Math.round(score));
    el.live.textContent = `${filmLabel(film)} scores ${Math.round(score)} percent.`;
  }

  function dataRow(term, value) {
    const frag = document.createDocumentFragment();
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = value;
    frag.append(dt, dd);
    return frag;
  }

  /** The number rolls up as the marker slides — one gesture, not two. */
  let countFrame = 0;
  function countUp(target) {
    cancelAnimationFrame(countFrame);

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.score.textContent = String(target);
      return;
    }

    const duration = 900;
    const start = performance.now();
    const from = Number(el.score.textContent) || 0;

    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.score.textContent = String(Math.round(from + (target - from) * eased));
      if (t < 1) countFrame = requestAnimationFrame(step);
    };
    countFrame = requestAnimationFrame(step);
  }

  const setBusy = (busy) => el.form.classList.toggle('is-busy', busy);

  // ---------- Events ----------

  let debounceTimer = 0;
  let inFlight = null;

  el.input.addEventListener('input', () => {
    const query = el.input.value.trim();
    clearTimeout(debounceTimer);
    inFlight?.abort();

    if (query.length < 2) {
      closeList();
      setBusy(false);
      return;
    }

    debounceTimer = setTimeout(async () => {
      const token = ++searchToken;
      const controller = new AbortController();
      inFlight = controller;
      setBusy(true);
      try {
        const films = await searchFilms(query, controller.signal);
        if (token !== searchToken) return; // a newer keystroke won
        renderResults(films);
        clearNotice();
      } catch (err) {
        if (err.name === 'AbortError' || token !== searchToken) return;
        closeList();
        showNotice(`Search failed. ${err.message}`);
      } finally {
        if (token === searchToken) setBusy(false);
      }
    }, 250);
  });

  el.input.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveActive(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveActive(-1);
        break;
      case 'Enter':
        if (activeIndex >= 0 && currentResults[activeIndex]) {
          e.preventDefault();
          select(currentResults[activeIndex]);
        }
        break;
      case 'Escape':
        closeList();
        break;
    }
  });

  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (currentResults.length) select(currentResults[Math.max(0, activeIndex)]);
  });

  document.addEventListener('click', (e) => {
    if (!el.form.contains(e.target)) closeList();
  });

  loadAnchors();
})();
