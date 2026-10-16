=== Woo Product 3D Viewer ===
Contributors: custom-development
Tags: woocommerce, 3d, glb, fbx, obj
Requires at least: 6.5
Requires PHP: 7.4
Stable tag: 1.4.0
License: GPL-2.0-or-later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Local GLB/FBX/OBJ product viewer: up to three models per product, an accessible responsive modal with a model switcher, style settings and a shortcode.

== Installation ==
Upload the plugin ZIP via Plugins > Add New > Upload Plugin, then activate.
Activate WooCommerce first. Open a product in the classic WooCommerce editor,
select Product Data > 3D model, upload up to three models, and save.
Button and window styles: WooCommerce > 3D-просмотр.
Place [product_3d_button] in a shortcode block or Elementor Shortcode widget.
See README-RU.html for the complete Russian guide and TEST-REPORT.txt for checks.

== Description ==
* GLB 2.0 with embedded resources; Draco, Meshopt and KTX2 loaders included.
* FBX 7.x (FBX 2011 and newer), binary and ASCII: meshes, Phong/Lambert materials,
  embedded PNG/JPEG/TGA/BMP/WebP textures, Z-up scenes. External texture files are
  not loaded; such surfaces keep their material color. Lights, cameras and curves
  from the file are ignored; animations and skins stay in the bind pose.
* Polygonal OBJ geometry; external MTL/textures are not supported.
* Up to three models per product with switcher labels; touch-friendly switcher
  (44 px targets, bottom of the model area), click, arrow keys + Enter and keys 1-3.
* Style settings for the product button and every part of the viewer window
  (colors, sizes, radius, fonts, backdrop, visible controls) with a live preview
  and a demo window; available to shop managers.
* Background change and model recoloring in the palette can be switched off separately.
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
= 1.4.0 =
Sharper models on phones and tablets: the canvas follows the screen density (2x, within
2.4 MP; 5 MP on computers) with antialiasing; before, touch devices rendered at 1x without
antialiasing. Files over 40 MiB skip MSAA on phones. After a lost graphics context the
retry uses a light mode (1x, no MSAA). Texture anisotropy 4x on phones, 8x on computers.
Limits doubled: 2,000,000 vertices, 2000 meshes, 3,000,000 FBX triangles, 512 MiB FBX
arrays, 256 MiB GLB buffers, 6,000,000 GLB scene vertices, 2,000,000 OBJ triangles.
Maximum file size raised from 80 to 120 MiB; browser cache 240/120 MiB.
Upload messages state which limit was exceeded with the actual numbers and what to do
in Cinema 4D or Blender. New guide for Cinema 4D designers in README-RU.html: vertices
vs points, reducing polygons, materials, baking, UVW, GLB/FBX export settings.
= 1.3.0 =
The viewer palette has two separate switches on the settings page (Палитра и значок
360°): background change and model recoloring. With recoloring off the model always
keeps the materials, textures and colors of its file; with background change off the
background stays as set in the product. With one part allowed the palette has no tabs,
only a title and focus goes to the first color; with both off there is no palette
button. Switching a part off while the window is open restores that part. The 1.2.0
"show palette" setting is migrated to both switches with the same value.
= 1.2.0 =
Added up to three models per product (each with an optional mobile file and a switcher
label). The viewer window shows a model switcher: equal-width 44 px buttons at the
bottom of the model area on phones, click and keyboard (arrows + Enter, Home/End,
keys 1-3) on desktop. Switching cancels the previous download and keeps the chosen
background and model color. Variations keep one model; without their own file they
show all parent models. Product payload keeps the 1.1 model/mobileModel fields.
Added WooCommerce > 3D-просмотр settings page: product button (text, icon, width,
alignment, font, fill, colors, border, radius, size, height, padding, shadow), window
(eyebrow, font, size, radius, colors, backdrop color/opacity/blur, loading screen),
controls (colors, hover/active states, close button, focus ring, radius, height, text,
palette/fullscreen/help visibility), switcher (position, colors, radius), palette and
360° badge. Live preview, demo window with three models, reset to defaults.
Shop managers can save the settings. The cache page moved to the "Кэш моделей" tab;
the old page=w3dpv-cache address redirects there.
Hover styles apply only to devices with a hover pointer (no sticky hover after a tap).
Empty optional model slots are not stored as product meta.
= 1.1.2 =
The upload check follows FBXLoader's parsing rules: object ids of any numeric type,
duplicate ids, skin bones, model cycles, ASCII names with commas and line layout;
every compressed array must decode to its declared size. Blendshape vertices no longer
count toward the vertex limit. All stored files are checked again after the update.
= 1.1.1 =
Fixed: an FBX made of quads or n-gons passed the upload check and was then rejected
by the viewer ("too complex", code DECODE). Upload validation now counts exactly what
the viewer builds: triangles after quad/n-gon splitting, copies of shared geometry and
mesh objects; FBX limit is 1,500,000 triangles (about 1 GB of browser memory
while parsing). The same scene accounting is applied to
GLB (nodes reusing a mesh, GPU instancing) and OBJ (number of objects).
Fixed: FBX with loose edges or points (1-2 vertex polygons) failed with "invalid size".
Fixed: FBX files that make three.js FBXLoader crash (objects without geometry or links)
are rejected at upload. ASCII FBX arrays are counted by their actual values.
Error messages report the actual triangle, vertex and mesh counts; the product editor
shows why a stored model file is not usable.
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
