"""
Generates the browser and home screen icons from one drawing of the mark.

The mark is the header logo (components/Logo.tsx): a graded case with a lens
on its label, on the accent to --accent-2 gradient. Here it is snapped to the
pixel grid, so its edges and label line stay sharp in a 16 or 32 pixel tab.

    python3 -m venv .venv && .venv/bin/pip install cairosvg pillow
    .venv/bin/python apps/web/scripts/make_icons.py

Writes, relative to apps/web:
    app/icon.svg              the favicon modern browsers use
    app/favicon.ico           16, 32 and 48 px, for older browsers and /favicon.ico
    app/apple-icon.png        180 px, full bleed (iOS rounds the corners itself)
    public/icons/icon-192.png and icon-512.png    rounded tile, for the web manifest
    public/icons/maskable-512.png                 full bleed, mark inside the safe zone

Next.js links the three files in app/ from every page; app/manifest.ts lists
the ones in public/icons.
"""

import io
from pathlib import Path

import cairosvg
from PIL import Image

WEB = Path(__file__).resolve().parent.parent

# --accent, --accent-2 and --accent-ink from styles/tokens.css, written out so
# every file works on its own.
ACCENT = "#e4ff3a"
ACCENT_2 = "#7cf3c9"
ACCENT_INK = "#0b0b0c"

# On a 32 unit square: the case, the line under its label, the lens. Every
# edge falls on an even unit, so it lands on a whole pixel at 16 px as well.
MARK = (
    f'<rect x="9" y="5" width="14" height="22" rx="2.5" fill="none" stroke="{ACCENT_INK}" stroke-width="2"/>'
    f'<path d="M9 11h14" stroke="{ACCENT_INK}" stroke-width="2"/>'
    f'<circle cx="16" cy="19" r="3" fill="{ACCENT_INK}"/>'
)


def tile(rounded: bool, scale: float = 1.0) -> str:
    """The mark on its gradient tile. A full bleed tile is for platforms that
    cut their own shape; scale shrinks the mark about the center."""
    corner = ' rx="8"' if rounded else ""
    mark = MARK if scale == 1.0 else f'<g transform="translate(16 16) scale({scale}) translate(-16 -16)">{MARK}</g>'
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
        '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0" stop-color="{ACCENT}"/><stop offset="1" stop-color="{ACCENT_2}"/>'
        "</linearGradient></defs>"
        f'<rect width="32" height="32"{corner} fill="url(#g)"/>'
        f"{mark}</svg>\n"
    )


def render(svg: str, size: int) -> Image.Image:
    png = cairosvg.svg2png(bytestring=svg.encode(), output_width=size, output_height=size)
    return Image.open(io.BytesIO(png)).convert("RGBA")


def save_png(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, optimize=True)
    print(f"wrote {path.relative_to(WEB)} ({path.stat().st_size} bytes)")


def main() -> None:
    rounded = tile(rounded=True)

    icon_svg = WEB / "app" / "icon.svg"
    icon_svg.write_text(rounded)
    print(f"wrote {icon_svg.relative_to(WEB)} ({icon_svg.stat().st_size} bytes)")

    # Each size is drawn on its own rather than scaled down from the largest.
    # Pillow writes only sizes up to the first frame's, so that one is 48.
    sizes = [48, 16, 32]
    frames = [render(rounded, s) for s in sizes]
    ico = WEB / "app" / "favicon.ico"
    frames[0].save(ico, format="ICO", sizes=[(s, s) for s in sizes], append_images=frames[1:])
    print(f"wrote {ico.relative_to(WEB)} ({ico.stat().st_size} bytes)")

    # iOS puts a transparent icon on black, so this one has no transparent corners.
    save_png(render(tile(rounded=False, scale=0.86), 180).convert("RGB"), WEB / "app" / "apple-icon.png")

    save_png(render(rounded, 192), WEB / "public" / "icons" / "icon-192.png")
    save_png(render(rounded, 512), WEB / "public" / "icons" / "icon-512.png")
    # A maskable icon may be cut to a circle 80% wide; at 0.8 the case's
    # corners sit 36% from the center.
    save_png(render(tile(rounded=False, scale=0.8), 512).convert("RGB"), WEB / "public" / "icons" / "maskable-512.png")


if __name__ == "__main__":
    main()
