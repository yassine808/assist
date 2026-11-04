"""Rebuild the 30 Agent Mastery APNGs from the game's own layers.

Placement rules, derived by comparing candidate composites against the wiki's
animated cards for Astra, Jett, Fade, Neon, Sova and KAYO:

* square flipbook cell -> the layer is authored as a square overlay for the
  card's upper art area, so it is scaled to 1.10x of the cell and anchored at
  (-6, 36). (Astra, Jett, Fade, KAYO match the wiki best this way.)
* non-square cell -> the sheet already carries the card's aspect, so the cell
  is stretched to the full 268x640 quad. (Neon and Sova match best this way.)

Blending is plain alpha-over: the game draws the sequence as the card art, and
a screen blend washes out the cards whose layer is the whole artwork.

Usage:  python build_mastery.py [out_dir] [Agent ...]
"""
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import compose as C  # noqa: E402  (CARDS table + frame splitting)

ROOT = C.ROOT
W, H = C.W, C.H

OVERLAY_SCALE = 1.10
OVERLAY_X, OVERLAY_Y = -6, 36


def placement(cell):
    """Return ('overlay', scale, x, y) for square cells, else ('stretch', ...)."""
    if abs(cell.width - cell.height) <= max(cell.width, cell.height) * 0.02:
        return 'overlay', OVERLAY_SCALE, OVERLAY_X, OVERLAY_Y
    return 'stretch', None, None, None


def layer_for(cell, kind, scale, ox, oy):
    if kind == 'stretch':
        return cell.resize((W, H), Image.LANCZOS)
    ww, hh = int(round(cell.width * scale)), int(round(cell.height * scale))
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    canvas.paste(cell.resize((ww, hh), Image.LANCZOS), (ox, oy))
    return canvas


def composite(base, layer):
    b = np.asarray(base, dtype=np.float32)
    a = np.asarray(layer, dtype=np.float32)
    alpha = a[:, :, 3:4] / 255.0
    out = b * (1 - alpha) + a[:, :, :3] * alpha
    return np.clip(out, 0, 255).astype(np.uint8)


def build(agent, out_dir):
    base_name, sheet, cols, rows = C.CARDS[agent]
    base = Image.open(os.path.join(ROOT, 'Game', base_name)).convert('RGB')
    if base.size != (W, H):
        base = base.resize((W, H), Image.LANCZOS)
    frames, _ = C.load_frames(sheet, cols, rows)

    kind, scale, ox, oy = placement(frames[0])
    out = [Image.fromarray(composite(base, layer_for(c, kind, scale, ox, oy)), 'RGB') for c in frames]

    path = os.path.join(out_dir, agent + '_Mastery_Card_animated.apng')
    out[0].save(path, save_all=True, append_images=out[1:], duration=66, loop=0, disposal=1)
    return path, len(out), kind


if __name__ == '__main__':
    args = sys.argv[1:]
    out_dir = args[0] if args and args[0] not in C.CARDS else os.path.join(ROOT, 'Animated')
    agents = [a for a in args if a in C.CARDS] or sorted(C.CARDS)
    os.makedirs(out_dir, exist_ok=True)
    for a in agents:
        p, n, kind = build(a, out_dir)
        print(f'{a:10s} {n:3d} frames  {os.path.getsize(p) / 1048576:5.2f} MB  {kind}', flush=True)
    print(f'{len(agents)} cards -> {out_dir}')
