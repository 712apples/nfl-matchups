"""
Generate app icons for the NFL Matchup Analyzer PWA.

Summary:
    Draws the app icon (a head-to-head bar chart: blue offense bars meeting
    red defense bars at a center line) with Pillow and saves it at the sizes
    needed for Android, iOS, and desktop installs. The artwork is drawn on a
    large canvas and downscaled for smooth edges. All artwork stays inside the
    central 80% safe zone so Android can crop the maskable icon to any shape.
    Same background and colors as the Parlay Hedge Calculator icon.

Setup (run once in your terminal):
    pip install pillow

Input files:
    None.

Output files (written to D:\\OneDrive\\Code\\DFS_direct\\NFL\\nfl-matchups\\icons\\):
    icon-192.png           - Standard icon with rounded corners (manifest, favicon).
    icon-512.png           - Standard icon with rounded corners (manifest, splash screen).
    icon-maskable-512.png  - Full-bleed icon that Android crops to its own shape.
    apple-touch-icon.png   - 180x180 full-bleed icon for the iOS home screen.

Usage:
    python generate_icons.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

OUTPUT_DIR = Path(__file__).resolve().parent / "icons"
CANVAS = 1024

BG_TOP = (12, 74, 110)
BG_BOTTOM = (15, 23, 42)
OFFENSE = (56, 189, 248)
DEFENSE = (248, 113, 113)
CENTER = (226, 232, 240)

# (offense bar length, defense bar length) as fractions of the half-width, top to bottom
BARS = [(0.85, 0.55), (0.50, 0.90), (0.75, 0.65)]


def draw_artwork(size: int = CANVAS) -> Image.Image:
    """
    Draw the full-bleed square icon artwork.

    Args:
        size: Width and height of the canvas in pixels.

    Returns:
        RGB image with a gradient background and three head-to-head bar pairs.
    """
    img = Image.new("RGB", (size, size))
    draw = ImageDraw.Draw(img)

    for y in range(size):
        t = y / (size - 1)
        color = tuple(round(a + (b - a) * t) for a, b in zip(BG_TOP, BG_BOTTOM))
        draw.line([(0, y), (size, y)], fill=color)

    center_x = size / 2
    half_width = 0.27 * size
    bar_h = 0.11 * size
    gap = 0.06 * size
    top = (size - (len(BARS) * bar_h + (len(BARS) - 1) * gap)) / 2
    radius = bar_h / 2
    notch = 0.012 * size

    for i, (off_len, def_len) in enumerate(BARS):
        y0 = top + i * (bar_h + gap)
        y1 = y0 + bar_h
        draw.rounded_rectangle([center_x - off_len * half_width, y0, center_x - notch, y1], radius=radius, fill=OFFENSE)
        draw.rounded_rectangle([center_x + notch, y0, center_x + def_len * half_width, y1], radius=radius, fill=DEFENSE)

    line_half = 0.008 * size
    draw.rounded_rectangle(
        [center_x - line_half, top - 0.04 * size, center_x + line_half, top + len(BARS) * bar_h + (len(BARS) - 1) * gap + 0.04 * size],
        radius=line_half,
        fill=CENTER,
    )
    return img


def rounded(img: Image.Image, radius_ratio: float = 0.22) -> Image.Image:
    """
    Apply transparent rounded corners to a square image.

    Args:
        img: Square RGB image.
        radius_ratio: Corner radius as a fraction of the image width.

    Returns:
        RGBA image with transparent corners.
    """
    size = img.width
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius_ratio * size, fill=255)
    out = img.convert("RGBA")
    out.putalpha(mask)
    return out


def main() -> None:
    """Render the artwork and save every icon size to OUTPUT_DIR."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    art = draw_artwork()
    art_rounded = rounded(art)

    outputs = {
        "icon-192.png": art_rounded.resize((192, 192), Image.LANCZOS),
        "icon-512.png": art_rounded.resize((512, 512), Image.LANCZOS),
        "icon-maskable-512.png": art.resize((512, 512), Image.LANCZOS),
        "apple-touch-icon.png": art.resize((180, 180), Image.LANCZOS),
    }
    for name, image in outputs.items():
        path = OUTPUT_DIR / name
        image.save(path, optimize=True)
        print(f"Saved {path}")


if __name__ == "__main__":
    main()
