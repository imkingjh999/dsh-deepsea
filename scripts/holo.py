#!/usr/bin/env python3
"""
holo.py — bake the two decoration layers that give a card its laser-foil look.

Usage: holo.py <card_art.png> <out_diffraction.png> <out_ellipse.png>

Layer 1 (diffraction): an interference rainbow whose hue field is the sum of
several directional sine waves, nudged by the art's own luminance so the foil
stays in the card's color family. High saturation, mid value — the DOM later
composites it with mix-blend-mode: color-dodge at tilt-driven opacity.

Layer 2 (ellipse): tiled elongated specular ellipses (the classic foil-stamp
banding). Soft white lobes on black — composited with mix-blend-mode: overlay.

Pure PIL + numpy; no scipy, no network. Deterministic per input image (seed
derived from the art's average color), so re-running the pipeline reproduces
identical layers.
"""
import sys
import hashlib

import numpy as np
from PIL import Image, ImageFilter

W, H = 640, 928  # decoration layer resolution (art is 768x1104)


def load_luma(path: str) -> np.ndarray:
    art = Image.open(path).convert("L").resize((W, H), Image.LANCZOS)
    return np.asarray(art).astype(np.float32) / 255.0


def seed_from(path: str, salt: bytes) -> tuple[int, ...]:
    with open(path, "rb") as f:
        digest = hashlib.sha256(salt + f.read(65536)).digest()
    return tuple(int.from_bytes(digest[i * 4:(i + 1) * 4], "big") for i in range(8))


def hsv_to_rgb_array(hsv: "np.ndarray") -> "np.ndarray":
    """Vectorized HSV->RGB (each in 0..1), shape (H,W,3)."""
    h = hsv[..., 0]
    s = hsv[..., 1]
    v = hsv[..., 2]
    i = np.floor(h * 6.0)
    f = h * 6.0 - i
    p = v * (1.0 - s)
    q = v * (1.0 - s * f)
    t = v * (1.0 - s * (1.0 - f))
    i = i.astype(np.int32) % 6
    r = np.choose(i, [v, q, p, p, t, v])
    g = np.choose(i, [t, v, v, q, p, p])
    b = np.choose(i, [p, p, t, v, v, q])
    return np.stack([r, g, b], axis=-1).astype(np.float32)


def diffraction_layer(luma: np.ndarray, seed: tuple[int, ...]) -> Image.Image:
    rng = np.random.default_rng(list(seed))
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    xx /= W
    yy /= H

    hue = np.zeros((H, W), dtype=np.float32)
    waves = 5
    for k in range(waves):
        fx = rng.uniform(-6.0, 6.0)
        fy = rng.uniform(-3.0, 3.0)
        ph = rng.uniform(0.0, 2.0 * np.pi)
        amp = rng.uniform(0.12, 0.3)
        hue += amp * np.sin(2.0 * np.pi * (fx * xx + fy * yy) + ph)

    # Nudge by the art's luminance so the foil belongs to this card.
    lum = luma[::4, ::4]
    lum = np.asarray(Image.fromarray((lum * 255).astype(np.uint8)).resize((W, H), Image.BILINEAR),
       dtype=np.float32) / 255.0
    hue = hue * 0.75 + lum * 0.5
    hue = (hue + 1.0) % 1.0

    sat = np.full((H, W), 0.85, dtype=np.float32)
    val = 0.5 + 0.3 * lum  # brighter where the art is bright

    hsv = np.stack([hue, sat, np.clip(val, 0.25, 0.95)], axis=-1)
    arr = (hsv_to_rgb_array(hsv) * 255).astype(np.uint8)
    return Image.fromarray(arr, "RGB").filter(ImageFilter.GaussianBlur(0.6))


def ellipse_layer(seed: tuple[int, ...]) -> Image.Image:
    rng = np.random.default_rng(list(seed)[4:])
    img = Image.new("L", (W, H), 0)
    from PIL import ImageDraw

    draw = ImageDraw.Draw(img)
    diagonal = int((W * W + H * H) ** 0.5)
    span = 380
    x = -span
    band = 0
    while x < diagonal:
        w = int(rng.uniform(90, 190))
        h = int(rng.uniform(26, 60))
        alpha = int(rng.uniform(70, 150))
        cy = int(H * rng.uniform(0.18, 0.82))
        # Draw rotated ellipse via a temp canvas.
        tile = Image.new("L", (w * 2, h * 2), 0)
        ImageDraw.Draw(tile).ellipse((0, 0, w * 2, h * 2), fill=alpha)
        tile = tile.rotate(-28, expand=True)
        img.paste(tile, (int(x - tile.width / 2), int(cy - tile.height / 2)), tile)
        x += int(w * rng.uniform(1.1, 1.8))
        band += 1
    img = img.filter(ImageFilter.GaussianBlur(9))

    out = Image.new("RGB", (W, H), (0, 0, 0))
    out.putalpha(img)
    # overlay blend needs RGB; give the lobes a faint cool tint.
    tinted = Image.merge("RGB", (
        img.point(lambda v: int(v * 0.92)),
        img.point(lambda v: int(v * 0.96)),
        img,
    ))
    return tinted


def main() -> int:
    if len(sys.argv) != 4:
        print("usage: holo.py <art.png> <out_diffraction.png> <out_ellipse.png>", file=sys.stderr)
        return 2
    art_path, diff_out, ell_out = sys.argv[1], sys.argv[2], sys.argv[3]
    luma = load_luma(art_path)
    seed = seed_from(art_path, b"deepsea-holo-v1")
    diffraction_layer(luma, seed).save(diff_out, "PNG")
    ellipse_layer(seed).save(ell_out, "PNG")
    return 0


if __name__ == "__main__":
    sys.exit(main())
