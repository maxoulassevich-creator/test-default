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
prototypes/index.html       side-by-side viewer for all three prototypes
prototypes/{mobile,tablet,desktop}.html
prototypes/wireframe.css    layout modes selected by body[data-device]
prototypes/proto.js         shared wireframe markup
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

## Content note

Odds, fixtures, multipliers and RTP figures on the page are illustrative and
labelled as such. The page is an informational guide: it accepts no bets, and
carries 18+ and responsible-gambling messaging in the top bar, a dedicated
section and the footer.
