"""Composite VALORANT Agent Mastery cards from the game's own layers.

base   : PlayerCard_Bloomline_<Code>_01_L  (or PlayerCards_<Code>AM_01_Large)
layer  : <...>_Sequence_01 flipbook (grid of animation frames, RGBA)
result : 268x640 loop

The `_Sequence` sheets are dumped from the game with
`tools/carddump --mode tex` into a scratch folder; point `CARDS_TEX` at it.
See `build_mastery.py` for the placement rules and the APNG writer.
"""
import os

from PIL import Image

TEX = os.environ.get(
    "CARDS_TEX", os.path.join(os.environ.get("LOCALAPPDATA", ""), "Temp", "opencode", "bloomline")
)
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "official playercards", "AgentMastery")
W, H = 268, 640

# agent -> (base png in Game/, sequence sheet in TEX, cols, rows)
CARDS = {
    'Astra':     ('Astra_Mastery_Card.png',     'Bloomline_Rift_01_Sequence_01', 4, 4),
    'Breach':    ('Breach_Mastery_Card.png',    'Playercard_Bloomline_Breach_01_Sequence_01', 4, 4),
    'Brimstone': ('Brimstone_Mastery_Card.png', 'Playercard_Bloomline_Sarge_01_Sequence_01', 4, 4),
    'Chamber':   ('Chamber_Mastery_Card.png',   'Bloomline_Deadeye_01_Sequence_01', 4, 4),
    'Clove':     ('Clove_Mastery_Card.png',     'Playercard_Bloomline_Smonk_01_Sequence_01', 4, 4),
    'Cypher':    ('Cypher_Mastery_Card.png',    'Playercard_Bloomline_Gumshoe_01_Sequence_01', 4, 4),
    'Deadlock':  ('Deadlock_Mastery_Card.png',  'Playercard_Bloomline_Cable_01_Sequence_02', 4, 4),
    'Fade':      ('Fade_Mastery_Card.png',      'Playercard_Bloomline_BountyHunter_01_Sequence_01', 4, 4),
    'Gekko':     ('Gekko_Mastery_Card.png',     'Bloomline_Aggrobot_01_Sequence_01', 4, 4),
    'Harbor':    ('Harbor_Mastery_Card.png',    'PlayerCards_Mage_Card_1', 4, 4),
    'Hush':      ('Hush_Mastery_Card.png',      'Playercard_Bloomline_Paprika_01_Sequence_01', 11, 5),
    'Iso':       ('Iso_Mastery_Card.png',       'Playercard_Bloomline_Sequoia_01_Sequence_01', 4, 4),
    'Jett':      ('Jett_Mastery_Card.png',      'Playercard_Bloomline_Wushu_01_Sequence_01', 4, 4),
    'KAYO':      ('KAYO_Mastery_Card.png',      'Playercard_Bloomline_Grenadier_01_Sequence_01', 2, 4),
    'Killjoy':   ('Killjoy_Mastery_Card.png',   'Playercard_Bloomline_Killjoy_01_Sequence_01', 4, 4),
    'Miks':      ('Miks_Mastery_Card.png',      'Playercard_Bloomline_Iris_01_Sequence_01', 4, 4),
    'Neon':      ('Neon_Mastery_Card.png',      'Playercard_Bloomline_Sprinter_00_Sequence_01', 4, 4),
    'Omen':      ('Omen_Mastery_Card.png',      'Playercard_Bloomline_Wraith_01_Sequence_01', 4, 4),
    'Phoenix':   ('Phoenix_Mastery_Card.png',   'Playercard_Bloomline_Phoenix_01_Sequence_01', 4, 4),
    'Raze':      ('Raze_Mastery_Card.png',      'Playercard_Bloomline_Clay_01_Sequence_01', 4, 4),
    'Reyna':     ('Reyna_Mastery_Card.png',     'Playercard_Bloomline_Vampire_01_Sequence_01', 4, 4),
    'Sage':      ('Sage_Mastery_Card.png',      'Bloomline_Thorne_01_Sequence_01', 4, 4),
    'Skye':      ('Skye_Mastery_Card.png',      'Playercard_Bloomline_Guide_01_Sequence_01', 4, 4),
    'Sova':      ('Sova_Mastery_Card.png',      'Playercard_Bloomline_Hunter_01_Sequence_01', 5, 2),
    'Tejo':      ('Tejo_Mastery_Card.png',      'Playercard_Bloomline_Cashew_01_Sequence_01', 4, 4),
    'Veto':      ('Veto_Mastery_Card.png',      'Playercard_Bloomline_Pine_01_Sequence_01', 4, 4),
    'Viper':     ('Viper_Mastery_Card.png',     'Playercard_Bloomline_Pandemic_01_Sequence_01', 4, 4),
    'Vyse':      ('Vyse_Mastery_Card.png',      'Playercard_Bloomline_Nox_01_Sequence_01', 4, 4),
    'Waylay':    ('Waylay_Mastery_Card.png',    'Playercard_Bloomline_Terra_01_Sequence_01', 4, 4),
    'Yoru':      ('Yoru_Mastery_Card.png',      'Playercard_Bloomline_Stealth_01_Sequence_01', 4, 4),
}


def load_frames(sheet_name, cols, rows):
    """Split a flipbook sheet into cells, left to right, top to bottom."""
    sheet = Image.open(os.path.join(TEX, sheet_name + '.png')).convert('RGBA')
    sw, sh = sheet.size
    cw, ch = sw / cols, sh / rows
    out = []
    for r in range(rows):
        for c in range(cols):
            box = (round(c * cw), round(r * ch), round((c + 1) * cw), round((r + 1) * ch))
            out.append(sheet.crop(box))
    return out, (cw, ch)
