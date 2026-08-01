/* =========================================================================
   Wrbet Cards — front-end behaviour
   No dependencies. Every card runs independently, pauses when it is off
   screen or the tab is hidden, and renders a finished static round when
   animation is off or the visitor asks for reduced motion.
   ========================================================================= */
(function () {
	'use strict';

	var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	var HISTORY_MAX = 6;

	function num(el, attr, fallback) {
		var v = parseFloat(el.getAttribute(attr));
		return isFinite(v) ? v : fallback;
	}

	function on(el, attr) {
		return el.getAttribute(attr) === '1';
	}

	/* ------------------------------------------------------------------ *
	 *  Visibility: one observer drives every card on the page.
	 * ------------------------------------------------------------------ */
	var watchers = [];

	function watch(el, onChange) {
		var entry = { el: el, onScreen: true, onChange: onChange };
		watchers.push(entry);

		if (!('IntersectionObserver' in window)) return entry;

		new IntersectionObserver(function (entries) {
			entries.forEach(function (e) {
				entry.onScreen = e.isIntersecting;
				entry.onChange(entry.onScreen && !document.hidden);
			});
		}, { threshold: 0 }).observe(el);

		return entry;
	}

	document.addEventListener('visibilitychange', function () {
		watchers.forEach(function (w) { w.onChange(w.onScreen && !document.hidden); });
	});

	/* ------------------------------------------------------------------ *
	 *  Reveal on scroll
	 * ------------------------------------------------------------------ */
	function initReveal(root) {
		if (reduceMotion || !('IntersectionObserver' in window)) return;

		root.classList.add('is-armed');

		var observer = new IntersectionObserver(function (entries) {
			entries.forEach(function (e) {
				if (!e.isIntersecting) return;
				e.target.classList.add('is-visible');
				observer.unobserve(e.target);
			});
		}, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });

		observer.observe(root);
	}

	/* ------------------------------------------------------------------ *
	 *  Crash card
	 * ------------------------------------------------------------------ */
	function initCrash(root) {
		var mult = root.querySelector('[data-wrbet-mult]');
		var line = root.querySelector('[data-wrbet-line]');
		var clip = root.querySelector('[data-wrbet-clip]');
		var dot = root.querySelector('[data-wrbet-dot]');
		var history = root.querySelector('[data-wrbet-history]');
		if (!mult || !line) return;

		var length = 0;
		try {
			length = line.getTotalLength();
		} catch (err) {
			// Firefox throws on a detached or display:none path; the static
			// fallback below still gives a complete-looking card.
			length = 0;
		}

		var viewBox = (line.ownerSVGElement && line.ownerSVGElement.viewBox.baseVal) || { width: 320, height: 100 };

		function draw(progress) {
			if (length) {
				line.style.strokeDasharray = length;
				line.style.strokeDashoffset = length * (1 - progress);
			}
			if (clip) clip.setAttribute('width', viewBox.width * progress);
			if (dot && length) {
				var p = line.getPointAtLength(length * progress);
				dot.setAttribute('cx', p.x);
				dot.setAttribute('cy', p.y);
			}
		}

		/* --- static state: animation off, or reduced motion --- */
		if (!on(root, 'data-animate') || reduceMotion) {
			draw(1);
			return;
		}

		var speed = num(root, 'data-speed', 1);
		var min = num(root, 'data-min', 1.2);
		var max = num(root, 'data-max', 8);
		if (max <= min) max = min + 1;

		var target = 0;
		var duration = 0;
		var startedAt = 0;
		var busting = false;
		var running = true;
		var frame = null;

		function pickTarget() {
			// Skewed towards the low end, the way real crash rounds distribute.
			var r = Math.random();
			return min + (max - min) * Math.pow(r, 2.2);
		}

		function newRound() {
			target = pickTarget();
			// Longer climbs for bigger multipliers, so the pace stays believable.
			duration = (1200 + Math.log(target) * 1400) / speed;
			startedAt = 0;
			busting = false;
			root.classList.remove('is-bust');
			mult.classList.remove('is-bust');
		}

		function pushHistory(value) {
			if (!history) return;

			var chip = document.createElement('span');
			chip.className = 'wrbet-chip is-new';
			if (value < 1.5) chip.className += ' is-bust';
			else if (value >= max * 0.8) chip.className += ' is-hot';
			chip.textContent = value.toFixed(2) + 'x';

			history.insertBefore(chip, history.firstChild);

			while (history.children.length > HISTORY_MAX) {
				history.removeChild(history.lastChild);
			}
		}

		function step(ts) {
			if (!running) return;
			if (!startedAt) startedAt = ts;

			var progress = Math.min((ts - startedAt) / duration, 1);

			// target^progress: starts at 1.00x and lands exactly on the target.
			var value = Math.pow(target, progress);
			mult.textContent = value.toFixed(2) + 'x';
			draw(progress);

			if (progress >= 1 && !busting) {
				busting = true;
				root.classList.add('is-bust');
				mult.classList.add('is-bust');
				pushHistory(target);

				window.setTimeout(function () {
					if (!running) return;
					newRound();
					frame = requestAnimationFrame(step);
				}, 900);
				return;
			}

			frame = requestAnimationFrame(step);
		}

		newRound();
		draw(0);
		frame = requestAnimationFrame(step);

		watch(root, function (visible) {
			if (visible === running) return;
			running = visible;

			if (running) {
				// Resume where the round left off rather than jumping forward.
				startedAt = 0;
				frame = requestAnimationFrame(step);
			} else if (frame) {
				cancelAnimationFrame(frame);
			}
		});
	}

	/* ------------------------------------------------------------------ *
	 *  Odds card — drifting prices
	 * ------------------------------------------------------------------ */
	function initOdds(root) {
		if (!on(root, 'data-animate') || !on(root, 'data-live-odds') || reduceMotion) return;

		var cells = Array.prototype.slice.call(root.querySelectorAll('.wrbet-odd'));
		var movable = cells.filter(function (c) { return !c.classList.contains('is-active'); });
		if (!movable.length) return;

		var running = true;
		var timer = null;

		function tick() {
			if (!running) return;

			var cell = movable[Math.floor(Math.random() * movable.length)];
			var out = cell.querySelector('[data-wrbet-odd]');

			if (out) {
				var current = parseFloat(out.textContent);
				if (isFinite(current)) {
					var delta = (Math.random() - 0.45) * 0.3;
					var next = Math.max(1.01, current + delta);
					out.textContent = next.toFixed(2);

					cell.classList.add('is-drifting');
					window.setTimeout(function () { cell.classList.remove('is-drifting'); }, 700);
				}
			}

			timer = window.setTimeout(tick, 3500 + Math.random() * 3500);
		}

		timer = window.setTimeout(tick, 2500);

		watch(root, function (visible) {
			running = visible;
			if (!visible && timer) {
				window.clearTimeout(timer);
				timer = null;
			} else if (visible && !timer) {
				timer = window.setTimeout(tick, 1200);
			}
		});
	}

	/* ------------------------------------------------------------------ *
	 *  Boot
	 * ------------------------------------------------------------------ */
	function boot(scope) {
		var root = scope || document;

		Array.prototype.forEach.call(root.querySelectorAll('.wrbet--reveal'), function (el) {
			if (el.dataset.wrbetReveal) return;
			el.dataset.wrbetReveal = '1';
			initReveal(el);
		});

		Array.prototype.forEach.call(root.querySelectorAll('[data-wrbet-crash]'), function (el) {
			if (el.dataset.wrbetReady) return;
			el.dataset.wrbetReady = '1';
			initCrash(el);
		});

		Array.prototype.forEach.call(root.querySelectorAll('[data-wrbet-odds]'), function (el) {
			if (el.dataset.wrbetReady) return;
			el.dataset.wrbetReady = '1';
			initOdds(el);
		});
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', function () { boot(); });
	} else {
		boot();
	}

	// Page builders and AJAX loads can inject cards after boot.
	window.wrbetCards = { refresh: boot };
})();
