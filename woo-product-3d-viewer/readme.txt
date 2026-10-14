=== Woo Product 3D Viewer ===
Contributors: custom-development
Tags: woocommerce, 3d, glb, fbx, obj
Requires at least: 6.5
Requires PHP: 7.4
Stable tag: 1.1.0
License: GPL-2.0-or-later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Local GLB/FBX/OBJ product viewer with an accessible responsive modal and a shortcode.

== Installation ==
Upload the plugin ZIP via Plugins > Add New > Upload Plugin, then activate.
Activate WooCommerce first. Open a product in the classic WooCommerce editor,
select Product Data > 3D model, upload a model, and save.
Place [product_3d_button] in a shortcode block or Elementor Shortcode widget.
See README-RU.html for the complete Russian guide and TEST-REPORT.txt for checks.

== Description ==
* GLB 2.0 with embedded resources; Draco, Meshopt and KTX2 loaders included.
* FBX 7.x (FBX 2011 and newer), binary and ASCII: meshes, Phong/Lambert materials,
  embedded PNG/JPEG/TGA/BMP/WebP textures, Z-up scenes. External texture files are
  not loaded; such surfaces keep their material color. Lights, cameras and curves
  from the file are ignored; animations and skins stay in the bind pose.
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
= 1.1.0 =
Added FBX support: upload validation (binary/ASCII 7.x, structure and complexity limits),
viewer loading with embedded textures, PBR material conversion and demo-chair.fbx.
Fixed: zoom level is reset after a window resize, rotation or fullscreen switch.
Fixed: a rejected media file was parsed again on every product page view.
Fixed: the product list screen loaded the media frame and the 3D viewer.
Added uninstall cleanup of plugin options, technical metadata and cache copies.
Declared WooCommerce HPOS compatibility; the cache folder rules include FBX.
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
