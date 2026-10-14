=== Woo Product 3D Viewer ===
Contributors: custom-development
Tags: woocommerce, 3d, glb, obj, product
Requires at least: 6.5
Requires PHP: 7.4
Stable tag: 1.0.3
License: GPL-2.0-or-later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Local GLB/OBJ product viewer with an accessible responsive modal and a shortcode.

== Installation ==
Upload the plugin ZIP via Plugins > Add New > Upload Plugin, then activate.
Activate WooCommerce first. Open a product in the classic WooCommerce editor,
select Product Data > 3D model, upload a model, and save.
Place [product_3d_button] in a shortcode block or Elementor Shortcode widget.
See README-RU.html for the complete Russian guide and TEST-REPORT.txt for checks.

== Description ==
* GLB 2.0 with embedded resources; Draco, Meshopt and KTX2 loaders included.
* Polygonal OBJ geometry; external MTL/textures are not supported.
* Orbit, slow rotation with pause, zoom, camera reset, keyboard controls.
* Background/model color palette, a custom color picker and original color reset.
* Per-variation model with a parent product fallback.
* Studio environment lighting, automatic framing and lazy loading.
* Self-hosted JavaScript and decoder files; no runtime CDN dependencies.
* Upload format/size checks and local attachment validation.
* Automatic server cache with a 512 MiB budget and cleanup every 30 days.
* Persistent browser model cache, versioned keys, original URL fallback and intent preloading.
* Optional mobile model per product/variation, lower memory rendering and Apple texture path.
* Retry with original download, error codes and editor-only copyable diagnostics.
* Settings use the classic WooCommerce product editor.

The viewer requires a browser with WebGL2. Model downloads are public.
An optimization or theme plugin can require site-specific verification.

== Changelog ==
= 1.0.3 =
Added bounded server/browser model caches, 30-day cleanup and a cache management page.
Download and engine loading run in parallel; desktop hover/focus preloads one model.
Added optional mobile files and a lower memory Apple-compatible texture/rendering path.
Retained 80 MiB uploads and background/model color palettes.
= 1.0.2 =
Added background and model color palettes in the viewer, with custom color selection.
Reversible model recoloring preserves original materials and texture alpha.
= 1.0.1 =
Raised the model upload and viewer download limit from 32 MiB to 80 MiB.
Client error messages use the configured limit. Empty file errors are separate.
= 1.0.0 =
Initial release.
