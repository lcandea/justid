#!/usr/bin/env python3
"""Normalise the document reference pictures (scans on a white background).

For every img/*.webp (originals are never modified):
  1. find the 4 card edges (robust line fit on the background -> card transition),
  2. perspective-warp the card to CARD_W x CARD_H (same size the app uses),
  3. level brightness (black/white points) so all references look alike,
  4. cut the ISO/IEC 7810 ID-1 rounded corners out with transparency.

Output: img/ref/<same name>.webp with alpha, ready to show on any background.

Usage (from tools/):  uv run normalize_refs.py [--debug]
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "img"
OUT = ROOT / "img" / "ref"
CARD_W, CARD_H = 1012, 638             # must match js/common.js
RADIUS = round(3.18 / 85.6 * CARD_W)   # ID-1 corner radius (3.18 mm)
SS = 4                                 # mask supersampling (anti-aliased corners)


def edge_points(img, bg, side, thr=14):
    """For each central row/column, the first pixel (from outside) that departs from the background."""
    diff = np.abs(img.astype(np.int16) - bg).max(axis=2) > thr
    H, W = diff.shape
    pts = []
    if side in ("left", "right"):
        for y in range(int(H * 0.2), int(H * 0.8)):
            line = diff[y] if side == "left" else diff[y, ::-1]
            run = np.convolve(line, np.ones(3), "valid") == 3  # 3 in a row: ignore dust / compression noise
            i = np.argmax(run)
            if run[i]:
                pts.append((i if side == "left" else W - 1 - i, y))
    else:
        for x in range(int(W * 0.2), int(W * 0.8)):
            line = diff[:, x] if side == "top" else diff[::-1, x]
            run = np.convolve(line, np.ones(3), "valid") == 3
            i = np.argmax(run)
            if run[i]:
                pts.append((x, i if side == "top" else H - 1 - i))
    return np.array(pts, float)


def fit_line(pts, vertical):
    """Robust fit of x = a*y + b (vertical) or y = a*x + b, dropping outliers."""
    u, v = (pts[:, 1], pts[:, 0]) if vertical else (pts[:, 0], pts[:, 1])
    # Scans are nearly straight: seed with the median so false hits (near-white card areas)
    # can't drag the first fit away.
    keep = np.abs(v - np.median(v)) < 4
    for _ in range(5):
        a, b = np.polyfit(u[keep], v[keep], 1)
        res = np.abs(v - (a * u + b))
        keep = res < max(1.5, 2.5 * np.median(res[keep]))
    return a, b


def corners(img):
    border = np.concatenate([img[:4].reshape(-1, 3), img[-4:].reshape(-1, 3),
                             img[:, :4].reshape(-1, 3), img[:, -4:].reshape(-1, 3)])
    bg = np.median(border, axis=0)
    L = fit_line(edge_points(img, bg, "left"), True)
    R = fit_line(edge_points(img, bg, "right"), True)
    T = fit_line(edge_points(img, bg, "top"), False)
    B = fit_line(edge_points(img, bg, "bottom"), False)

    def meet(vl, hl):  # x = a1*y + b1 ; y = a2*x + b2
        a1, b1 = vl; a2, b2 = hl
        y = (a2 * b1 + b2) / (1 - a1 * a2)
        return (a1 * y + b1, y)
    q = np.array([meet(L, T), meet(R, T), meet(R, B), meet(L, B)])
    # pull 1 px inwards so the edge halo doesn't bleed into the output
    c = q.mean(axis=0)
    return [tuple(p + (c - p) / np.linalg.norm(c - p)) for p in q]


def homography(src, dst):
    A, b = [], []
    for (x, y), (u, v) in zip(src, dst):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); b.append(v)
    return np.linalg.solve(np.array(A, float), np.array(b, float))


def level(card):
    """Stretch levels using luminance percentiles (same gain on all channels, so hue is kept)."""
    a = np.asarray(card, float)
    lum = a @ [0.299, 0.587, 0.114]
    lo, hi = np.percentile(lum, 0.5), np.percentile(lum, 99.5)
    a = (a - lo) * (240 - 12) / max(1, hi - lo) + 12
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def rounded_mask():
    m = Image.new("L", (CARD_W * SS, CARD_H * SS), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, CARD_W * SS - 1, CARD_H * SS - 1), RADIUS * SS, fill=255)
    return m.resize((CARD_W, CARD_H), Image.LANCZOS)


def process(path, debug=False):
    im = Image.open(path).convert("RGB")
    q = corners(np.asarray(im))
    # PIL's PERSPECTIVE expects the output -> input mapping. Render at 2x and downscale
    # to reduce aliasing on the guilloche patterns.
    W2, H2 = CARD_W * 2, CARD_H * 2
    coeffs = homography([(0, 0), (W2, 0), (W2, H2), (0, H2)], q)
    big = im.transform((W2, H2), Image.PERSPECTIVE, tuple(coeffs), Image.BICUBIC)
    card = level(big.resize((CARD_W, CARD_H), Image.LANCZOS))
    card.putalpha(rounded_mask())
    OUT.mkdir(parents=True, exist_ok=True)
    out = OUT / (path.stem + ".webp")
    card.save(out, "WEBP", quality=88, method=6)
    print(f"  ok {path.name}: corners {[tuple(round(v) for v in p) for p in q]} -> "
          f"{out.relative_to(ROOT)} ({out.stat().st_size // 1024} KB)")
    if debug:
        dbg = im.copy()
        ImageDraw.Draw(dbg).polygon(q, outline=(255, 0, 0), width=2)
        dbg.save(OUT.parent / (path.stem + "_debug.png"))


if __name__ == "__main__":
    files = sorted(SRC.glob("*.webp"))
    if not files:
        sys.exit("No pictures found in img/*.webp")
    for p in files:
        process(p, "--debug" in sys.argv)
