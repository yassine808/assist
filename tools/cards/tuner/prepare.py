#!/usr/bin/env python3
"""Build the source assets for the animated-card placement tuner.

Reads the raw game textures that were decoded during the Agent Mastery build
(`%TEMP%/opencode/cards/work/*.rgba` plus `params.csv`) and writes what the
tuner needs into `official playercards/AgentMastery/_tuner/`:

    _tuner/src/<Agent>/base.png        static card art, 268x640
    _tuner/src/<Agent>/sheet.png       full-size flipbook sheet
    _tuner/src/<Agent>/sheet-tile.png  downscaled sheet used by the 30-tile grid
    _tuner/cards.json                  per-card metadata + the material default

Run once before starting the server. Re-runnable; it overwrites the assets.
"""

import csv
import json
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[2]
DATA = PROJECT / "official playercards" / "AgentMastery" / "_tuner"

SRC = Path(os.environ.get("TEMP", "")) / "opencode" / "cards" / "work"
PARAMS_CSV = Path(os.environ.get("TEMP", "")) / "opencode" / "cards" / "params.csv"

CARD_W, CARD_H = 268, 640
TILE_MAX = 512

AGENT = {
    "Aggrobot": "Gekko", "BountyHunter": "Fade", "Breach": "Breach",
    "Cable": "Deadlock", "Cashew": "Tejo", "Clay": "Raze",
    "Deadeye": "Chamber", "Grenadier": "KAYO", "Guide": "Skye",
    "Gumshoe": "Cypher", "Hunter": "Sova", "Iris": "Miks",
    "Killjoy": "Killjoy", "Mage": "Harbor", "Nox": "Vyse",
    "Pandemic": "Viper", "Paprika": "Hush", "Phoenix": "Phoenix",
    "Pine": "Veto", "Rift": "Astra", "Sarge": "Brimstone",
    "Sequoia": "Iso", "Smonk": "Clove", "Sprinter": "Neon",
    "Stealth": "Yoru", "Terra": "Waylay", "Thorne": "Sage",
    "Vampire": "Reyna", "Wraith": "Omen", "Wushu": "Jett",
}

# Flipbook sheet sizes, read back from the decoded textures (the .rgba raw dump
# has no header). Cells are sheet / grid.
SHEET = {
    "Aggrobot": (1024, 1024), "BountyHunter": (1024, 1024), "Breach": (1024, 1024),
    "Cable": (1024, 1024), "Cashew": (1024, 1024), "Clay": (1024, 1024),
    "Deadeye": (1024, 1024), "Grenadier": (512, 1024), "Guide": (1024, 1024),
    "Gumshoe": (1024, 1024), "Hunter": (2048, 2048), "Iris": (2048, 2048),
    "Killjoy": (1024, 1024), "Mage": (2048, 2048), "Nox": (1024, 1024),
    "Pandemic": (2048, 2048), "Paprika": (4096, 2048), "Phoenix": (1024, 1024),
    "Pine": (2048, 2048), "Rift": (1024, 1024), "Sarge": (1024, 1024),
    "Sequoia": (2048, 2048), "Smonk": (2048, 2048), "Sprinter": (1024, 2048),
    "Stealth": (2048, 2048), "Terra": (1024, 1024), "Thorne": (1024, 1024),
    "Vampire": (1024, 1024), "Wraith": (1024, 1024), "Wushu": (1024, 1024),
}


def read_rgba(path, size):
    w, h = size
    raw = np.fromfile(path, dtype=np.uint8)
    if raw.size != w * h * 4:
        raise SystemExit("%s: expected %d bytes for %dx%d, got %d"
                         % (path, w * h * 4, w, h, raw.size))
    return raw.reshape(h, w, 4)


def parse_params():
    rows = {}
    with open(PARAMS_CSV, encoding="utf-8-sig") as f:
        for line in f:
            if not line.startswith("Bloomline_"):
                continue
            p = line.strip().split(",")
            rows[p[0].split("_")[1]] = dict(
                posH=float(p[1]), posV=float(p[2]), ratio=float(p[3]),
                scale=float(p[4]), cols=int(float(p[5])), rows=int(float(p[6])),
                speed=float(p[7]), blend=float(p[8]),
            )
    return rows


def quad(prm):
    """The material's own placement, in card pixels, centred."""
    w = CARD_W / (prm["scale"] * prm["ratio"])
    h = CARD_H / prm["scale"]
    cx = prm["posH"] * CARD_W
    cy = (1.0 - prm["posV"]) * CARD_H
    # Killjoy authors posV = 1.35, i.e. the quad is fully above the card. The
    # build clamped it to the top edge; keep the same visible default here.
    if cy + h / 2.0 <= 0:
        cy = 0.0
    elif cy - h / 2.0 >= CARD_H:
        cy = float(CARD_H)
    return dict(cx=round(cx, 2), cy=round(cy, 2), w=round(w, 2), h=round(h, 2), rot=0.0)


def main():
    if not SRC.is_dir() or not PARAMS_CSV.is_file():
        raise SystemExit("Missing source textures.\n  %s\n  %s\n"
                         "The raw dumps live in the temp folder used by the card build."
                         % (SRC, PARAMS_CSV))

    prm = parse_params()
    cards = []

    for codename, agent in sorted(AGENT.items(), key=lambda kv: kv[1]):
        if codename not in prm:
            print("[skip] no params for %s" % codename)
            continue
        base_path = SRC / (codename + "_L.rgba")
        sheet_path = SRC / (codename + "_seq.rgba")
        if not base_path.is_file() or not sheet_path.is_file():
            raise SystemExit("missing texture for %s" % codename)

        out = DATA / "src" / agent
        out.mkdir(parents=True, exist_ok=True)

        base = Image.fromarray(read_rgba(base_path, (CARD_W, CARD_H)), "RGBA")
        base.save(out / "base.png", optimize=True)

        size = SHEET[codename]
        sheet = Image.fromarray(read_rgba(sheet_path, size), "RGBA")
        sheet.save(out / "sheet.png", optimize=True)
        tw = TILE_MAX
        th = max(1, round(size[1] * TILE_MAX / size[0]))
        sheet.resize((tw, th), Image.LANCZOS).save(out / "sheet-tile.png", optimize=True)

        p = prm[codename]
        cols, rows = p["cols"], p["rows"]
        cards.append(dict(
            agent=agent,
            codename=codename,
            card="Bloomline_%s" % codename,
            file="%s_Mastery_Card_animated.apng" % agent,
            cols=cols,
            rows=rows,
            frames=cols * rows,
            cellW=round(size[0] / cols, 3),
            cellH=round(size[1] / rows, 3),
            sheetW=size[0],
            sheetH=size[1],
            ms=int(round(p["speed"] * 1000 * 1.03)),
            blend=round(p["blend"], 6),
            default=quad(p),
        ))
        print("[ok] %-10s %-12s %dx%d  %d frames  default %s"
              % (agent, codename, cols, rows, cols * rows, quad(p)))

    if len(cards) != 30:
        raise SystemExit("expected 30 cards, built %d" % len(cards))

    DATA.mkdir(parents=True, exist_ok=True)
    with open(DATA / "cards.json", "w", encoding="utf-8") as f:
        json.dump(dict(card=dict(w=CARD_W, h=CARD_H), cards=cards), f, indent=2)
    print("[done] %d cards -> %s" % (len(cards), DATA))


if __name__ == "__main__":
    sys.exit(main())
