#!/usr/bin/env python3
"""
Generate the glow layers as SVG plus PNG/WebP on transparency.

A glow is one colour at a varying opacity, so only the alpha channel carries
information. The rasters are computed here rather than screenshotted from a
browser: skipping the renderer's gradient dithering cuts the file size by
roughly 6x and reproduces the SVG's own stops to within 1/255.

    python3 tools/make-glow.py

Geometry is authored in CSS-pixel design space. `corner` glows are anchored
outside a frame the way the landing places them; `blob` glows are centred in a
square so they can be positioned freely.
"""
import base64
import pathlib

import numpy as np
from PIL import Image

OUT = pathlib.Path(__file__).resolve().parent.parent / "assets" / "img"
OUT.mkdir(parents=True, exist_ok=True)


# name          rgb              frame        centre          radii          stops (offset, opacity)
GLOWS = [
	{
		"name": "hero-glow",
		"rgb": (0, 255, 247),
		"frame": (1920, 880),
		"centre": (0.92, 0.22),          # fractions of the frame
		"radii": (0.40, 0.40),           # fractions of the frame width
		"stops": [(0.00, 0.24), (0.22, 0.11), (0.48, 0.032), (1.00, 0.0)],
		"rasters": [1920, 3840],
		"label": "Turquoise glow on transparency",
	},
	{
		"name": "hero-glow-blob",
		"rgb": (0, 255, 247),
		"frame": (1600, 1600),
		"centre": (0.50, 0.50),
		"radii": (0.48, 0.48),
		"stops": [(0.00, 0.24), (0.22, 0.11), (0.48, 0.032), (1.00, 0.0)],
		"rasters": [1600],
		"label": "Turquoise glow on transparency, centred",
	},
	{
		# The .responsible panel's wash: an ellipse pinned to the top-right
		# corner — radial-gradient(90% 120% at 100% 0%, rgba(141,2,3,.28), transparent 62%)
		"name": "glow-red",
		"rgb": (141, 2, 3),
		"frame": (1280, 720),
		"centre": (1.00, 0.00),
		"radii": (0.90, 1.20 * 720 / 1280),   # 90% of width, 120% of height
		"stops": [(0.00, 0.28), (0.62, 0.0), (1.00, 0.0)],
		"rasters": [1280, 2560],
		"label": "Red glow on transparency, anchored to the top-right corner",
	},
	{
		"name": "glow-red-blob",
		"rgb": (141, 2, 3),
		"frame": (1600, 1600),
		"centre": (0.50, 0.50),
		"radii": (0.48, 0.48),
		"stops": [(0.00, 0.28), (0.62, 0.0), (1.00, 0.0)],
		"rasters": [1600],
		"label": "Red glow on transparency, centred",
	},
]


def geometry(g):
	"""Resolve the fractional spec into pixel values."""
	w, h = g["frame"]
	cx, cy = g["centre"][0] * w, g["centre"][1] * h
	rx, ry = g["radii"][0] * w, g["radii"][1] * w
	return w, h, cx, cy, rx, ry


def svg(g):
	w, h, cx, cy, rx, ry = geometry(g)
	r, gr, b = g["rgb"]

	stops = "\n".join(
		f'      <stop offset="{o * 100:g}%" stop-color="rgb({r},{gr},{b})" stop-opacity="{a:g}"/>'
		for o, a in g["stops"]
	)

	# An SVG radial gradient is circular; squashing it about its own centre
	# turns it into the ellipse the CSS gradient describes.
	squash = ry / rx
	transform = (
		f' gradientTransform="translate({cx:g} {cy:g}) scale(1 {squash:g}) translate({-cx:g} {-cy:g})"'
		if abs(squash - 1) > 1e-9 else ""
	)

	return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}"
     width="{w}" height="{h}" preserveAspectRatio="xMidYMid slice" role="img"
     aria-label="{g['label']}">
  <defs>
    <radialGradient id="glow" gradientUnits="userSpaceOnUse"
                    cx="{cx:g}" cy="{cy:g}" r="{rx:g}"{transform}>
{stops}
    </radialGradient>
  </defs>

  <rect width="{w}" height="{h}" fill="url(#glow)"/>
</svg>
'''


def raster(g, width):
	"""Compute the alpha ramp directly — no browser, no dithering."""
	fw, fh, cx, cy, rx, ry = geometry(g)
	scale = width / fw
	w, h = width, round(fh * scale)

	offs = np.array([s[0] for s in g["stops"]])
	vals = np.array([s[1] for s in g["stops"]])

	y, x = np.ogrid[0:h, 0:w]
	# Sample at pixel centres, in design space, so every size lines up.
	dx = (x + 0.5) / scale - cx
	dy = (y + 0.5) / scale - cy
	t = np.sqrt((dx / rx) ** 2 + (dy / ry) ** 2)
	a = np.rint(np.interp(np.clip(t, 0.0, 1.0), offs, vals) * 255).astype(np.uint8)

	rgba = np.empty((h, w, 4), dtype=np.uint8)
	rgba[..., 0], rgba[..., 1], rgba[..., 2] = g["rgb"]
	rgba[..., 3] = a

	img = Image.fromarray(rgba, "RGBA")
	png = OUT / f"{g['name']}-{width}.png"
	img.save(png, "PNG", optimize=True)
	img.save(png.with_suffix(".webp"), "WEBP", quality=92, method=6)

	return png, w, h, int(a.max())


def main():
	for g in GLOWS:
		path = OUT / f"{g['name']}.svg"
		path.write_text(svg(g), encoding="utf-8")
		print(f"{path.name:24} {path.stat().st_size:5} bytes")

		for width in g["rasters"]:
			png, w, h, peak = raster(g, width)
			webp = png.with_suffix(".webp")
			print(
				f"  {png.name:26} {w}x{h}  png {png.stat().st_size / 1024:5.0f} KB"
				f"   webp {webp.stat().st_size / 1024:4.0f} KB   peak alpha {peak}"
			)


if __name__ == "__main__":
	main()
