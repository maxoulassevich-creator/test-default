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
plugin/wrbet-cards/         WordPress plugin: the two cards as shortcodes
Wrbet Kenya Standalone.html original uploaded prototype (untouched)
```

Everything is static — open `index.html` directly, or serve the folder
(`python3 -m http.server`) if you want the fonts to load, since browsers block
`file://` font requests as cross-origin.

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

| File | Size | Use |
|---|---|---|
| `hero-bg.svg` | 2 KB | what `hero--image` loads; scales to any size |
| `hero-bg-mobile.svg` | 2 KB | 430 × 660 portrait crop, swapped in under 640px |
| `hero-bg-3840.*` | 3840 × 1760 | 841 KB as PNG, **21 KB** as WebP |
| `hero-bg-2560.*` | 2560 × 1173 | 427 KB / 10 KB |
| `hero-bg-1920.*` | 1920 × 880 | 258 KB / 6 KB |
| `hero-bg-mobile-1290.*` | 1290 × 1980 | portrait raster at 3× |

WebP is the one to ship if you need a raster — smooth gradients compress to a
fraction of the PNG. The rasters exist for places that cannot take SVG: some
page builders, OG images, email.

## WordPress plugin

`plugin/wrbet-cards/` packages the hero's two visuals as shortcodes:
`[wrbet_odds]` (live match card) and `[wrbet_crash]` (crash round, `compact` and
`full` variants). Settings → Wrbet Cards controls text, fonts, colours and
animation, with a live preview; every setting also works as a per-instance
shortcode attribute:

```
[wrbet_crash variant="full" accent="#ff2d55" speed="1.6" max_width="560"]
```

Neither card paints a background behind itself, so both drop onto an existing
section unchanged. Fonts are bundled — no external requests. Full documentation
is in `plugin/wrbet-cards/readme.txt`.

## Content note

Odds, fixtures, multipliers and RTP figures on the page are illustrative and
labelled as such. The page is an informational guide: it accepts no bets, and
carries 18+ and responsible-gambling messaging in the top bar, a dedicated
section and the footer.
