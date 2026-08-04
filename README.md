# Wrbet Kenya — landing page

Independent betting & casino guide for players in Kenya. Built from the uploaded
mobile prototype: first extended to tablet and desktop wireframes, then developed
into a full responsive landing page.

```
index.html                  production landing page
assets/css/style.css        all landing styles (mobile-first)
assets/css/fonts.css        @font-face for the self-hosted variable fonts
assets/js/main.js           drawer, scrollspy, reveal, accordion, counters
assets/fonts/*.woff2        Public Sans + Sora, variable, latin & latin-ext subsets
assets/img/hero-bg.*        hero background: SVG source + PNG/WebP exports
prototypes/index.html       side-by-side viewer for all three prototypes
prototypes/{mobile,tablet,desktop}.html
prototypes/wireframe.css    layout modes selected by body[data-device]
prototypes/proto.js         shared wireframe markup
plugin/wrbet-cards/         WordPress plugin: the cards as shortcodes
plugin/instant-skeleton-ux/ WordPress plugin: skeleton loader (2.1 renderer)
Wrbet Kenya Standalone.html original uploaded prototype (untouched)
```

Everything is static — open `index.html` directly, or serve the folder
(`python3 -m http.server`) if you want the fonts to load, since browsers block
`file://` font requests as cross-origin.

## Single-file build

`wrbet-kenya-landing.html` is the whole landing page in one file: styles,
script, both variable fonts and the hero background inlined as data URIs. It
makes **zero external requests**, so it opens straight off a disk with the real
typography — the data URIs sidestep the cross-origin font block that affects the
multi-file version under `file://`.

```
python3 tools/build-single-file.py
```

198 KB, most of it the two fonts. The build drops the legacy
`format("woff2-variations")` entries, which name the same files a second time —
free over the network, but they would have embedded every font twice.

Edit the sources and rebuild; do not edit the generated file.

## Prototypes

One content structure, three layout modes. `prototypes/index.html` shows them
side by side; each file also opens standalone at its own width.

| | Mobile 390 | Tablet 834 | Desktop 1440 |
|---|---|---|---|
| Navigation | burger | inline | inline + CTA |
| Hero | stacked | stacked, taller banner | split, side visual |
| Sports cards | 1 col | 2 cols | 3 cols |
| Casino cards | 1 col | 2 cols | 4 cols |
| Guide cards | 1 col | 2 cols, last full width | 4 cols, first 2× wide |
| FAQ | stacked | stacked | heading left / accordion right |

## Colour

The palette from the brief, extended with two darker shades so the dark theme
has enough depth to layer surfaces.

| Token | Value | Use |
|---|---|---|
| `--c-bg` | `#141414` | page background (added) |
| `--c-bg-2` | `#1B1B1B` | alternating sections, header, footer |
| `--c-surface` / `--c-surface-2` | `#202020` / `#262626` | cards, panels (added) |
| `--c-gray` | `#494949` | badges, muted fills |
| `--c-text` | `#f2f2f2` | body text |
| `--c-accent` | `#00FFF7` | primary actions, highlights, data |
| `--c-ink` | `#1B1B1B` | text on turquoise |
| `--c-danger` | `#8D0203` | 18+ badge, responsible-gambling block, crash "bust" |

Turquoise is reserved for one thing per screen — the action or the number that
matters — so it stays a signal rather than decoration. Red only ever appears
around risk: the age badge, the responsible-gambling panel, and busted rounds.

## Responsiveness

Mobile-first, verified at 320 / 390 / 768 / 1024 / 1440 / 1920 with no horizontal
overflow at any width. Type and spacing scale fluidly with `clamp()`, so the
layout holds between breakpoints rather than only at them.

## Accessibility

- Skip link, landmarks, and visible focus rings throughout.
- Drawer traps focus, closes on `Esc`, restores focus, and unlocks on resize.
- FAQ uses native `<details>`, so it works with JavaScript disabled.
- All body and meta text meets WCAG AA (verified by measurement; the lowest
  ratio on the page is 5.0:1).
- `prefers-reduced-motion` disables the marquee, floating cards, crash counter
  and reveal animations.
- Scroll-reveal is gated behind a `js` class — without JavaScript nothing is
  hidden.

## Hero background

The first section's backdrop — a 64px grid dissolving into flat colour, one
turquoise glow in the top-right, everything settling back into solid `#141414`
towards the bottom so the image joins the next section with no visible seam
(the bottom row is exactly `#141414` across the full width). Desktop frame is
1920 × 880, a 2.18:1 band rather than a full 16:9 screen.

It exists in two interchangeable forms.

**CSS (default).** Two layers inside `.hero`: `.hero__grid-bg` draws the grid
masked by a radial ellipse anchored to the top edge, `.hero__glow` adds the
corner light. No requests, no raster at any density.

