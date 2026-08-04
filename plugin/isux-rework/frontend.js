/* =========================================================================
   Instant Skeleton UX — reworked renderer
   Drop-in replacement for assets/js/frontend.js (rendering half).

   Reads the same window.ISUX_CONFIG the current plugin writes, so the PHP side
   needs no changes beyond pointing at these two files.

   What changed and why — the three defects behind the broken screenshots:

   1. The overlay was transparent and only "atomic" elements plus raw text
      rects were covered, so everything else — borders, gradients, chips,
      SVG strokes, gaps — stayed fully visible. Here the overlay is opaque and
      filled with the page's own background colour. Nothing can leak, and the
      scan is then free to describe the layout rather than race to hide it.

   2. Colours were sampled from each element's own background, so a turquoise
      button produced a turquoise skeleton and a red chip a red one. The
      palette is now decided once for the page and applied to every shape.

   3. Text was painted at full line-box height, producing solid slabs. Lines
      are now bars of ~0.58 of the line box, vertically centred, with the last
      line of a paragraph tapered.

   The navigation / AJAX layer of the original file is deliberately not
   duplicated here; keep yours and call ISUXRenderer.build() where it called
   buildMirror(). See README.md.
   ========================================================================= */
(function () {
	'use strict';

	var CFG = window.ISUX_CONFIG || {};
	var doc = document;
	var root = doc.documentElement;

	var MAX_SHAPES = Number(CFG.maxShapes) || 400;
	var BUFFER = Number(CFG.scanBuffer) || 120;

	var state = {
		overlay: null,
		layer: null,
		visible: false,
		shownAt: 0,
		shapes: 0,
		palette: null,
		progress: 0,
		timers: {},
		teardown: []
	};

	/* ------------------------------------------------------------------ *
	 *  Element classification
	 * ------------------------------------------------------------------ */

	var ATOM = [
		'img', 'picture', 'video', 'canvas', 'iframe', 'object', 'embed', 'svg',
		'input:not([type="hidden"])', 'select', 'textarea', 'button',
		'[role="button"]', 'progress', 'meter',
		'.btn', '.button', '.wp-element-button', '.elementor-button'
	].join(',');

	// Children that keep an element a single run of text rather than a container.
	var INLINE = {
		A: 1, ABBR: 1, B: 1, BDI: 1, BDO: 1, BR: 1, CITE: 1, CODE: 1, DATA: 1,
		DFN: 1, EM: 1, I: 1, KBD: 1, MARK: 1, Q: 1, S: 1, SAMP: 1, SMALL: 1,
		SPAN: 1, STRONG: 1, SUB: 1, SUP: 1, TIME: 1, U: 1, VAR: 1, WBR: 1
	};

	function matches(el, selector) {
		if (!el || el.nodeType !== 1 || !selector) return false;
		try { return el.matches(selector); } catch (e) { return false; }
	}

	function closest(el, selector) {
		if (!el || el.nodeType !== 1 || !selector) return null;
		try { return el.closest(selector); } catch (e) { return null; }
	}

	function isPreserved(el) {
		if (!el || el === state.overlay || closest(el, '.sk-overlay')) return true;
		if (closest(el, CFG.excludeSkeletonSelectors)) return true;
		if (closest(el, CFG.preserveSelectors)) return true;
		return false;
	}

	function isAtom(el) {
		return matches(el, ATOM);
	}

	function isTextLeaf(el) {
		if (!(el.textContent || '').trim()) return false;
		for (var i = 0; i < el.children.length; i++) {
			var child = el.children[i];
			if (!INLINE[child.tagName] || isAtom(child)) return false;
		}
		return true;
	}

	/* A card: something with its own surface that holds other things. Drawn as
	   a quiet rounded rect so the composition still reads, with the blocks
	   inside painted on top. */
	function isSurface(el, rect, cs, viewportArea) {
		if (!el.children.length) return false;
		var area = rect.width * rect.height;
		if (area < 4000 || area > viewportArea * 0.45) return false;

		var bg = parseColor(cs.backgroundColor);
		if (bg && bg.a > 0.04) return true;

		/* A single hairline — a section divider, an underlined stats row — is not
		   a card. Only a frame on all four sides counts, and only with a radius,
		   which is what actually distinguishes a card from a ruled group. */
		var framed = parseFloat(cs.borderTopWidth) > 0 && parseFloat(cs.borderRightWidth) > 0 &&
			parseFloat(cs.borderBottomWidth) > 0 && parseFloat(cs.borderLeftWidth) > 0;
		var rounded = parseFloat(cs.borderTopLeftRadius) > 2;

		if (framed && rounded) return true;
		return !!(cs.boxShadow && cs.boxShadow !== 'none' && rounded);
	}

	/* ------------------------------------------------------------------ *
	 *  Palette — decided once, never per element
	 * ------------------------------------------------------------------ */

	function parseColor(value) {
		var text = String(value || '').trim();
		var m = text.match(/^rgba?\(([^)]+)\)$/i);
		if (m) {
			var p = m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat);
			if (p.length >= 3) return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
		}
		m = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
		if (m) {
			var hex = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
			return {
				r: parseInt(hex.slice(0, 2), 16),
				g: parseInt(hex.slice(2, 4), 16),
				b: parseInt(hex.slice(4, 6), 16),
				a: 1
			};
		}
		return null;
	}

	function luminance(c) {
		function ch(v) {
			v /= 255;
			return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
		}
		return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
	}

	function mix(a, b, amount) {
		return 'rgb(' +
			Math.round(a.r + (b.r - a.r) * amount) + ',' +
			Math.round(a.g + (b.g - a.g) * amount) + ',' +
			Math.round(a.b + (b.b - a.b) * amount) + ')';
	}

	/* The page's real background, so the overlay can hide the page without
	   announcing itself as a white (or black) sheet. */
	function pageBackdrop() {
		var forced = parseColor(CFG.backdrop);
		if (forced) return forced;

		var nodes = [doc.body, root];
		for (var i = 0; i < nodes.length; i++) {
			if (!nodes[i]) continue;
			var c = parseColor(window.getComputedStyle(nodes[i]).backgroundColor);
			if (c && c.a > 0.9) return c;
		}
		var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
		return dark ? { r: 20, g: 20, b: 20, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
	}

	function buildPalette() {
		var backdrop = pageBackdrop();
		var dark;
		if (CFG.themeMode === 'dark') dark = true;
		else if (CFG.themeMode === 'light') dark = false;
		else dark = luminance(backdrop) < 0.42;

		var toward = dark ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 };
		var steps = dark ? [0.055, 0.14, 0.26] : [0.05, 0.12, 0.22];

		return {
			backdrop: 'rgb(' + backdrop.r + ',' + backdrop.g + ',' + backdrop.b + ')',
			surface: mix(backdrop, toward, steps[0]),
			block: mix(backdrop, toward, steps[1]),
			highlight: mix(backdrop, toward, steps[2]),
			dark: dark
		};
	}

	function applyPalette(palette) {
		root.style.setProperty('--sk-backdrop', palette.backdrop);
		root.style.setProperty('--sk-surface', palette.surface);
		root.style.setProperty('--sk-block', palette.block);
		root.style.setProperty('--sk-hi', palette.highlight);
	}

	/* ------------------------------------------------------------------ *
	 *  Painting
	 * ------------------------------------------------------------------ */

	function onScreen(rect) {
		return rect.width >= 3 && rect.height >= 3 &&
			rect.bottom >= -BUFFER && rect.top <= window.innerHeight + BUFFER &&
			rect.right >= -BUFFER && rect.left <= window.innerWidth + BUFFER;
	}

	/* Deliberately does NOT test opacity. Scroll-reveal effects (AOS, WOW,
	   Elementor entrance animations, and the hand-rolled kind) park blocks at
	   opacity:0 until they scroll into view. Those elements still occupy their
	   layout box, so the skeleton must describe them — treating them as hidden
	   is what leaves a page with entrance animations almost blank. Only
	   display:none and visibility:hidden remove the box. */
	function visible(el, cs) {
		return cs.display !== 'none' &&
			cs.visibility !== 'hidden' &&
			cs.contentVisibility !== 'hidden';
	}

	function radiusOf(cs, rect) {
		var value = parseFloat(cs.borderTopLeftRadius);
		if (!isFinite(value)) value = 10;
		return Math.max(0, Math.min(value, Math.min(rect.width, rect.height) / 2));
	}

	function push(fragment, rect, kind, radius) {
		if (state.shapes >= MAX_SHAPES) return false;

		var left = Math.max(0, rect.left);
		var top = Math.max(0, rect.top);
		var width = Math.min(window.innerWidth, rect.right) - left;
		var height = Math.min(window.innerHeight, rect.bottom) - top;
		if (width < 3 || height < 3) return false;

		var shape = doc.createElement('span');
		shape.className = 'sk-shape';
		shape.setAttribute('data-kind', kind);
		shape.style.setProperty('--sk-x', left.toFixed(1) + 'px');
		shape.style.setProperty('--sk-y', top.toFixed(1) + 'px');
		if (radius != null) shape.style.setProperty('--sk-shape-radius', radius.toFixed(1) + 'px');
		shape.style.width = width.toFixed(1) + 'px';
		shape.style.height = height.toFixed(1) + 'px';

		fragment.appendChild(shape);
		state.shapes += 1;
		return true;
	}

	/* Deterministic taper for the last line of a paragraph — a fixed sequence
	   rather than Math.random(), so a rebuild on resize does not reshuffle it. */
	var TAPER = [0.72, 0.58, 0.81, 0.64, 0.76, 0.55, 0.69, 0.84];

	function paintText(fragment, el, index) {
		var range = doc.createRange();
		range.selectNodeContents(el);
		var rects = Array.prototype.slice.call(range.getClientRects());
		if (range.detach) range.detach();
		if (!rects.length) return;

		// Inline children fragment a line into several rects; merge by line.
		var lines = [];
		rects.forEach(function (r) {
			if (r.width < 1 || r.height < 1) return;
			var key = Math.round(r.top / 2);
			var line = lines.filter(function (l) { return Math.abs(l.key - key) <= 1; })[0];
			if (line) {
				line.left = Math.min(line.left, r.left);
				line.right = Math.max(line.right, r.right);
				line.top = Math.min(line.top, r.top);
				line.bottom = Math.max(line.bottom, r.bottom);
			} else {
				lines.push({ key: key, left: r.left, right: r.right, top: r.top, bottom: r.bottom });
			}
		});

		lines.sort(function (a, b) { return a.top - b.top; });

		lines.forEach(function (line, i) {
			var lineHeight = line.bottom - line.top;
			// A bar, not the whole line box — this is what reads as "text".
			var height = Math.max(6, Math.min(lineHeight * 0.58, 26));
			var top = line.top + (lineHeight - height) / 2;
			var width = line.right - line.left;

			if (lines.length > 1 && i === lines.length - 1) {
				width *= TAPER[(index + i) % TAPER.length];
			}

			var rect = { left: line.left, top: top, right: line.left + width, bottom: top + height,
				width: width, height: height };
			if (onScreen(rect)) push(fragment, rect, 'text', height / 2);
		});
	}

	/* One top-down pass. Each branch stops as soon as it has described what is
	   there — the previous build collected every atom plus every text node in
	   the document and then sorted them, which is where the doubled and
	   offset shapes came from. */
	function scan(scope, fragment) {
		var viewportArea = window.innerWidth * window.innerHeight;
		var forced = CFG.forcedSelectors || '[data-isux-skeleton]';
		var index = 0;

		(function walk(el) {
			if (state.shapes >= MAX_SHAPES || !el || el.nodeType !== 1) return;
			if (isPreserved(el)) return;

			var cs = window.getComputedStyle(el);
			if (!visible(el, cs)) return;

			var rect = el.getBoundingClientRect();
			if (!onScreen(rect)) {
				// Off-screen containers can still hold on-screen children.
				if (rect.bottom < -BUFFER || rect.top > window.innerHeight + BUFFER) return;
			}

			var override = (el.getAttribute('data-isux-skeleton') || '').toLowerCase();
			if (override === 'ignore') return;

			if (override === 'circle' || override === 'pill') {
				push(fragment, rect, 'pill', Math.max(rect.width, rect.height));
				return;
			}
			if (override === 'box' || matches(el, forced)) {
				push(fragment, rect, 'block', radiusOf(cs, rect));
				return;
			}

			if (isAtom(el)) {
				var r = radiusOf(cs, rect);
				var square = Math.abs(rect.width - rect.height) < 3;
				push(fragment, rect, square && r >= Math.min(rect.width, rect.height) * 0.45 ? 'pill' : 'block', r);
				return;
			}

			/* Surface before text: a bordered box that happens to contain only
			   text — a chip, a stat tile, a placeholder — needs its frame drawn
			   as well as its line, otherwise the box vanishes from the skeleton. */
			if (isSurface(el, rect, cs, viewportArea)) {
				push(fragment, rect, 'surface', radiusOf(cs, rect));
			}

			if (isTextLeaf(el)) {
				paintText(fragment, el, index++);
				return;
			}

			for (var i = 0; i < el.children.length; i++) walk(el.children[i]);
		})(scope);
	}

	/* ------------------------------------------------------------------ *
	 *  Overlay lifecycle
	 * ------------------------------------------------------------------ */

	function mount() {
		if (state.overlay && doc.body && doc.body.contains(state.overlay)) return state.overlay;
		if (!doc.body) return null;

		var overlay = doc.getElementById('sk-overlay');
		if (!overlay) {
			overlay = doc.createElement('div');
			overlay.id = 'sk-overlay';
			overlay.className = 'sk-overlay';
			overlay.setAttribute('role', 'status');
			overlay.setAttribute('aria-live', 'polite');
			overlay.innerHTML =
				'<div class="sk-layer" aria-hidden="true"></div>' +
				'<div class="sk-progress" aria-hidden="true"><span></span></div>' +
				'<div class="sk-badge" aria-hidden="true"></div>' +
				'<span class="sk-sr"></span>';
			overlay.hidden = true;
			doc.body.insertBefore(overlay, doc.body.firstChild);
		}

		state.overlay = overlay;
		state.layer = overlay.querySelector('.sk-layer');
		return overlay;
	}

	function build(scopeOverride) {
		var overlay = mount();
		if (!overlay || !state.layer) return 0;

		var scope = scopeOverride;
		if (!scope || scope.nodeType !== 1) {
			try { scope = doc.querySelector(CFG.scopeSelector || 'body'); } catch (e) { scope = null; }
		}
		scope = scope || doc.body;

		if (!state.palette) state.palette = buildPalette();
		applyPalette(state.palette);

		state.shapes = 0;
		var fragment = doc.createDocumentFragment();
		scan(scope, fragment);

		state.layer.textContent = '';
		state.layer.appendChild(fragment);

		var badge = overlay.querySelector('.sk-badge');
		overlay.classList.toggle('is-debug', !!(CFG.debug || CFG.preview));
		if (badge) badge.textContent = 'skeleton: ' + state.shapes + ' shapes';

		return state.shapes;
	}

	function motion() {
		root.classList.remove('sk-anim-shimmer', 'sk-anim-pulse', 'sk-anim-none');
		var animation = CFG.animation || 'shimmer';
		var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
		var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		var weak = !!(CFG.networkAware && conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || '')));
		if (reduce || weak) animation = 'none';
		root.classList.add('sk-anim-' + animation);
	}

	function setProgress(value) {
		state.progress = Math.max(0, Math.min(100, value));
		var bar = state.overlay && state.overlay.querySelector('.sk-progress > span');
		if (bar) bar.style.width = state.progress + '%';
	}

	function startProgress() {
		window.clearInterval(state.timers.progress);
		setProgress(8);
		state.timers.progress = window.setInterval(function () {
			var step = state.progress < 60 ? 5 + Math.random() * 6 : state.progress < 88 ? 1 + Math.random() * 2.5 : 0.3;
			setProgress(Math.min(94, state.progress + step));
		}, 260);
	}

	function say(text) {
		var sr = state.overlay && state.overlay.querySelector('.sk-sr');
		if (sr) sr.textContent = text;
	}

	function observe() {
		release();
		var handler = function () {
			window.clearTimeout(state.timers.rebuild);
			state.timers.rebuild = window.setTimeout(function () {
				window.requestAnimationFrame(function () { if (state.visible) build(); });
			}, 90);
		};
		window.addEventListener('resize', handler, { passive: true });
		state.teardown.push(function () { window.removeEventListener('resize', handler); });
	}

	function release() {
		state.teardown.forEach(function (stop) { try { stop(); } catch (e) {} });
		state.teardown = [];
		window.clearTimeout(state.timers.rebuild);
	}

	function show(reason, scope) {
		var overlay = mount();
		if (!overlay) return false;

		window.clearTimeout(state.timers.hide);
		window.clearTimeout(state.timers.failsafe);

		state.visible = true;
		state.shownAt = performance.now();

		overlay.hidden = false;
		overlay.classList.remove('is-hiding');
		overlay.classList.toggle('no-progress', !CFG.progressBar);
		overlay.setAttribute('aria-hidden', 'false');
		root.classList.add(reason === 'navigation' ? 'sk-navigating' : 'sk-loading');
		if (CFG.lockScroll && doc.body) doc.body.classList.add('sk-scroll-locked');

		motion();
		build(scope);
		observe();
		say((CFG.messages && CFG.messages.loading) || 'Loading');
		startProgress();

		state.timers.failsafe = window.setTimeout(function () {
			hide('failsafe', true);
		}, Math.max(1000, Number(CFG.maxDuration) || 15000));

		return true;
	}

	function hide(reason, immediate) {
		var overlay = state.overlay;
		if (!overlay || !state.visible) {
			root.classList.remove('sk-loading', 'sk-navigating');
			if (doc.body) doc.body.classList.remove('sk-scroll-locked');
			return;
		}

		var elapsed = performance.now() - state.shownAt;
		var wait = immediate ? 0 : Math.max(0, (Number(CFG.minDuration) || 0) - elapsed);

		window.clearTimeout(state.timers.hide);
		state.timers.hide = window.setTimeout(function () {
			window.clearTimeout(state.timers.failsafe);
			window.clearInterval(state.timers.progress);
			release();
			setProgress(100);
			say((CFG.messages && CFG.messages.loaded) || 'Loaded');

			overlay.classList.add('is-hiding');
			overlay.setAttribute('aria-hidden', 'true');
			root.classList.remove('sk-loading', 'sk-navigating');
			if (doc.body) doc.body.classList.remove('sk-scroll-locked');

			window.setTimeout(function () {
				overlay.hidden = true;
				overlay.classList.remove('is-hiding');
				if (state.layer) state.layer.textContent = '';
				state.shapes = 0;
				setProgress(0);
				state.visible = false;
			}, immediate ? 0 : 210);
		}, wait);
	}

	/* ------------------------------------------------------------------ *
	 *  Boot
	 * ------------------------------------------------------------------ */

	function ready() {
		var waits = [];
		if (CFG.revealEvent === 'load' && doc.readyState !== 'complete') {
			waits.push(new Promise(function (r) { window.addEventListener('load', r, { once: true }); }));
		}
		if (CFG.waitFonts && doc.fonts && doc.fonts.ready) {
			waits.push(Promise.resolve(doc.fonts.ready).catch(function () {}));
		}
		return Promise.all(waits);
	}

	function start() {
		motion();
		if (!CFG.initialLoader) return;
		show('initial');
		ready().then(function () {
			window.requestAnimationFrame(function () {
				build();
				hide('ready');
			});
		});
	}

	if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
	else start();

	if (CFG.pauseHidden) {
		doc.addEventListener('visibilitychange', function () {
			root.classList.toggle('sk-paused', doc.hidden);
		});
	}

	window.addEventListener('pageshow', function (e) { if (e.persisted) hide('bfcache', true); });

	/* Renderer API — call build() from your own navigation code. */
	window.ISUXRenderer = {
		build: build,
		clear: function () { if (state.layer) state.layer.textContent = ''; state.shapes = 0; },
		palette: function () { return state.palette || (state.palette = buildPalette()); }
	};

	window.InstantSkeletonUX = {
		version: CFG.version,
		show: show,
		hide: hide,
		rebuild: build,
		getState: function () {
			return { visible: state.visible, progress: state.progress, shapes: state.shapes };
		}
	};
})();
