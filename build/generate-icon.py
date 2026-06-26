#!/usr/bin/env python3
"""Generate the macOS/Windows/Linux app-icon (build/icon.png) from the transparent
brand logo. macOS 26 (Tahoe) masks every app icon into a rounded tile and fills the
background, so a transparent logo renders on a white plate. We pre-compose the logo
onto a brand-dark squircle here so the tile is intentional, not white.

Tweak the three knobs below and re-run:  python3 build/generate-icon.py
"""
from PIL import Image
import numpy as np

SRC        = "assets/app_main_icon.png"   # transparent source logo (untouched)
OUT        = "build/icon.png"             # packaged app icon (mac/win/linux)
SIZE       = 1024                          # final icon size (largest icns slice)
SS         = 2                             # supersample factor for crisp edges
BG_TOP     = (0x12, 0x13, 0x1a)            # subtle top-of-gradient (reads as #0a0b10)
BG_BOTTOM  = (0x0a, 0x0b, 0x10)            # brand-dark, matches the app window
SQUIRCLE_N = 5.0                           # superellipse exponent (~Apple's squircle)
LOGO_FRAC  = 0.78                          # logo's larger side as a fraction of the tile

S = SIZE * SS

# ── 1. brand-dark vertical gradient background ───────────────────────────────
ys = np.linspace(0.0, 1.0, S).reshape(S, 1)
chan = lambda a, b: np.broadcast_to(a * (1 - ys) + b * ys, (S, S))
rgb = np.stack([chan(BG_TOP[i], BG_BOTTOM[i]) for i in range(3)], axis=2)

# ── 2. full-bleed squircle mask (|x|^n + |y|^n <= 1), antialiased via downscale ─
xs = np.linspace(-1.0, 1.0, S).reshape(1, S)
yn = np.linspace(-1.0, 1.0, S).reshape(S, 1)
inside = (np.abs(xs) ** SQUIRCLE_N + np.abs(yn) ** SQUIRCLE_N) <= 1.0
alpha = (inside * 255).astype("uint8")

tile = np.dstack([rgb.astype("uint8"), alpha])
tile = Image.fromarray(tile, "RGBA")

# ── 3. scale the logo up and composite it centered on the tile ───────────────
logo = Image.open(SRC).convert("RGBA")
logo = logo.crop(logo.getbbox())                      # trim transparent margins
bw, bh = logo.size
scale = (LOGO_FRAC * S) / max(bw, bh)
logo = logo.resize((round(bw * scale), round(bh * scale)), Image.LANCZOS)
nw, nh = logo.size

layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
layer.paste(logo, ((S - nw) // 2, (S - nh) // 2))
tile = Image.alpha_composite(tile, layer)

# ── 4. downscale to final size (this is what antialiases the squircle edge) ──
tile = tile.resize((SIZE, SIZE), Image.LANCZOS)
tile.save(OUT)
print(f"wrote {OUT} ({SIZE}x{SIZE}); logo {nw//SS}x{nh//SS} on {SIZE}px tile "
      f"=> logo fills {LOGO_FRAC:.0%} of the larger side")