**Artwork.** Add `hero--image` to the section and those two layers step aside for
a file:

```html
<section class="hero hero--image">
```

| File | Size | PNG / WebP |
|---|---|---|
| `hero-bg.svg` | vector | 2 KB — what `hero--image` loads |
| `hero-bg-mobile.svg` | vector | 2 KB — 430 × 660 portrait, under 640px |
| `hero-bg-3840.*` | 3840 × 1760 | 841 KB / **23 KB** |
| `hero-bg-2560.*` | 2560 × 1173 | 427 KB / 11 KB |
| `hero-bg-1920.*` | 1920 × 880 | 258 KB / 7 KB |
| `hero-bg-mobile-1290.*` | 1290 × 1980 | 173 KB / 8 KB |

WebP is the one to ship if you need a raster — smooth gradients compress to a
fraction of the PNG. The rasters exist for places that cannot take SVG: some
page builders, OG images, email.

### The two layers, separately

The composite is also split, so the light can be moved, resized or animated
independently of the grid.

| File | What it is |
|---|---|
| `hero-grid.svg` / `-mobile.svg` | **opaque**: base colour, grid, settle to solid. No glow — every pixel is neutral grey. |
| `hero-grid-1920.*`, `-3840.*`, `-mobile-1290.*` | 24 / 78 / 24 KB as PNG, 4 / 17 / 6 KB as WebP |
| `hero-glow.svg` | **transparent**: the corner light alone, positioned as in the composite |
| `hero-glow-blob.svg` | the same light centred in a 1600 × 1600 square, for free positioning |
| `hero-glow-1920.*`, `-3840.*`, `-blob-1600.*` | 34 / 87 / 61 KB as PNG, 15 / 35 / 19 KB as WebP |

Stacked as two backgrounds, glow on top:

```css
.hero {
  background:
    url("../img/hero-glow.svg") top right / 100% auto no-repeat,
    url("../img/hero-grid.svg") top center / cover no-repeat,
    #141414;
}
```

Stacking the two layers reproduces the packaged composite to within 6/255 — in
the composite the glow sits *under* the settle gradient and is damped slightly
in the lower half, which a manual stack cannot reproduce. It is not visible;
use the composite if you want it exact.

### Red glow

The wash behind the responsible-gambling panel, split out the same way. Unlike
the turquoise light this one is an **ellipse pinned to the top-right corner** —
`radial-gradient(90% 120% at 100% 0%, rgba(141,2,3,.28), transparent 62%)`.

| File | What it is |
|---|---|
| `glow-red.svg` | the corner ellipse on transparency, 1280 × 720 panel frame |
| `glow-red-1280.*`, `-2560.*` | 23 / 61 KB as PNG, 8 / 21 KB as WebP |
| `glow-red-blob.svg` | the same light centred in a 1600 × 1600 square |
| `glow-red-blob-1600.*` | 60 KB as PNG, 18 KB as WebP |

Composited over `#1B1B1B` the SVG matches the panel's own CSS gradient to
within 1/255, and the PNG to within 2/255 — the 8-bit alpha step.

### Regenerating

```
python3 tools/make-glow.py
```

One script owns every glow layer, turquoise and red. The rasters are computed
arithmetically rather than screenshotted: a glow is one colour at varying
opacity, so only alpha carries information, and skipping the browser's gradient
dithering took the turquoise 1920 PNG from 203 KB to 34 KB and its WebP from
177 KB to 15 KB — while still reproducing the SVG's own stops to within 1/255.

## WordPress plugin

`plugin/wrbet-cards/` packages the hero's visuals as three shortcodes:

| Shortcode | Card |
|---|---|
| `[wrbet_odds]` | live match card — teams, scores, odds row |
| `[wrbet_crash]` | compact crash round — label, curve, history |
| `[wrbet_aviator]` | full crash round — chart grid, marker dot, large multiplier |

`[wrbet_aviator]` carries its own label, static multiplier, history, note and
width, so both crash cards can sit on one page without sharing content.

Settings → Wrbet Cards controls text, fonts, colours and animation, with a live
preview; every setting also works as a per-instance shortcode attribute:

```
[wrbet_aviator av_label="Round in progress" accent="#ff2d55" speed="1.6"]
```

Neither card paints a background behind itself, so both drop onto an existing
section unchanged. Fonts are bundled — no external requests. Full documentation
is in `plugin/wrbet-cards/readme.txt`.

## Content note

Odds, fixtures, multipliers and RTP figures on the page are illustrative and
labelled as such. The page is an informational guide: it accepts no bets, and
carries 18+ and responsible-gambling messaging in the top bar, a dedicated
section and the footer.
