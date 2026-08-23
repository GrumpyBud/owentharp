/* ===========================================================================
   Site behaviour: theme, nav, reveals, counters, timeline trace, skills
   readout, and a command palette. No dependencies.
   =========================================================================== */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  // tells the inline head failsafe that reveals are being managed
  window.__revealReady = true;

  /* ---------- theme ---------- */
  const THEME_KEY = 'ot-theme';
  const root = document.documentElement;

  function readStored() {
    try { return localStorage.getItem(THEME_KEY); } catch (_) { return null; }
  }
  function applyTheme(mode) {
    if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode);
    else root.removeAttribute('data-theme');
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', mode === 'light' ? '#f5f2ec' : '#0a0c12');
  }
  function currentTheme() {
    return root.getAttribute('data-theme')
      || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  }
  applyTheme(readStored());

  function toggleTheme() {
    const next = currentTheme() === 'light' ? 'dark' : 'light';
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch (_) { /* private mode */ }
  }
  const themeBtn = $('[data-act="theme"]');
  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

  /* ---------- nav ---------- */
  const nav = $('.nav');
  if (nav) {
    const onScroll = () => nav.classList.toggle('scrolled', scrollY > 12);
    onScroll();
    addEventListener('scroll', onScroll, { passive: true });
  }

  // both navs highlight together: desktop links and the mobile tab bar
  const navLinks = $$('.nav-links a, .tabbar a');
  const sections = navLinks
    .map((a) => {
      const id = a.getAttribute('href');
      return id && id.startsWith('#') ? document.getElementById(id.slice(1)) : null;
    })
    .filter(Boolean);

  if (sections.length && 'IntersectionObserver' in window) {
    const seen = new Map();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => seen.set(e.target.id, e.intersectionRatio));
      let best = null, bestR = 0;
      seen.forEach((r, id) => { if (r > bestR) { bestR = r; best = id; } });
      navLinks.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + best));
    }, { threshold: [0.12, 0.35, 0.6], rootMargin: '-15% 0px -45% 0px' });
    sections.forEach((s) => io.observe(s));
  }

  /* ---------- reveal on scroll ---------- */
  const revealables = $$('.reveal');
  if (revealables.length) {
    if (!('IntersectionObserver' in window) || reduced.matches) {
      revealables.forEach((el) => el.classList.add('in'));
    } else {
      const io = new IntersectionObserver((entries, obs) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          e.target.classList.add('in');
          obs.unobserve(e.target);
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

      // Show anything already on screen straight away, so above-the-fold
      // content never waits on the observer's first callback.
      revealables.forEach((el) => {
        const b = el.getBoundingClientRect();
        if (b.top < innerHeight && b.bottom > 0) el.classList.add('in');
        else io.observe(el);
      });
    }
  }

  /* ---------- animated counters ---------- */
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  function runCounter(el) {
    const target = parseFloat(el.dataset.count);
    if (!isFinite(target)) return;
    const dec = parseInt(el.dataset.decimals || '0', 10);
    if (reduced.matches) { el.textContent = target.toFixed(dec); return; }
    const dur = 1250;
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      el.textContent = (target * easeOut(p)).toFixed(dec);
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = target.toFixed(dec);
    };
    requestAnimationFrame(tick);
  }

  const counters = $$('[data-count]');
  if (counters.length) {
    if (!('IntersectionObserver' in window)) counters.forEach(runCounter);
    else {
      const io = new IntersectionObserver((entries, obs) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          runCounter(e.target);
          obs.unobserve(e.target);
        });
      }, { threshold: 0.6 });
      counters.forEach((c) => io.observe(c));
    }
  }

  /* ---------- timeline trace ---------- */
  const timeline = $('.timeline');
  const trace = $('.timeline-progress');
  if (timeline && trace) {
    let ticking = false;
    const update = () => {
      ticking = false;
      const r = timeline.getBoundingClientRect();
      const vh = innerHeight;
      // 0 when the top reaches ~70% of the viewport, 1 when the bottom passes ~55%
      const start = vh * 0.7;
      const end = vh * 0.55;
      const total = r.height + (start - end);
      const done = start - r.top;
      const p = Math.max(0, Math.min(1, done / total));
      trace.style.height = (p * r.height) + 'px';
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onScroll, { passive: true });
    update();
  }

  $$('.tl-item').forEach((item) => {
    if (!('IntersectionObserver' in window)) { item.classList.add('in'); return; }
    new IntersectionObserver((entries) => {
      entries.forEach((e) => item.classList.toggle('in', e.isIntersecting));
    }, { rootMargin: '-25% 0px -35% 0px' }).observe(item);
  });

  /* ---------- skills readout ---------- */
  // Tap is the source of truth: iOS Safari does not focus non-form elements
  // on tap, and hover does not exist on touch. Hover/focus remain optional
  // accelerators for pointer and keyboard users.
  $$('.skill[data-uses]').forEach((el) => {
    const group = el.closest('.skill-group');
    const readoutEl = group && group.querySelector('.skill-readout');
    if (!readoutEl) return;
    const body = readoutEl.querySelector('span') || readoutEl;
    const base = body.textContent;

    const show = () => {
      body.innerHTML = '<b>' + el.textContent.trim() + '</b> &rarr; ' + el.dataset.uses;
      readoutEl.classList.add('on');
      el.classList.add('lit');
    };
    const hide = () => {
      body.textContent = base;
      readoutEl.classList.remove('on');
      el.classList.remove('lit');
    };

    el.setAttribute('tabindex', '0');
    el.addEventListener('mouseenter', show);
    el.addEventListener('mouseleave', hide);
    el.addEventListener('focus', show);
    el.addEventListener('blur', hide);
    el.addEventListener('click', () => {
      if (el.classList.contains('lit')) hide(); else show();
    });
  });

  /* ---------- autoplaying clips respect reduced motion ---------- */
  const clips = $$('video[autoplay]');
  if (clips.length) {
    const settle = () => {
      clips.forEach((v) => {
        if (reduced.matches) {
          v.autoplay = false;
          v.removeAttribute('autoplay');
          v.pause();
        }
      });
    };
    settle();
    if (reduced.addEventListener) reduced.addEventListener('change', settle);

    // Don't burn decode work on a clip nobody is looking at — but never
    // restart one the viewer paused themselves.
    if ('IntersectionObserver' in window) {
      let byObserver = false;
      clips.forEach((v) => {
        v.addEventListener('pause', () => { if (!byObserver) v.dataset.userPaused = '1'; });
        v.addEventListener('play', () => { delete v.dataset.userPaused; });
      });
      const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          const v = e.target;
          if (reduced.matches) return;
          if (e.isIntersecting) {
            if (v.dataset.userPaused) return;
            const p = v.play();
            if (p) p.catch(() => { /* autoplay blocked; poster stands in */ });
          } else if (!v.paused) {
            byObserver = true;
            v.pause();
            byObserver = false;
          }
        });
      }, { threshold: 0.2 });
      clips.forEach((v) => io.observe(v));
    }
  }

  /* ---------- marquee: duplicate content for a seamless loop ---------- */
  const track = $('.marquee-track');
  if (track && track.children.length) {
    const html = track.innerHTML;
    track.innerHTML = html + html;
  }

  /* ---------- smooth anchor scrolling ---------- */
  $$('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (ev) => {
      const id = a.getAttribute('href');
      if (!id || id === '#') return;
      const target = document.getElementById(id.slice(1));
      if (!target) return;
      ev.preventDefault();
      target.scrollIntoView({ behavior: reduced.matches ? 'auto' : 'smooth', block: 'start' });
      history.replaceState(null, '', id);
    });
  });

  /* ---------- command palette ---------- */
  const palette = $('.palette');
  if (palette) {
    const input = $('input', palette);
    const list = $('ul', palette);

    const icons = {
      jump: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
      mail: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>',
      ext: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/></svg>',
      cog: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M2 12h3m14 0h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>',
    };

    const commands = [
      ...$$('section[id]').map((s) => ({
        label: (s.dataset.navLabel || (s.querySelector('h2') || {}).textContent || s.id).trim(),
        hint: 'Jump',
        icon: 'jump',
        run: () => document.getElementById(s.id)
          .scrollIntoView({ behavior: reduced.matches ? 'auto' : 'smooth', block: 'start' }),
      })),
      { label: 'Email Owen', hint: 'Contact', icon: 'mail', run: () => { location.href = 'mailto:tharp.owen001@gmail.com'; } },
      { label: 'Open GitHub profile', hint: 'External', icon: 'ext', run: () => window.open('https://github.com/GrumpyBud', '_blank', 'noopener') },
      { label: 'Print / save as PDF', hint: 'Action', icon: 'cog', run: () => print() },
      { label: 'Toggle light / dark theme', hint: 'Action', icon: 'cog', run: toggleTheme },
    ];

    let filtered = commands.slice();
    let idx = 0;

    function render() {
      if (!filtered.length) {
        list.innerHTML = '<li class="empty" role="presentation">No matches</li>';
        return;
      }
      list.innerHTML = filtered.map((c, i) =>
        '<li role="option" aria-selected="' + (i === idx) + '" data-i="' + i + '">' +
        '<span class="ico">' + icons[c.icon] + '</span>' +
        '<span>' + c.label + '</span>' +
        '<span class="hintk">' + c.hint + '</span></li>'
      ).join('');
    }

    function open() {
      palette.classList.add('show');
      palette.setAttribute('aria-hidden', 'false');
      input.value = '';
      filtered = commands.slice();
      idx = 0;
      render();
      setTimeout(() => input.focus(), 30);
    }
    function close() {
      palette.classList.remove('show');
      palette.setAttribute('aria-hidden', 'true');
    }
    function exec(i) {
      const c = filtered[i];
      if (!c) return;
      close();
      setTimeout(c.run, 60);
    }

    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      filtered = q ? commands.filter((c) => c.label.toLowerCase().includes(q)) : commands.slice();
      idx = 0;
      render();
    });

    palette.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'ArrowDown') { idx = (idx + 1) % Math.max(1, filtered.length); render(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { idx = (idx - 1 + filtered.length) % Math.max(1, filtered.length); render(); e.preventDefault(); }
      if (e.key === 'Enter') { exec(idx); e.preventDefault(); }
    });

    list.addEventListener('click', (e) => {
      const li = e.target.closest('li[data-i]');
      if (li) exec(parseInt(li.dataset.i, 10));
    });
    palette.addEventListener('click', (e) => { if (e.target === palette) close(); });

    addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        palette.classList.contains('show') ? close() : open();
      }
    });
    $$('[data-act="palette"]').forEach((b) => b.addEventListener('click', open));
  }

  /* ---------- footer year ---------- */
  const yr = $('[data-year]');
  if (yr) yr.textContent = new Date().getFullYear();
})();
