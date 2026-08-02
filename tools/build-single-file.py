#!/usr/bin/env python3
"""
Build a single self-contained HTML file from the landing page.

Inlines the stylesheets, the script, the two variable fonts and the hero
background SVGs as data URIs, so the result has zero external requests and
works straight off a disk — including the fonts, which a browser refuses to
fetch cross-origin from a file:// page but happily reads from a data URI.

    python3 tools/build-single-file.py
"""
import base64
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "index.html"
OUT = ROOT / "wrbet-kenya-landing.html"


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def data_uri(rel, mime):
    raw = (ROOT / rel).read_bytes()
    return f"data:{mime};base64," + base64.b64encode(raw).decode("ascii")


def inline_font_urls(css):
    """Swap url('../fonts/x.woff2') for the font's data URI.

    Each @font-face lists the same file twice — once as `woff2-variations` for
    2018-era browsers, once as plain `woff2`. Over the network that costs
    nothing (only one is fetched), but inlined it would embed every font twice,
    so the legacy hint is dropped from this build only.
    """
    css, dropped = re.subn(
        r"url\(\s*(['\"]?)(\.\./fonts/[\w.-]+\.woff2)\1\s*\)\s*format\(\s*['\"]woff2-variations['\"]\s*\)\s*,\s*",
        "",
        css,
    )
    print(f"  duplicate legacy src entries dropped: {dropped}")

    def sub(m):
        name = m.group(1)
        return "url(" + data_uri(f"assets/fonts/{name}", "font/woff2") + ")"

    css, n = re.subn(r"url\(\s*['\"]?\.\./fonts/([\w.-]+\.woff2)['\"]?\s*\)", sub, css)
    print(f"  fonts inlined: {n}")
    return css


def inline_image_urls(css):
    """Swap url('../img/x.svg') for the image's data URI."""
    def sub(m):
        name = m.group(1)
        return 'url("' + data_uri(f"assets/img/{name}", "image/svg+xml") + '")'

    css, n = re.subn(r"url\(\s*['\"]?\.\./img/([\w.-]+\.svg)['\"]?\s*\)", sub, css)
    print(f"  images inlined: {n}")
    return css


def main():
    html = read("index.html")

    css = inline_font_urls(read("assets/css/fonts.css"))
    css += "\n" + inline_image_urls(read("assets/css/style.css"))

    js = read("assets/js/main.js")
    # A literal </script> inside the source would close the tag early.
    js = js.replace("</script", "<\\/script")

    # The preloads point at files this build no longer has; the data URIs in the
    # @font-face rules are parsed with the stylesheet, so there is nothing left
    # to preload.
    html, n = re.subn(r'\n<link rel="preload"[^>]*>', "", html)
    print(f"  preloads dropped: {n}")

    head_links = (
        '<link rel="stylesheet" href="assets/css/fonts.css">\n'
        '<link rel="stylesheet" href="assets/css/style.css">'
    )
    if head_links not in html:
        sys.exit("index.html no longer matches the expected <head> markup")
    html = html.replace(head_links, "<style>\n" + css + "\n</style>")

    script_tag = '<script src="assets/js/main.js" defer></script>'
    if script_tag not in html:
        sys.exit("index.html no longer matches the expected script tag")
    html = html.replace(script_tag, "<script>\n" + js + "\n</script>")

    banner = (
        "<!--\n"
        "  Wrbet Kenya — single-file build.\n"
        "  Generated from index.html + assets/ by tools/build-single-file.py.\n"
        "  Styles, script, both variable fonts and the hero background are inlined,\n"
        "  so this file makes no external requests. Edit the sources, not this file.\n"
        "-->\n"
    )
    html = html.replace("<!DOCTYPE html>\n", "<!DOCTYPE html>\n" + banner, 1)

    OUT.write_text(html, encoding="utf-8")

    leftovers = re.findall(r'(?:href|src)="(?!data:|#|https?://)([^"]+)"', html)
    print(f"\n  {OUT.name}: {len(html) / 1024:.0f} KB")
    print(f"  remaining local references: {leftovers if leftovers else 'none'}")


if __name__ == "__main__":
    main()
