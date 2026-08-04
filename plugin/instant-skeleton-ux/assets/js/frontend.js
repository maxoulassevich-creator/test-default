/* =========================================================================
   Instant Skeleton UX — front-end runtime

   2.1 replaces the renderer. The lifecycle, the AJAX navigation layer and the
   WooCommerce / Elementor adapters are carried over from 2.0.

   Why the renderer was rewritten — the four defects behind the broken output:

   1. The overlay was transparent and only "atomic" elements plus raw text
      rects were covered, so borders, gradients, chips, SVG strokes and every
      gap between two shapes stayed visible. The overlay is now opaque, filled
      with the page's own background colour.

   2. Colours came from nearestBackdrop(), which starts at the element and
      walks up — so a button with background:#00FFF7 produced a turquoise
      skeleton, and a translucent white fill produced near-white boxes on a
      near-black page. The palette is now decided once per page.

   3. Text was painted at full line-box height, which reads as slabs. Lines are
      now bars at 0.58 of the line box, centred, with the last line tapered.

   4. Anything at opacity 0 was skipped along with its whole subtree — which is
      exactly where scroll-reveal effects park content until it enters the
      viewport. Only display / visibility / content-visibility stop the walk.
   ========================================================================= */
(function () {
	'use strict';

	var config = window.ISUX_CONFIG || {};
	if (!config.version) return;

	var doc = document;
	var root = doc.documentElement;

	var MAX_SHAPES = Number(config.maxShapes) || 400;
	var BUFFER = Number(config.scanBuffer) || 120;

	var state = {
		overlay: null,
		layer: null,
		visible: false,
		shownAt: window.ISUX_BOOT_STARTED || now(),
		progress: 0,
		shapes: 0,
		palette: null,
		timers: {},
		teardown: [],
		navigationController: null,
		navigationSerial: 0,
		visibilitySerial: 0
	};

	function now() {
		return window.performance && performance.now ? performance.now() : Date.now();
	}

	function log() {
		if (!config.debug || !window.console) return;
		var args = Array.prototype.slice.call(arguments);
		args.unshift('[ISUX]');
		console.log.apply(console, args);
	}

	function emit(name, detail, cancelable) {
		var event;
		try {
			event = new CustomEvent(name, { detail: detail || {}, bubbles: true, cancelable: !!cancelable });
		} catch (error) {
			event = doc.createEvent('CustomEvent');
			event.initCustomEvent(name, true, !!cancelable, detail || {});
		}
		doc.dispatchEvent(event);
		return event;
	}

	function matches(el, selector) {
		if (!el || el.nodeType !== 1 || !selector) return false;
		try { return el.matches(selector); } catch (error) { return false; }
	}

	function closest(el, selector) {
		if (!el || el.nodeType !== 1 || !selector) return null;
		try { return el.closest(selector); } catch (error) { return null; }
	}

	function queryAll(scope, selector) {
		if (!scope || !selector) return [];
		try { return Array.prototype.slice.call(scope.querySelectorAll(selector)); } catch (error) {
			log('Некорректный CSS-селектор:', selector, error);
			return [];
		}
	}

	/* ------------------------------------------------------------------ *
	 *  Overlay
	 * ------------------------------------------------------------------ */

	function mountOverlay() {
		if (state.overlay && doc.body && doc.body.contains(state.overlay)) return state.overlay;

		var existing = doc.getElementById('isux-overlay');
		if (existing) {
			state.overlay = existing;
			state.layer = existing.querySelector('.isux-shape-layer');
			return existing;
		}

		/* PHP prints the overlay on wp_body_open. Older themes never fire that
		   hook, so build it here rather than silently doing nothing. */
		if (!doc.body) return null;
		var overlay = doc.createElement('div');
		overlay.id = 'isux-overlay';
		overlay.className = 'isux-overlay';
		overlay.setAttribute('role', 'status');
		overlay.setAttribute('aria-live', 'polite');
		overlay.hidden = true;
		overlay.innerHTML =
			'<div class="isux-shape-layer" aria-hidden="true"></div>' +
			'<div class="isux-progress" aria-hidden="true"><span></span></div>' +
			'<div class="isux-debug-badge" aria-hidden="true"></div>' +
			'<span class="isux-sr-message"></span>';

		doc.body.insertBefore(overlay, doc.body.firstChild);
		state.overlay = overlay;
		state.layer = overlay.querySelector('.isux-shape-layer');
		return overlay;
	}

	/* ------------------------------------------------------------------ *
	 *  Palette — one decision for the whole page
	 * ------------------------------------------------------------------ */

	function parseColor(value) {
		var text = String(value || '').trim();
		var m = text.match(/^rgba?\(([^)]+)\)$/i);
		if (m) {
			var parts = m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat);
			if (parts.length >= 3) {
				return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
			}
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

	function pageBackdrop() {
		var forced = parseColor(config.backdrop);
		if (forced) return forced;

		var nodes = [doc.body, root];
		for (var i = 0; i < nodes.length; i++) {
			if (!nodes[i]) continue;
			var color = parseColor(window.getComputedStyle(nodes[i]).backgroundColor);
			if (color && color.a > 0.9) return color;
		}
		var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
		return dark ? { r: 20, g: 20, b: 20, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
	}

	function buildPalette() {
		var backdrop = pageBackdrop();
		var dark;
		if (config.themeMode === 'dark') dark = true;
		else if (config.themeMode === 'light') dark = false;
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
		root.style.setProperty('--isux-backdrop', palette.backdrop);
		root.style.setProperty('--isux-surface', palette.surface);
		root.style.setProperty('--isux-block', palette.block);
		root.style.setProperty('--isux-hi', palette.highlight);
	}

	/* ------------------------------------------------------------------ *
	 *  Classification
	 * ------------------------------------------------------------------ */

	var ATOM = [
		'img', 'picture', 'video', 'canvas', 'iframe', 'object', 'embed', 'svg',
		'input:not([type="hidden"])', 'select', 'textarea', 'button',
		'[role="button"]', 'progress', 'meter',
		'.btn', '.button', '.wp-element-button', '.elementor-button',
		'.woocommerce a.button', '.woocommerce button.button'
	].join(',');

	var INLINE = {
		A: 1, ABBR: 1, B: 1, BDI: 1, BDO: 1, BR: 1, CITE: 1, CODE: 1, DATA: 1,
		DFN: 1, EM: 1, I: 1, KBD: 1, MARK: 1, Q: 1, S: 1, SAMP: 1, SMALL: 1,
		SPAN: 1, STRONG: 1, SUB: 1, SUP: 1, TIME: 1, U: 1, VAR: 1, WBR: 1
	};

	function isPreserved(el) {
		if (!el || el === state.overlay || closest(el, '#isux-overlay')) return true;
		if (closest(el, config.excludeSkeletonSelectors)) return true;
		if (closest(el, config.preserveSelectors)) return true;
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

	function isSurface(el, rect, cs, viewportArea) {
		if (!el.children.length) return false;
		var area = rect.width * rect.height;
		if (area < 4000 || area > viewportArea * 0.45) return false;

		var bg = parseColor(cs.backgroundColor);
		if (bg && bg.a > 0.04) return true;

		/* A single hairline — a section divider, an underlined stats row — is
		   not a card. A frame on all four sides with a radius is. */
		var framed = parseFloat(cs.borderTopWidth) > 0 && parseFloat(cs.borderRightWidth) > 0 &&
			parseFloat(cs.borderBottomWidth) > 0 && parseFloat(cs.borderLeftWidth) > 0;
		var rounded = parseFloat(cs.borderTopLeftRadius) > 2;

		if (framed && rounded) return true;
		return !!(cs.boxShadow && cs.boxShadow !== 'none' && rounded);
	}

	/* Deliberately does not test opacity: scroll-reveal effects (AOS, WOW,
	   Elementor entrance animations, hand-rolled IntersectionObservers) park
	   blocks at opacity:0 until they scroll into view. Those still occupy their
	   layout box, and skipping them is what leaves such a page nearly blank. */
	function isVisible(cs) {
		return cs.display !== 'none' &&
			cs.visibility !== 'hidden' &&
			cs.contentVisibility !== 'hidden';
	}

	/* ------------------------------------------------------------------ *
	 *  Painting
	 * ------------------------------------------------------------------ */

	function onScreen(rect) {
		return rect.width >= 3 && rect.height >= 3 &&
			rect.bottom >= -BUFFER && rect.top <= window.innerHeight + BUFFER &&
			rect.right >= -BUFFER && rect.left <= window.innerWidth + BUFFER;
	}

	function radiusOf(cs, rect) {
		if (!config.respectRadius) {
			var fallback = parseFloat(getComputedStyle(root).getPropertyValue('--isux-radius'));
			return isFinite(fallback) ? fallback : 10;
		}
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
		shape.className = 'isux-shape';
		shape.setAttribute('data-isux-kind', kind);
		shape.style.setProperty('--isux-x', left.toFixed(1) + 'px');
		shape.style.setProperty('--isux-y', top.toFixed(1) + 'px');
		if (radius != null) shape.style.setProperty('--isux-shape-radius', radius.toFixed(1) + 'px');
		shape.style.width = width.toFixed(1) + 'px';
		shape.style.height = height.toFixed(1) + 'px';

		fragment.appendChild(shape);
		state.shapes += 1;
		return true;
	}

	/* Fixed sequence rather than Math.random(), so rebuilding on resize does
	   not reshuffle every paragraph's last line. */
	var TAPER = [0.72, 0.58, 0.81, 0.64, 0.76, 0.55, 0.69, 0.84];

	function paintText(fragment, el, index) {
		var range = doc.createRange();
		range.selectNodeContents(el);
		var rects = Array.prototype.slice.call(range.getClientRects());
		if (range.detach) range.detach();
		if (!rects.length) return;

		// Inline children split a line into several rects; merge them per line.
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
			var height = Math.max(6, Math.min(lineHeight * 0.58, 26));
			var top = line.top + (lineHeight - height) / 2;
			var width = line.right - line.left;

			if (lines.length > 1 && i === lines.length - 1) {
				width *= TAPER[(index + i) % TAPER.length];
			}

			var rect = {
				left: line.left, top: top, right: line.left + width, bottom: top + height,
				width: width, height: height
			};
			if (onScreen(rect)) push(fragment, rect, 'text', height / 2);
		});
	}

	/* One top-down pass. 2.0 collected every atom in the scope, then every text
	   node, sorted by depth and de-duplicated by containment — which is where
	   the doubled and offset shapes came from. Each branch here stops as soon
	   as it has described what is there. */
	function scan(scope, fragment) {
		var viewportArea = window.innerWidth * window.innerHeight;
		var forced = config.forcedSelectors || '[data-isux-skeleton]';
		var index = 0;

		(function walk(el) {
			if (state.shapes >= MAX_SHAPES || !el || el.nodeType !== 1) return;
			if (isPreserved(el)) return;

			var cs = window.getComputedStyle(el);
			if (!isVisible(cs)) return;

			var rect = el.getBoundingClientRect();
			if (rect.bottom < -BUFFER || rect.top > window.innerHeight + BUFFER) return;

			var override = (el.getAttribute('data-isux-skeleton') || '').toLowerCase();
			if (override === 'ignore') return;

			if (override === 'circle' || override === 'pill') {
				push(fragment, rect, 'pill', Math.max(rect.width, rect.height));
				return;
			}
			if (override === 'box' || (override !== 'text' && matches(el, forced))) {
				push(fragment, rect, 'block', radiusOf(cs, rect));
				return;
			}

			if (isAtom(el)) {
				var radius = radiusOf(cs, rect);
				var square = Math.abs(rect.width - rect.height) < 3;
				var round = square && radius >= Math.min(rect.width, rect.height) * 0.45;
				push(fragment, rect, round ? 'pill' : 'block', radius);
				return;
			}

			/* Surface before text: a bordered box holding only text — a chip, a
			   stat tile, a placeholder — needs its frame as well as its line. */
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

	function buildMirror(scopeOverride) {
		var overlay = mountOverlay();
		if (!overlay || !state.layer) return 0;

		var scope = scopeOverride;
		if (!scope || scope.nodeType !== 1) {
			try { scope = doc.querySelector(config.scopeSelector || 'body'); } catch (error) { scope = null; }
		}
		scope = scope || doc.body;

		if (!state.palette) state.palette = buildPalette();
		applyPalette(state.palette);

		state.shapes = 0;
		var fragment = doc.createDocumentFragment();
		scan(scope, fragment);

		state.layer.textContent = '';
		state.layer.appendChild(fragment);

		overlay.classList.toggle('isux-debug', !!(config.debug || config.preview));
		var badge = overlay.querySelector('.isux-debug-badge');
		if (badge) {
			badge.textContent = 'ISUX ' + state.shapes + ' заглушек · область: ' +
				((scope && scope.tagName ? scope.tagName.toLowerCase() : '') || config.scopeSelector || 'body');
		}

		emit('isux:mirror:built', { count: state.shapes, scope: scope });
		log('Построено заглушек:', state.shapes);
		return state.shapes;
	}

	/* ------------------------------------------------------------------ *
	 *  Motion, progress, messages
	 * ------------------------------------------------------------------ */

	function configureMotion() {
		root.classList.remove('isux-animation-shimmer', 'isux-animation-pulse', 'isux-animation-none');
		var animation = config.animation || 'shimmer';
		var connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
		var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		var weak = !!(config.networkAware && connection &&
			(connection.saveData || /(^|-)2g$/.test(connection.effectiveType || '')));
		if (reduce || weak) animation = 'none';
		root.classList.add('isux-animation-' + animation);
	}

	function setMessage(text) {
		var overlay = mountOverlay();
		if (!overlay) return;
		var sr = overlay.querySelector('.isux-sr-message');
		if (sr) sr.textContent = text;
		overlay.setAttribute('aria-label', text);
	}

	function setProgress(value) {
		state.progress = Math.max(0, Math.min(100, value));
		var overlay = mountOverlay();
		if (!overlay) return;
		var bar = overlay.querySelector('.isux-progress > span');
		if (bar) bar.style.width = state.progress + '%';
	}

	function startProgress() {
		window.clearInterval(state.timers.progress);
		setProgress(6);
		state.timers.progress = window.setInterval(function () {
			var step = state.progress < 55 ? 6 + Math.random() * 7
				: state.progress < 84 ? 1.5 + Math.random() * 3.5
					: 0.3 + Math.random();
			setProgress(Math.min(94, state.progress + step));
		}, 260);
	}

	function stopProgress() {
		window.clearInterval(state.timers.progress);
		state.timers.progress = 0;
		setProgress(100);
	}

	/* 2.0 observed the whole scope for childList/subtree/attributes while
	   stabilizeLayout() wrote inline styles onto images inside that same scope,
	   which is a rebuild loop waiting to happen. Resize is the only thing that
	   actually invalidates the geometry while the overlay is up. */
	function startObservers() {
		stopObservers();

		function rebuild() {
			window.clearTimeout(state.timers.rebuild);
			state.timers.rebuild = window.setTimeout(function () {
				window.requestAnimationFrame(function () { if (state.visible) buildMirror(); });
			}, 90);
		}

		function bind(target, type, handler, options) {
			target.addEventListener(type, handler, options || false);
			state.teardown.push(function () { target.removeEventListener(type, handler, options || false); });
		}

		bind(window, 'resize', rebuild, { passive: true });
		if (!config.lockScroll) bind(window, 'scroll', rebuild, { passive: true });
	}

	function stopObservers() {
		state.teardown.forEach(function (stop) { try { stop(); } catch (error) {} });
		state.teardown = [];
		window.clearTimeout(state.timers.rebuild);
	}

	/* ------------------------------------------------------------------ *
	 *  Show / hide
	 * ------------------------------------------------------------------ */

	function show(reason, scopeOverride) {
		var overlay = mountOverlay();
		if (!overlay) return false;

		window.clearTimeout(state.timers.hide);
		window.clearTimeout(state.timers.failsafe);
		state.visibilitySerial += 1;
		state.shownAt = now();
		state.visible = true;

		// The script is alive, so the CSS deadline is no longer needed.
		overlay.removeAttribute('data-isux-failsafe');
		overlay.hidden = false;
		overlay.classList.remove('isux-is-hiding');
		overlay.classList.toggle('isux-no-progress', !config.progressBar);
		overlay.setAttribute('aria-hidden', 'false');
		root.classList.add(reason === 'navigation' ? 'isux-navigating' : 'isux-loading');
		if (config.lockScroll && doc.body) doc.body.classList.add('isux-scroll-locked');

		configureMotion();
		buildMirror(scopeOverride);
		startObservers();
		setMessage((config.messages && config.messages.loading) || 'Загрузка страницы');
		startProgress();

		state.timers.failsafe = window.setTimeout(function () {
			log('Аварийное скрытие по maxDuration');
			hide('failsafe', true);
		}, Math.max(1000, Number(config.maxDuration) || 15000));

		emit('isux:show', { reason: reason || 'manual', count: state.shapes });
		return true;
	}

	function hide(reason, immediate) {
		var overlay = state.overlay || doc.getElementById('isux-overlay');

		if (!overlay || !state.visible) {
			root.classList.remove('isux-loading', 'isux-navigating');
			if (doc.body) doc.body.classList.remove('isux-scroll-locked');
			if (overlay) {
				overlay.removeAttribute('data-isux-failsafe');
				overlay.hidden = true;
			}
			return;
		}

		var serial = state.visibilitySerial;
		var elapsed = now() - state.shownAt;
		var wait = immediate ? 0 : Math.max(0, (Number(config.minDuration) || 0) - elapsed);

		window.clearTimeout(state.timers.hide);
		state.timers.hide = window.setTimeout(function () {
			if (serial !== state.visibilitySerial) return;
			window.clearTimeout(state.timers.failsafe);
			stopObservers();
			stopProgress();
			setMessage((config.messages && config.messages.loaded) || 'Страница загружена');

			overlay.classList.add('isux-is-hiding');
			overlay.setAttribute('aria-hidden', 'true');
			root.classList.remove('isux-loading', 'isux-navigating');
			if (doc.body) doc.body.classList.remove('isux-scroll-locked');

			window.setTimeout(function () {
				if (serial !== state.visibilitySerial) return;
				overlay.hidden = true;
				overlay.classList.remove('isux-is-hiding');
				if (state.layer) state.layer.textContent = '';
				state.shapes = 0;
				setProgress(0);
				state.visible = false;
				emit('isux:hide', { reason: reason || 'manual' });
			}, immediate ? 0 : 210);
		}, wait);
	}

	/* ------------------------------------------------------------------ *
	 *  Navigation — carried over from 2.0
	 * ------------------------------------------------------------------ */

	function initialReady() {
		var promises = [];
		if (config.revealEvent === 'load' && doc.readyState !== 'complete') {
			promises.push(new Promise(function (resolve) {
				window.addEventListener('load', resolve, { once: true });
			}));
		}
		if (config.waitFonts && doc.fonts && doc.fonts.ready) {
			promises.push(Promise.resolve(doc.fonts.ready).catch(function () {}));
		}
		return Promise.all(promises);
	}

	function normalizeAssetUrl(value, base) {
		try {
			var url = new URL(value, base || window.location.href);
			url.hash = '';
			return url.href;
		} catch (error) { return value || ''; }
	}

	function loadStyles(incomingDoc, responseUrl) {
		if (!config.loadNewAssets) return Promise.resolve();
		var existing = {};
		queryAll(doc, 'link[rel="stylesheet"][href]').forEach(function (node) {
			existing[normalizeAssetUrl(node.getAttribute('href'))] = true;
		});
		var promises = [];
		queryAll(incomingDoc, 'link[rel="stylesheet"][href]').forEach(function (node) {
			var href = normalizeAssetUrl(node.getAttribute('href'), responseUrl);
			if (!href || existing[href]) return;
			existing[href] = true;
			var clone = doc.createElement('link');
			Array.prototype.forEach.call(node.attributes, function (attr) { clone.setAttribute(attr.name, attr.value); });
			clone.href = href;
			promises.push(new Promise(function (resolve) {
				clone.addEventListener('load', resolve, { once: true });
				clone.addEventListener('error', resolve, { once: true });
				window.setTimeout(resolve, 3500);
			}));
			doc.head.appendChild(clone);
		});
		queryAll(incomingDoc, 'style[id]').forEach(function (node) {
			if (node.id && !doc.getElementById(node.id)) doc.head.appendChild(doc.importNode(node, true));
		});
		return Promise.all(promises).then(function () {});
	}

	function loadScripts(incomingDoc, responseUrl) {
		if (!config.loadNewAssets) return Promise.resolve();
		var existing = {};
		queryAll(doc, 'script[src]').forEach(function (node) {
			existing[normalizeAssetUrl(node.getAttribute('src'))] = true;
		});
		var chain = Promise.resolve();
		queryAll(incomingDoc, 'script[src]').forEach(function (node) {
			var src = normalizeAssetUrl(node.getAttribute('src'), responseUrl);
			if (!src || existing[src] || /instant-skeleton-ux\/assets\/js\/frontend\.js/.test(src)) return;
			existing[src] = true;
			chain = chain.then(function () {
				return new Promise(function (resolve) {
					var clone = doc.createElement('script');
					Array.prototype.forEach.call(node.attributes, function (attr) { clone.setAttribute(attr.name, attr.value); });
					clone.src = src;
					clone.addEventListener('load', resolve, { once: true });
					clone.addEventListener('error', resolve, { once: true });
					window.setTimeout(resolve, 5000);
					doc.body.appendChild(clone);
				});
			});
		});
		return chain;
	}

	function updateHead(incomingDoc) {
		if (!config.updateHead) return;
		doc.title = incomingDoc.title || doc.title;
		[
			'link[rel="canonical"]', 'meta[name="description"]', 'meta[name="robots"]',
			'meta[property^="og:"]', 'meta[name^="twitter:"]'
		].forEach(function (selector) {
			queryAll(doc.head, selector).forEach(function (node) { node.parentNode.removeChild(node); });
			queryAll(incomingDoc.head, selector).forEach(function (node) { doc.head.appendChild(doc.importNode(node, true)); });
		});
	}

	function updateBodyClasses(incomingDoc) {
		if (!incomingDoc.body) return;
		var preserved = Array.prototype.slice.call(doc.body.classList).filter(function (name) {
			return name.indexOf('isux-') === 0;
		});
		doc.body.className = incomingDoc.body.className || '';
		preserved.forEach(function (name) { doc.body.classList.add(name); });
	}

	function executeInlineScripts(container) {
		queryAll(container, 'script:not([src])').forEach(function (oldScript) {
			var type = (oldScript.getAttribute('type') || 'text/javascript').toLowerCase();
			if (!config.runInlineScripts && !oldScript.hasAttribute('data-isux-execute')) return;
			if (!/^(text\/javascript|application\/javascript|module)$/.test(type)) return;
			var script = doc.createElement('script');
			Array.prototype.forEach.call(oldScript.attributes, function (attr) { script.setAttribute(attr.name, attr.value); });
			script.text = oldScript.textContent || '';
			oldScript.replaceWith(script);
		});
	}

	function runAdapters(container) {
		emit('isux:content:ready', { container: container });
		if (config.woocommerceAdapter && window.jQuery) {
			try {
				var $ = window.jQuery;
				$(container).find('.variations_form').each(function () {
					if (typeof $(this).wc_variation_form === 'function') $(this).wc_variation_form();
				});
				$(container).find('.woocommerce-product-gallery').each(function () {
					if (typeof $(this).wc_product_gallery === 'function') $(this).wc_product_gallery();
				});
				$(doc.body).trigger('wc_fragment_refresh').trigger('updated_wc_div');
			} catch (error) { log('Ошибка адаптера WooCommerce:', error); }
		}
		if (config.elementorAdapter && window.elementorFrontend) {
			try {
				var handler = window.elementorFrontend.elementsHandler;
				if (handler && typeof handler.runReadyTrigger === 'function') {
					handler.runReadyTrigger(window.jQuery ? window.jQuery(container) : container);
				}
			} catch (error) { log('Ошибка адаптера Elementor:', error); }
		}
	}

	function stringList(value) { return Array.isArray(value) ? value : []; }

	function isExcludedUrl(url) {
		return stringList(config.excludeUrls).some(function (part) {
			return part && url.href.indexOf(part) !== -1;
		});
	}

	function eligibleLink(event, link) {
		if (!link || event.defaultPrevented || event.button !== 0 ||
			event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
		if (link.hasAttribute('download') || (link.target && link.target !== '_self') ||
			closest(link, config.excludeLinkSelectors)) return null;

		var raw = link.getAttribute('href');
		if (!raw || raw.charAt(0) === '#' || /^(mailto:|tel:|javascript:)/i.test(raw)) return null;

		var url;
		try { url = new URL(raw, window.location.href); } catch (error) { return null; }
		if (!/^https?:$/.test(url.protocol) || url.origin !== window.location.origin || isExcludedUrl(url)) return null;
		if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) return null;
		if (/\bwc-ajax=|\badd-to-cart=/.test(url.search)) return null;
		return url;
	}

	function focusAndScroll(container, url) {
		if (url.hash) {
			var target = null;
			try { target = doc.querySelector(url.hash); } catch (error) {}
			if (target) {
				target.scrollIntoView({ behavior: config.scrollMode === 'smooth' ? 'smooth' : 'auto', block: 'start' });
				return;
			}
		}
		if (config.scrollMode === 'top') window.scrollTo(0, 0);
		if (config.scrollMode === 'smooth') window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
		if (config.focusContent) {
			var focusTarget = container.querySelector('h1, [role="main"], [tabindex]') || container;
			if (!focusTarget.hasAttribute('tabindex')) focusTarget.setAttribute('tabindex', '-1');
			try { focusTarget.focus({ preventScroll: true }); } catch (error) { focusTarget.focus(); }
		}
	}

	function ajaxNavigate(url, options) {
		options = options || {};
		var before = emit('isux:navigation:before', { url: url.href, options: options }, true);
		if (before.defaultPrevented) return Promise.resolve(false);
		if (state.navigationController) state.navigationController.abort();

		var controller = new AbortController();
		var serial = ++state.navigationSerial;
		state.navigationController = controller;
		show('navigation');
		emit('isux:navigation:start', { url: url.href });

		var timeout = window.setTimeout(function () { controller.abort(); },
			Math.max(3000, Number(config.ajaxTimeout) || 12000));

		return fetch(url.href, {
			method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'follow',
			headers: { Accept: 'text/html,application/xhtml+xml', 'X-ISUX-Navigation': '1' },
			signal: controller.signal
		}).then(function (response) {
			window.clearTimeout(timeout);
			var type = response.headers.get('content-type') || '';
			if (!response.ok || type.indexOf('text/html') === -1) throw new Error('HTTP ' + response.status);
			return response.text().then(function (html) {
				return { html: html, responseUrl: response.url || url.href };
			});
		}).then(function (result) {
			if (serial !== state.navigationSerial) return false;
			var incomingDoc = new DOMParser().parseFromString(result.html, 'text/html');
			var current = doc.querySelector(config.contentSelector);
			var incoming = incomingDoc.querySelector(config.contentSelector);
			if (!current || !incoming) throw new Error('Не найден контейнер: ' + config.contentSelector);
			setProgress(68);

			return loadStyles(incomingDoc, result.responseUrl).then(function () {
				updateHead(incomingDoc);
				updateBodyClasses(incomingDoc);
				var imported = doc.importNode(incoming, true);
				current.replaceWith(imported);
				setProgress(84);
				// The incoming document may have a different background.
				state.palette = null;
				buildMirror();
				return loadScripts(incomingDoc, result.responseUrl).then(function () {
					executeInlineScripts(imported);
					runAdapters(imported);
					return imported;
				});
			}).then(function (imported) {
				var finalUrl = new URL(result.responseUrl, window.location.href);
				if (options.push !== false) history.pushState({ isux: true, url: finalUrl.href }, '', finalUrl.href);
				focusAndScroll(imported, finalUrl);
				buildMirror();
				setProgress(100);
				hide('navigation-complete');
				emit('isux:navigation:complete', { url: finalUrl.href, container: imported });
				return true;
			});
		}).catch(function (error) {
			window.clearTimeout(timeout);
			if (error && error.name === 'AbortError' && serial !== state.navigationSerial) return false;
			log('AJAX-переход не выполнен:', error);
			setMessage((config.messages && config.messages.error) || 'Ошибка загрузки');
			window.location.assign(url.href);
			return false;
		});
	}

	function nativeNavigate(url) {
		show('navigation');
		emit('isux:navigation:start', { url: url.href, native: true });
		window.requestAnimationFrame(function () {
			window.requestAnimationFrame(function () { window.location.assign(url.href); });
		});
	}

	function onClick(event) {
		if (!config.transitionLoader) return;
		var link = event.target.closest ? event.target.closest('a[href]') : null;
		var url = eligibleLink(event, link);
		if (!url) return;
		event.preventDefault();
		if (config.navigationMode === 'ajax' && window.fetch && window.DOMParser && window.AbortController) {
			ajaxNavigate(url, { push: true });
		} else {
			nativeNavigate(url);
		}
	}

	function onSubmit(event) {
		if (!config.transitionLoader || event.defaultPrevented) return;
		var form = event.target;
		if (!form || form.hasAttribute('data-isux-no-nav') || form.target === '_blank') return;
		show('navigation');
	}

	/* ------------------------------------------------------------------ *
	 *  Boot
	 * ------------------------------------------------------------------ */

	function boot() {
		configureMotion();

		if (config.initialLoader) {
			show('initial');
			initialReady().then(function () {
				window.requestAnimationFrame(function () {
					buildMirror();
					hide('initial-ready');
				});
			});
		} else {
			// PHP prints the overlay for the transition case; stand it down.
			var overlay = doc.getElementById('isux-overlay');
			if (overlay) {
				overlay.removeAttribute('data-isux-failsafe');
				overlay.hidden = true;
			}
		}

		doc.addEventListener('click', onClick, true);
		doc.addEventListener('submit', onSubmit, true);

		if (config.navigationMode === 'ajax' && window.history && window.fetch) {
			history.replaceState({ isux: true, url: window.location.href }, '', window.location.href);
			window.addEventListener('popstate', function () {
				ajaxNavigate(new URL(window.location.href), { push: false, pop: true });
			});
		}

		window.addEventListener('pageshow', function (event) { if (event.persisted) hide('bfcache', true); });

		if (config.pauseHidden) {
			doc.addEventListener('visibilitychange', function () {
				root.classList.toggle('isux-paused', doc.hidden);
			});
		}
	}

	if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
	else boot();

	window.InstantSkeletonUX = {
		version: config.version,
		show: show,
		hide: hide,
		rebuild: function () { return buildMirror(); },
		palette: function () { return state.palette || (state.palette = buildPalette()); },
		navigate: function (url) {
			var target = new URL(url, window.location.href);
			return config.navigationMode === 'ajax' ? ajaxNavigate(target, { push: true }) : nativeNavigate(target);
		},
		getState: function () {
			return {
				visible: state.visible,
				progress: state.progress,
				shapes: state.shapes,
				navigationMode: config.navigationMode
			};
		}
	};
})();
