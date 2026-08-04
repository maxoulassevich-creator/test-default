# The 2.1 renderer

What changed between 2.0.0 and 2.1.0, and why. The lifecycle, the AJAX
navigation layer and the WooCommerce / Elementor adapters were carried over
unchanged; only the rendering was rewritten.

## What was wrong

Measured on the Wrbet landing at 1440 × 900, with the plugin's own defaults:

| | 2.0.0 | reworked |
|---|---|---|
| Visible text still legible through the skeleton | **23 of 47 runs** | 0 |
| Shapes painted in a brand colour (saturation > 24) | **10 of 49** | 0 |
| Overlay background | `rgba(0,0,0,0)` | opaque, sampled from the page |
| Build cost (mean of 5) | 9.3 ms | 3.7 ms |

Four defects, in the order they matter.

### 1. The overlay was transparent

`.isux-overlay { background: transparent }`. The skeleton was assembled only
from "atomic" elements plus raw text rects, so everything the scan did not
match stayed fully visible: card borders, gradients, chips, SVG strokes,
`::before`/`::after`, and every gap between two shapes. That is why the
screenshot reads as the real page with grey rectangles scattered over it —
"LIVE", the team names, the scores, the history chips and the note line were
never covered at all.

An opaque canvas fixes this outright, and it changes what the scan is *for*:
it no longer has to race to hide content, it only has to describe the layout.
Everything below follows from that.

### 2. Colours were sampled from the element itself

`paletteFor()` called `nearestBackdrop()`, which starts at the element and
walks **up**. For a button with `background: #00FFF7` the first hit is the
button's own fill, so the skeleton for that button was turquoise. The same
path produced the red chips and — because `rgba(242,242,242,.05)` reads as a
"light" backdrop by luminance — near-white boxes on a near-black page.

The palette is now computed **once** for the page from the document
background, and every shape uses it.

### 3. Text was drawn at full line-box height

`range.getClientRects()` returns rects the height of the line box, ~1.6× the
font size on this page. Painted solid, a paragraph becomes a stack of slabs.
Lines are now bars of 0.58 × the line box, vertically centred, radius half the
height, with the last line of a multi-line block tapered — from a fixed
sequence, not `Math.random()`, so a rebuild on resize does not reshuffle it.

### 4. Entrance animations emptied the skeleton

Both builds skipped anything with `opacity <= 0.01`. Scroll-reveal effects —
AOS, WOW, Elementor entrance animations, or a hand-rolled IntersectionObserver
like this landing's — park blocks at `opacity: 0` until they scroll into view.
On this page **15 blocks** were parked at build time, and skipping them took
the whole subtree with them.

`opacity` no longer stops the walk. The element still occupies its layout box,
which is exactly what the skeleton needs; only `display: none`,
`visibility: hidden` and `content-visibility: hidden` remove a box.

I hit this in my own first pass — it rendered the header and nothing else —
which is a good sign of how easily it bites.

## Also changed

- **The page is never blanked.** 2.0.0 sets `html.isux-booting body { opacity: 0 }`
  and relies on a timeout to bring it back, so a script that fails to run
  leaves a blank page for up to 15 s, and the default `--isux-boot-bg: #ffffff`
  flashes white on a dark site. Removed; the overlay carries the page's own
  colour instead.
- **One shape, one paint.** `will-change: transform` was set on every shape,
  promoting up to 700 elements to their own compositor layer during the exact
  moment the page is trying to render. It now sits only on the sweeping
  highlight, which is the only thing that actually animates.
- **A single top-down pass.** 2.0.0 collected every atom in the scope, then
  every text node, sorted by depth and de-duplicated by containment. The
  rework walks once and stops each branch as soon as it has described it:
  atom → box, text leaf → bars, card → surface then descend.
- **No `MutationObserver`.** 2.0.0 observed the whole scope for
  `childList/subtree/attributes` while `stabilizeElement()` wrote inline styles
  onto images inside that same scope — a rebuild loop waiting to happen.
  Rebuilds now happen on resize only, debounced.
- **A card is a card.** A single `border-top` no longer promotes a ruled group
  (a stats row, a section divider) into a filled panel; a frame on all four
  sides with a radius does.

## Upgrading from 2.0

Class names, option names and the public API are unchanged, so custom CSS and
any code calling `InstantSkeletonUX.show()` / `hide()` / `rebuild()` keeps
working. Settings were removed and added:

| Setting | |
|---|---|
| `backdrop` | **new** — force the overlay colour; empty means sample the page |
| `adaptive_colors` | removed — the palette is page-level now |
| `preserve_backgrounds` | removed — an opaque overlay makes it moot |
| `preserve_decorative_media` | removed — same reason |
| `stabilize_layout` | removed — nothing is written onto page elements any more |
| `boot_background` | removed — `<body>` is never hidden, so there is nothing to cover |
| `light_base` / `light_highlight` / `dark_base` / `dark_highlight` | removed — derived from the page background |
| `min_duration` | default changed from 1200 to 0 |
| `max_shapes` | default changed from 700 to 400; it also drives the CSS failsafe deadline |

`data-isux-skeleton` gained an `ignore` value that skips an element and its
subtree.

Stale values left in the database are harmless — they are simply not read.

## One thing worth deciding

The plugin measures a **fully laid-out page** to build its skeleton, which
means the skeleton can only exist after the moment it would have been useful.
For the *initial* load that makes `min_duration: 1200` a 1.2 s delay added to
every visit to show a placeholder for content that has already rendered.

The rendering is now correct either way, but the honest use for this machinery
is the **transition** loader — covering a navigation where there genuinely is
nothing to show yet. For the initial load, consider `initial_loader: 0`, or at
least `min_duration: 0`.
