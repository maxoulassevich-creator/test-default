=== Instant Skeleton UX ===
Contributors: custom-development
Tags: skeleton, loading, shimmer, performance, ux, wordpress
Requires at least: 6.2
Requires PHP: 7.4
Stable tag: 2.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Точный skeleton по реальному DOM-макету страницы с сохранением настоящих фонов, background-image и декоративных элементов.

== Description ==

Версия 2.0 измеряет фактическое положение строк текста, изображений, кнопок, полей, SVG и медиа через браузерную геометрию. Плагин не использует универсальную сетку и не создаёт кеш HTML-страниц.

Основные возможности:

* точные координаты и размеры реальных элементов;
* сохранение фонов секций, градиентов, background-image и CSS-декора;
* локальное определение светлого или тёмного цвета;
* обязательное минимальное время показа даже после полной загрузки;
* сохранение реального border-radius;
* стабилизация измеренных размеров медиа;
* MutationObserver, ResizeObserver, отслеживание шрифтов и медиа;
* обычная и дополнительная AJAX-навигация;
* адаптеры WooCommerce и Elementor;
* data-isux-preserve и data-isux-skeleton.

== Installation ==

1. Загрузите ZIP через Плагины → Добавить плагин → Загрузить плагин.
2. Активируйте Instant Skeleton UX.
3. Откройте Настройки → Skeleton UX.
4. Укажите минимальное время показа.
5. Проверьте точный предпросмотр.

== Changelog ==

= 2.1.0 =
* Renderer rewritten. Content is hidden at source with visibility instead of
  being covered by an overlay, so nothing shows through the gaps between
  shapes — and section backgrounds, gradients, decorative layers and card
  borders all stay real. Layout is untouched and restoring is just dropping a
  class.
* New navigation mode: prerender. Speculation Rules plus cross-document view
  transitions, with the skeleton kept as the fallback. Links with a query
  string are excluded by default — a prerendered page really does execute.
* The palette is sampled from an element's parent instead of the element
  itself, which is what produced turquoise and red skeletons. Local adaptation
  is kept: a light card on a dark page still gets light placeholders.
* Text is drawn as centred bars with a tapered last line instead of full
  line boxes.
* Elements parked at opacity:0 by scroll-reveal effects are no longer skipped
  along with their subtrees.
* <body> is never hidden. The overlay ships in the markup with a CSS-only
  deadline and a <noscript> rule, so a script that fails cannot leave a blank
  page, and there is no white flash on dark sites.
* will-change removed from the shapes; only the sweeping highlight keeps one.
* Loose text beside element children is no longer left readable.
* Elements caught mid-entrance with a collapsed box are reconstructed from
  their layout size rather than skipped.
* The MutationObserver that could loop against stabilize_layout is gone.
* Settings removed: adaptive_colors, preserve_backgrounds,
  preserve_decorative_media, stabilize_layout, boot_background and the four
  base/highlight colours. Added: backdrop. min_duration now defaults to 0.


= 2.0.0 =
* Полностью удалены универсальные заранее нарисованные макеты.
* Добавлен DOM Mirror Engine.
* Skeleton повторяет фактические строки текста, медиа, кнопки и формы.
* Реальные фоны, background-image, градиенты и декор сохраняются.
* Добавлено локальное определение цвета для каждой области.
* Добавлена явная настройка обязательной минимальной продолжительности до 60 секунд.
* Добавлена стабилизация размеров медиа.
* Добавлены data-isux-preserve и data-isux-skeleton.
* Добавлен счётчик элементов в режиме предпросмотра.

= 1.0.0 =
* Первая версия с универсальными макетами.
