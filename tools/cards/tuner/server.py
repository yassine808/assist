#!/usr/bin/env python3
"""Local placement tuner for the 30 Agent Mastery animated playercards.

Serves `index.html` plus the raw `_tuner` sources (base art + flipbook sheet)
and writes a freshly composed APNG into
`official playercards/AgentMastery/Animated/` when the Save button is pressed.

Usage:
    python tools/cards/tuner/server.py            # opens the browser
    python tools/cards/tuner/server.py --port 8787 --no-browser
"""

import argparse
import io
import json
import math
import os
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[2]
DATA = PROJECT / "official playercards" / "AgentMastery" / "_tuner"
CARDS_JSON = DATA / "cards.json"
SRC = DATA / "src"
OUT = PROJECT / "official playercards" / "AgentMastery" / "Animated"
SETTINGS = DATA / "placement.json"

CARD_W, CARD_H = 268, 640
DEFAULT_OPACITY = 1.0
DEFAULT_SPEED = 3.0
SAVE_LOCK = threading.Lock()
FULL_CARD_CACHE = {}


def is_full_card(card):
    """True when the flipbook cell is the whole card art, not an effect layer."""
    agent = card["agent"]
    if agent in FULL_CARD_CACHE:
        return FULL_CARD_CACHE[agent]
    sheet = Image.open(SRC / agent / "sheet.png").convert("RGBA")
    opaque = True
    for index in (0, card["frames"] // 2, card["frames"] - 1):
        col = index % card["cols"]
        row = index // card["cols"]
        x0 = col * card["sheetW"] / float(card["cols"])
        y0 = row * card["sheetH"] / float(card["rows"])
        x1 = (col + 1) * card["sheetW"] / float(card["cols"])
        y1 = (row + 1) * card["sheetH"] / float(card["rows"])
        cell = sheet.crop((int(round(x0)), int(round(y0)),
                           int(round(x1)), int(round(y1))))
        alpha = np.asarray(cell, dtype=np.uint8)[:, :, 3]
        if float((alpha >= 250).mean()) < 0.999:
            opaque = False
            break
    FULL_CARD_CACHE[agent] = opaque
    return opaque


def card_default(card):
    if is_full_card(card):
        # Cover the card without distorting the cell: keep the cell's own
        # aspect ratio, scale it until both card axes are covered, and let the
        # canvas crop the overflow.
        cw = float(card["cellW"])
        ch = float(card["cellH"])
        scale = max(CARD_W / cw, CARD_H / ch)
        return dict(cx=CARD_W / 2.0, cy=CARD_H / 2.0,
                    w=cw * scale, h=ch * scale, rot=0.0)
    return card["default"]



def load_cards():
    with open(CARDS_JSON, encoding="utf-8") as f:
        return json.load(f)


def load_placement():
    if not SETTINGS.is_file():
        return {}
    try:
        with open(SETTINGS, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def write_json_atomic(path, data):
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, path)


def merged_cards():
    data = load_cards()
    saved = load_placement()
    for card in data["cards"]:
        full = is_full_card(card)
        card["fullCard"] = full
        card["default"] = card_default(card)
        pick = saved.get(card["agent"])
        values = clean_placement(card, pick if isinstance(pick, dict) else {})
        card["placement"] = values
        card["saved"] = bool(isinstance(pick, dict) and pick)
        card["baseUrl"] = "/tuner-src/%s/base.png" % card["agent"]
        card["sheetUrl"] = "/tuner-src/%s/sheet.png" % card["agent"]
        card["tileUrl"] = "/tuner-src/%s/sheet-tile.png" % card["agent"]
        card["outUrl"] = "/animated/%s" % card["file"]
    return data


def clamp(value, low, high):
    return max(low, min(high, value))


def clean_placement(card, raw):
    default = card_default(card)
    try:
        cx = float(raw.get("cx", default["cx"]))
        cy = float(raw.get("cy", default["cy"]))
        w = float(raw.get("w", default["w"]))
        h = float(raw.get("h", default["h"]))
        rot = float(raw.get("rot", default.get("rot", 0.0)))
        blend = float(raw.get("blend", card["blend"]))
        opacity = float(raw.get("opacity", DEFAULT_OPACITY))
        ms = float(raw.get("ms", card["ms"] / DEFAULT_SPEED))
    except (TypeError, ValueError):
        raise ValueError("placement values must be numbers")
    if not math.isfinite(cx + cy + w + h + rot + blend + opacity + ms):
        raise ValueError("placement values must be finite")
    return dict(
        cx=round(clamp(cx, -2000.0, 2000.0), 3),
        cy=round(clamp(cy, -2000.0, 2000.0), 3),
        w=round(clamp(w, 1.0, 3000.0), 3),
        h=round(clamp(h, 1.0, 3000.0), 3),
        rot=round(clamp(rot, -180.0, 180.0), 3),
        blend=round(clamp(blend, 0.0, 1.0), 6),
        opacity=round(clamp(opacity, 0.0, 1.0), 3),
        ms=int(round(clamp(ms, 20.0, 2000.0))),
    )


def compose_frame(base, sheet, card, placement, index):
    """One composited 268x640 RGBA frame: sheet cell over base, colour kept."""
    cols = card["cols"]
    rows = card["rows"]
    col = index % cols
    row = index // cols
    x0 = col * card["sheetW"] / float(cols)
    y0 = row * card["sheetH"] / float(rows)
    x1 = (col + 1) * card["sheetW"] / float(cols)
    y1 = (row + 1) * card["sheetH"] / float(rows)
    cell = sheet.crop((int(round(x0)), int(round(y0)),
                       int(round(x1)), int(round(y1))))

    w = max(1, int(round(placement["w"])))
    h = max(1, int(round(placement["h"])))
    cell = cell.resize((w, h), Image.LANCZOS)

    rot = placement.get("rot", 0.0)
    if abs(rot) > 0.01:
        cell = cell.rotate(rot, resample=Image.BICUBIC, expand=True)

    patch = Image.new("RGBA", (CARD_W, CARD_H), (0, 0, 0, 0))
    px = int(round(placement["cx"] - cell.width / 2.0))
    py = int(round(placement["cy"] - cell.height / 2.0))
    patch.paste(cell, (px, py))

    b = np.asarray(base, dtype=np.float32)
    o = np.asarray(patch, dtype=np.float32)
    alpha = (o[:, :, 3:4] / 255.0) * float(placement.get("opacity", 1.0))
    rgb = o[:, :, :3] * alpha + b[:, :, :3] * (1.0 - alpha)
    out = np.empty_like(b)
    out[:, :, :3] = np.clip(rgb, 0.0, 255.0)
    out[:, :, 3] = 255.0
    return Image.fromarray(out.astype(np.uint8))


def build_apng(card, placement, out_path):
    base = Image.open(SRC / card["agent"] / "base.png").convert("RGBA")
    sheet = Image.open(SRC / card["agent"] / "sheet.png").convert("RGBA")
    if base.size != (CARD_W, CARD_H):
        raise ValueError("base art for %s is %s, expected 268x640"
                         % (card["agent"], base.size))

    frames = [compose_frame(base, sheet, card, placement, i)
              for i in range(card["frames"])]

    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_path.with_suffix(out_path.suffix + ".tmp")
    frames[0].save(
        tmp,
        format="PNG",
        save_all=True,
        append_images=frames[1:],
        duration=int(placement.get("ms", card["ms"])),
        loop=0,
        disposal=0,
        blend=0,
    )
    os.replace(tmp, out_path)
    return len(frames)


class Handler(BaseHTTPRequestHandler):
    server_version = "AgentMasteryTuner/1.0"

    def log_message(self, fmt, *args):
        sys.stderr.write("[tuner] " + (fmt % args) + "\n")

    def send_bytes(self, payload, content_type, status=200, cache=False):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        if not cache:
            self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def send_json(self, data, status=200):
        self.send_bytes(json.dumps(data).encode("utf-8"),
                        "application/json; charset=utf-8", status)

    def do_GET(self):
        path = unquote(urlparse(self.path).path)
        try:
            if path in ("/", "/index.html"):
                html = (ROOT / "index.html").read_bytes()
                self.send_bytes(html, "text/html; charset=utf-8")
                return
            if path == "/api/cards":
                self.send_json(merged_cards())
                return
            if path.startswith("/tuner-src/"):
                rel = path[len("/tuner-src/"):]
                parts = rel.split("/")
                if len(parts) != 2 or parts[0] not in {c["agent"] for c in load_cards()["cards"]}:
                    self.send_json({"error": "unknown source"}, 404)
                    return
                if parts[1] not in ("base.png", "sheet.png", "sheet-tile.png"):
                    self.send_json({"error": "unknown source"}, 404)
                    return
                file_path = SRC / parts[0] / parts[1]
                if not file_path.is_file():
                    self.send_json({"error": "missing source"}, 404)
                    return
                self.send_bytes(file_path.read_bytes(), "image/png", cache=True)
                return
            if path.startswith("/animated/"):
                name = path[len("/animated/"):]
                cards = {c["file"]: c for c in load_cards()["cards"]}
                if name not in cards:
                    self.send_json({"error": "unknown card"}, 404)
                    return
                file_path = OUT / name
                if not file_path.is_file():
                    self.send_json({"error": "missing card"}, 404)
                    return
                self.send_bytes(file_path.read_bytes(), "image/apng", cache=False)
                return
            self.send_json({"error": "not found"}, 404)
        except Exception as exc:  # keep the tuner alive and show the problem
            self.send_json({"error": str(exc)}, 500)

    def do_POST(self):
        path = urlparse(self.path).path
        if path != "/api/save":
            self.send_json({"error": "not found"}, 404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = json.loads(self.rfile.read(length).decode("utf-8"))
            agent = raw.get("agent")
            cards = {c["agent"]: c for c in load_cards()["cards"]}
            if agent not in cards:
                self.send_json({"error": "unknown agent"}, 400)
                return
            card = cards[agent]
            placement = clean_placement(card, raw)
            with SAVE_LOCK:
                out_path = OUT / card["file"]
                frames = build_apng(card, placement, out_path)
                saved = load_placement()
                saved[agent] = placement
                write_json_atomic(SETTINGS, saved)
            self.send_json({
                "ok": True,
                "agent": agent,
                "file": str(out_path.relative_to(PROJECT)),
                "frames": frames,
                "bytes": out_path.stat().st_size,
                "placement": placement,
                "url": "/animated/%s?t=%d" % (card["file"], out_path.stat().st_mtime_ns),
            })
        except ValueError as exc:
            self.send_json({"error": str(exc)}, 400)
        except Exception as exc:
            self.send_json({"error": str(exc)}, 500)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    if not CARDS_JSON.is_file():
        raise SystemExit("Missing %s. Run prepare.py first." % CARDS_JSON)
    OUT.mkdir(parents=True, exist_ok=True)

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    url = "http://127.0.0.1:%d/" % args.port
    print("[tuner] %s" % url, flush=True)
    print("[tuner] save target: %s" % OUT, flush=True)
    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    sys.exit(main())
