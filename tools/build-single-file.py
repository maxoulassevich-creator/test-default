#!/usr/bin/env python3
"""
Build self-contained HTML files — one per page, with nothing external.

Inlines the stylesheets, the script, the two variable fonts and the hero
background SVGs as data URIs, so each result works straight off a disk
including the fonts, which a browser refuses to fetch cross-origin from a
file:// page but happily reads from a data URI.

Every page is written into standalone/ under its own name, so the links
between them keep working when the folder is opened locally. The landing is
additionally copied to wrbet-kenya-landing.html at the root, the name it has
always been delivered under.

    python3 tools/build-single-file.py            # every page
    python3 tools/build-single-file.py index.html # just one
"""
import base64
import pathlib
import re
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "standalone"
LANDING_ALIAS = ROOT / "wrbet-kenya-landing.html"

HEAD_LINKS = (
    '<link rel="stylesheet" href="assets/css/fonts.css">\n'
    '<link rel="stylesheet" href="assets/css/style.css">'
)
SCRIPT_TAG = '<script src="assets/js/main.js" defer></script>'


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
    css = re.sub(
        r"url\(\s*(['\"]?)(\.\./fonts/[\w.-]+\.woff2)\1\s*\)\s*format\(\s*['\"]woff2-variations['\"]\s*\)\s*,\s*",
        "",
        css,
    )

    def sub(m):
        return "url(" + data_uri(f"assets/fonts/{m.group(1)}", "font/woff2") + ")"

    return re.sub(r"url\(\s*['\"]?\.\./fonts/([\w.-]+\.woff2)['\"]?\s*\)", sub, css)


def inline_image_urls(css):
    """Swap url('../img/x.svg') for the image's data URI."""
    def sub(m):
        return 'url("' + data_uri(f"assets/img/{m.group(1)}", "image/svg+xml") + '")'

    return re.sub(r"url\(\s*['\"]?\.\./img/([\w.-]+\.svg)['\"]?\s*\)", sub, css)


def bundle():
    """The style and script blocks, built once and shared by every page."""
    css = inline_font_urls(read("assets/css/fonts.css"))
    css += "\n" + inline_image_urls(read("assets/css/style.css"))
    js = read("assets/js/main.js")
    # A literal </script> inside the source would close the tag early.
    js = js.replace("</script", "<\\/script")
    return "<style>\n" + css + "\n</style>", "<script>\n" + js + "\n</script>"


def build(name, style_block, script_block):
    html = read(name)

    # The preloads point at files this build no longer has; the data URIs in the
    # @font-face rules are parsed with the stylesheet, so there is nothing left
    # to preload.
    html = re.sub(r'\n<link rel="preload"[^>]*>', "", html)

    if HEAD_LINKS not in html or SCRIPT_TAG not in html:
        sys.exit(f"{name} no longer matches the expected <head>/script markup")
    html = html.replace(HEAD_LINKS, style_block).replace(SCRIPT_TAG, script_block)

    banner = (
        "<!--\n"
        "  Wrbet Kenya — single-file build.\n"
        f"  Generated from {name} + assets/ by tools/build-single-file.py.\n"
        "  Styles, script, both variable fonts and the backgrounds are inlined,\n"
        "  so this file makes no external requests. Edit the sources, not this file.\n"
        "-->\n"
    )
    html = html.replace("<!DOCTYPE html>\n", "<!DOCTYPE html>\n" + banner, 1)

    out = OUT_DIR / name
    out.write_text(html, encoding="utf-8")

    # Anything still pointing at a local path other than a sibling page would
    # break once the file is opened on its own.
    external = [
        r for r in re.findall(r'(?:href|src)="(?!data:|#|https?://)([^"]+)"', html)
        if not re.fullmatch(r"[\w-]+\.html", r)
    ]
    print(f"  {out.relative_to(ROOT)}: {len(html) / 1024:>4.0f} KB"
          + (f"   UNRESOLVED {external}" if external else ""))
    return out


def main():
    pages = sys.argv[1:] or sorted(p.name for p in ROOT.glob("*.html")
                                   if p != LANDING_ALIAS and "Standalone" not in p.name)
    OUT_DIR.mkdir(exist_ok=True)
    style_block, script_block = bundle()

    print(f"Building {len(pages)} page(s) into {OUT_DIR.relative_to(ROOT)}/")
    for name in pages:
        out = build(name, style_block, script_block)
        if name == "index.html":
            shutil.copyfile(out, LANDING_ALIAS)
            print(f"  {LANDING_ALIAS.name}: copy of standalone/index.html")


if __name__ == "__main__":
    main()
