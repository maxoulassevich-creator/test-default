/* =========================================================================
   Wrbet Kenya — landing behaviour
   Vanilla JS, no dependencies. Every effect degrades gracefully.
   ========================================================================= */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 1. Mobile drawer ---------- */
  (function drawer() {
    var burger = document.getElementById('burger');
    var panel  = document.getElementById('drawer');
    if (!burger || !panel) return;

    var lastFocused = null;

    function open() {
      lastFocused = document.activeElement;
      panel.hidden = false;
      // next frame so the transition has a starting state to animate from
      requestAnimationFrame(function () { panel.classList.add('is-open'); });
      burger.setAttribute('aria-expanded', 'true');
      document.body.classList.add('is-locked');
      var first = panel.querySelector('.drawer__close');
      if (first) first.focus();
    }

    function close() {
      panel.classList.remove('is-open');
      burger.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('is-locked');
      window.setTimeout(function () { panel.hidden = true; }, reduceMotion ? 0 : 340);
      if (lastFocused) lastFocused.focus();
    }

    burger.addEventListener('click', function () {
      burger.getAttribute('aria-expanded') === 'true' ? close() : open();
    });

    panel.addEventListener('click', function (e) {
      if (e.target.closest('[data-close-drawer]') || e.target.closest('.drawer__link') ||
          e.target.closest('.drawer__cta')) close();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !panel.hidden) close();
    });

    // keep focus inside the panel while it is open
    panel.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var items = panel.querySelectorAll('a[href], button:not([disabled])');
      if (!items.length) return;
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    // a resize past the desktop breakpoint leaves the drawer orphaned otherwise
    window.matchMedia('(min-width: 1024px)').addEventListener('change', function (e) {
      if (e.matches && !panel.hidden) close();
    });
  })();

  /* ---------- 2. Sticky header state ---------- */
  (function stickyHeader() {
    var header = document.getElementById('siteHeader');
    var toTop  = document.getElementById('toTop');
    if (!header) return;

    var ticking = false;
    function update() {
      var y = window.scrollY;
      header.classList.toggle('is-stuck', y > 8);
      if (toTop) toTop.classList.toggle('is-visible', y > window.innerHeight * 0.9);
      ticking = false;
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();

    if (toTop) {
      toTop.addEventListener('click', function () {
        window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
      });
    }
  })();

  /* ---------- 3. Scrollspy ---------- */
  (function scrollspy() {
    var links = Array.prototype.slice.call(document.querySelectorAll('.nav__link'));
    if (!links.length || !('IntersectionObserver' in window)) return;

    var map = {};
    var targets = [];
    links.forEach(function (link) {
      var id = link.getAttribute('href');
      if (!id || id.charAt(0) !== '#') return;
      var section = document.querySelector(id);
      if (section) { map[id.slice(1)] = link; targets.push(section); }
    });

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        links.forEach(function (l) { l.classList.remove('is-active'); });
        var active = map[entry.target.id];
        if (active) active.classList.add('is-active');
      });
    }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });

    targets.forEach(function (t) { observer.observe(t); });
  })();

  /* ---------- 4. Reveal on scroll ---------- */
  (function reveal() {
    var items = Array.prototype.slice.call(document.querySelectorAll('[data-reveal]'));
    if (!items.length) return;

    if (reduceMotion || !('IntersectionObserver' in window)) {
      items.forEach(function (el) { el.classList.add('is-visible'); });
      return;
    }

    items.forEach(function (el) {
      var d = el.getAttribute('data-reveal-delay');
      if (d) el.style.setProperty('--reveal-delay', d + 'ms');
    });

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });

    items.forEach(function (el) { observer.observe(el); });
  })();

  /* ---------- 5. Hero stat counters ---------- */
  (function counters() {
    var nodes = Array.prototype.slice.call(document.querySelectorAll('[data-count]'));
    if (!nodes.length || reduceMotion || !('IntersectionObserver' in window)) return;

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        observer.unobserve(el);

        var target = parseFloat(el.getAttribute('data-count')) || 0;
        var suffix = el.getAttribute('data-suffix') || '';
        var start = null;
        var duration = 1100;

        function tick(ts) {
          if (start === null) start = ts;
          var p = Math.min((ts - start) / duration, 1);
          var eased = 1 - Math.pow(1 - p, 3);
          el.textContent = Math.round(target * eased) + suffix;
          if (p < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      });
    }, { threshold: 0.5 });

    nodes.forEach(function (n) { observer.observe(n); });
  })();

  /* ---------- 6. Crash multiplier loop (decorative) ---------- */
  (function crash() {
    var nodes = Array.prototype.slice.call(document.querySelectorAll('[data-crash]'));
    if (!nodes.length || reduceMotion) return;

    var value = 1;
    var running = true;
    var target = 2 + Math.random() * 6;

    // pause while the tab is hidden so we are not burning frames in the background
    document.addEventListener('visibilitychange', function () {
      running = !document.hidden;
      if (running) requestAnimationFrame(step);
    });

    var last = 0;
    function step(ts) {
      if (!running) return;
      if (!last) last = ts;
      var dt = Math.min((ts - last) / 1000, 0.05);
      last = ts;

      value += dt * (0.35 + value * 0.32);

      if (value >= target) {
        value = 1;
        target = 1.2 + Math.random() * 7;
      }
      var text = value.toFixed(2) + 'x';
      nodes.forEach(function (n) { n.textContent = text; });
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  })();

  /* ---------- 7. FAQ — one open at a time ---------- */
  (function faq() {
    var items = Array.prototype.slice.call(document.querySelectorAll('.faq__item'));
    if (!items.length) return;

    items.forEach(function (item) {
      item.addEventListener('toggle', function () {
        if (!item.open) return;
        items.forEach(function (other) { if (other !== item) other.open = false; });
      });
    });
  })();

  /* ---------- 8. Smooth anchor scrolling with header offset ---------- */
  (function anchors() {
    document.addEventListener('click', function (e) {
      var link = e.target.closest('a[href^="#"]');
      if (!link) return;
      var id = link.getAttribute('href');
      if (!id || id === '#') return;
      var target = document.querySelector(id);
      if (!target) return;

      e.preventDefault();
      target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      // keep the URL shareable without the jump the default anchor would cause
      history.replaceState(null, '', id);
    });
  })();
})();
