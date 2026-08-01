=== Wrbet Cards ===
Contributors: wrbet
Tags: shortcode, widget, betting, animation
Requires at least: 5.8
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Two animated betting widgets — a live odds card and a crash-round card — output
through shortcodes, with text, fonts, colours and animation all configurable.

== Description ==

The plugin ships the two visuals from the Wrbet Kenya landing page as reusable
shortcodes:

* `[wrbet_odds]` — a live match card: pulsing LIVE label, two teams with badges
  and scores, a row of odds with one selected, and a note line. With drift
  enabled an unselected price nudges every few seconds the way a live market
  moves.
* `[wrbet_crash]` — a crash round: the multiplier climbs from 1.00x while the
  curve draws itself in sync, the round busts, the result is pushed onto the
  history strip, and a new round starts. Two variants: `compact` and `full`
  (adds the chart grid, the marker dot and a larger multiplier).

**Neither card paints a background behind itself.** The wrapper is transparent
and only the card surface is drawn, so both sit on whatever section background
you already have. Turning off *Draw the card surface* removes even that.

= Settings =

Settings → Wrbet Cards. Every field is grouped into Colours, Shape &
typography, Animation, and one content section per card. The screen carries a
live preview of both cards on a checkerboard, so it is obvious what is drawn
and what is transparent.

= Shortcode attributes =

Every setting key doubles as a shortcode attribute, so one instance can differ
from the site defaults without changing them:

    [wrbet_odds accent="#ff2d55" teams="AR|Arsenal|2, CH|Chelsea|1" odds="1|1.42*, X|4.60, 2|6.20"]
    [wrbet_crash variant="full" speed="1.6" crash_max="24" max_width="560"]
    [wrbet_crash surface="0" animate="0"]

Colour attributes: `accent`, `text`, `muted`, `faint`, `card_bg`, `card_bg2`,
`border`, `gray`, `danger`, `danger_text`.
Shape: `radius`, `padding`, `max_width`, `surface`, `shadow`, `class`.
Typography: `font_head`, `font_body`, `font_scale`.
Animation: `animate`, `pulse`, `reveal`, `speed`, `crash_min`, `crash_max`,
`live_odds`.
Odds content: `live_label`, `meta`, `teams`, `odds`, `odds_note`.
Crash content: `variant`, `crash_label`, `static_mult`, `grid`, `history`,
`crash_note`.

= Content field syntax =

* **Teams** — `badge|name|score`, comma separated. The second team gets the
  accent badge. Example: `HB|Harambee Bay|1, NU|Nairobi United|0`
* **Odds** — `label|value`, comma separated, `*` marks the selected outcome.
  Two or three outcomes both work; the grid follows the count. Example:
  `1|1.85, X|3.40*, 2|4.20`
* **History chips** — comma separated values. Suffix `!` renders the chip as a
  bust, `^` highlights it. Example: `2.14, 1.02!, 18.42^`

= Fonts =

Three sources. **Bundled** ships Sora and Public Sans with the plugin as
variable woff2 subsets (latin and latin-ext) and makes no external request —
nothing is fetched from Google. **Inherit from the theme** hands typography
back to the site. **Custom** uses the two family fields; write `inherit` in a
field to leave that role to the theme.

= Motion =

Animation stops completely when the visitor has `prefers-reduced-motion` set,
and pauses while a card is scrolled out of view or the tab is hidden. When
animation is off — by setting, by reduced motion, or because JavaScript did not
run — the card renders a finished round: the curve fully drawn next to the
*Static multiplier* value. That is why the default is `3.20` rather than
`1.00`; a completed curve beside 1.00x reads as broken.

= Adding cards after page load =

Page builders and AJAX loads can call `window.wrbetCards.refresh()` to
initialise any cards that appeared after the initial boot.

== Frequently Asked Questions ==

= Are the odds real? =

No. Everything on both cards is illustrative — the plugin has no data source
and connects to nothing. The default note under the odds says so, and it should
stay there or be replaced with equivalent wording.

= Can I use them outside post content? =

Yes. `do_shortcode( '[wrbet_odds]' )` works in a template; the shortcode
enqueues its own assets, so widgets, blocks and template calls are all covered.

= Do the cards work without JavaScript? =

Yes. The full markup is rendered server-side and the card reads as a completed
round. JavaScript only adds the motion.

== Changelog ==

= 1.0.0 =
* Initial release: `[wrbet_odds]` and `[wrbet_crash]`, settings screen with live
  preview, bundled variable fonts, per-instance shortcode attributes.
