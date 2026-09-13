"""The brand roster: every company on a Larp City building or billboard, as data.

catalog.py turns each placement into a branded catalog entry, and make_ads.py draws every sign file those
entries name from the same brand's colors, wordmark, and mark, so adding a company is one entry here (plus a
mark function in make_ads.py's MARKS if it needs a new shape). Design: docs/superpowers/specs/2026-09-13-sf-brands-design.md.

Following SF's sign rules, no sign stands on a downtown roof or crowns a tower: downtown brands live at street
level, on HQ name bands (over the lobby and across the top floor, as wall signs) and lobby walls, and on wall boards
on low buildings; rooftop bulletins stay on old SoMa lofts, and V boards stand beside the freeway.

A brand is a dict:
  id       file-name stem of its sign art (bb-<id>.png, fa-<id>.png, ...)
  name     the company, for docs and tests
  word     the wordmark, lettered in Pixelify Sans (never the real logotype)
  short    a shorter wordmark for small surfaces (blades, 1-tile bands); defaults to word
  field    the sign's background color
  ink      the lettering color
  mark     (shape, *colors) from make_ads.MARKS, or None for a wordmark-only brand
  sponsor  a HackRice sponsor
  places   where it appears (the helpers below)
  tagline  the second line of a painted ghost sign
  custom   sign files whose art make_ads.py draws by hand (the approved first brands); the rest use shared layouts
"""

DOWNTOWN, MIDTOWN, MIXED = ["downtown"], ["midtown"], ["downtown", "midtown"]


def brand(id, name, word, field, ink, mark=None, short=None, sponsor=False, places=(), custom=(), tagline=None):
    return {"id": id, "name": name, "word": word, "short": short or word, "field": field, "ink": ink, "mark": mark,
            "sponsor": sponsor, "places": list(places), "custom": set(custom), "tagline": tagline}


# Placements. Each takes a footprint (w x d tiles), floors, and a render seed; area names a circle in the city
# definition (san-francisco.ts areas) that the game prefers for the lot. art overrides the sign files' stem
# where the first brands named them differently (the Capital One Cafe's shop signs, the Levi's ghost sign).

def bulletin(w, d, floors, seed, face="-Y", area="soma", zones=MIDTOWN, art=None):
    """A lit rooftop bulletin on an old brick loft (SoMa only), facing one visible side."""
    return {"surface": "bulletin", "w": w, "d": d, "floors": floors, "seed": seed, "face": face, "area": area,
            "zones": zones, "art": art}


def wall_board(host, w, d, floors, seed, area=None, zones=DOWNTOWN):
    """A lit 2:1 board flat on the windowless right (+X) wall of a low office or loft (host)."""
    return {"surface": "wall_board", "host": host, "w": w, "d": d, "floors": floors, "seed": seed, "area": area,
            "zones": zones}


def mural(w, d, floors, seed, style="panel", aspect=1.0, area="soma", zones=MIDTOWN, art=None):
    """Paint on a loft's right (+X) wall: a bright panel, or a faded ghost sign (style="ghost")."""
    return {"surface": "mural", "w": w, "d": d, "floors": floors, "seed": seed, "style": style, "aspect": aspect,
            "area": area, "zones": zones, "art": art}


def shop(w, d, floors, seed, zones=DOWNTOWN, facade="brick", atm=False, area=None, art=None):
    """A storefront with lit bands over its windows and a blade sign."""
    return {"surface": "shop", "w": w, "d": d, "floors": floors, "seed": seed, "zones": zones, "facade": facade,
            "atm": atm, "area": area, "art": art}


def hq(w, d, floors, seed, logo=True, monument=False, zones=DOWNTOWN, area=None):
    """A glass HQ with a lit name band over its double-height lobby, a logo wall inside, and an optional monument."""
    return {"surface": "hq", "w": w, "d": d, "floors": floors, "seed": seed, "logo": logo, "monument": monument,
            "zones": zones, "area": area}


def v_board(partner, seed):
    """One freeway V board: this brand on the left (-Y) board, partner on the right (+X) board. Placed beside the
    freeway by the game, never on a lot."""
    return {"surface": "v_board", "partner": partner, "seed": seed, "w": 1, "d": 1, "floors": 1, "zones": MIDTOWN}


def shelter():
    """Backlit panels on Muni shelters (both curb sides), placed beside streets by the game."""
    return {"surface": "shelter"}


BRANDS = [
    # ---- the first brands (2026-09-12); their art is drawn by hand in make_ads.py
    brand("capital-one", "Capital One", "Capital One", "#004879", "#FFFFFF", ("swoosh", "#D22E1E"), sponsor=True,
          places=[bulletin(2, 1, 3, 52), shop(2, 1, 3, 31, facade="stone", art="capital-one-cafe")],
          custom={"bb-capital-one", "fa-capital-one-cafe", "fs-capital-one-cafe", "bl-capital-one-cafe"}),
    brand("wells-fargo", "Wells Fargo", "WELLS FARGO", "#D71E28", "#FFCD41",
          places=[shop(2, 1, 4, 33, zones=MIXED, facade="stone", atm=True)],
          custom={"fa-wells-fargo", "fs-wells-fargo", "bl-wells-fargo"}),
    brand("uber", "Uber", "Uber", "#000000", "#FFFFFF", places=[hq(2, 2, 12, 41)], custom={"lw-uber"}),
    brand("google", "Google", "Google", "#FFFFFF", "#4285F4", places=[hq(2, 2, 10, 42, monument=True)],
          custom={"lw-google", "mo-google", "nb-google-2"}),
    brand("openai", "OpenAI", "OpenAI", "#000000", "#FFFFFF", places=[hq(2, 2, 11, 43)],
          custom={"lw-openai", "bb-openai"}),
    brand("meta", "Meta", "Meta", "#FFFFFF", "#1C2B33", ("meta", "#0866FF"), places=[hq(2, 2, 9, 44, monument=True)],
          custom={"lw-meta", "mo-meta"}),
    brand("goldman-sachs", "Goldman Sachs", "GOLDMAN SACHS", "#7399C6", "#FFFFFF", short="GOLDMAN",
          places=[hq(2, 2, 8, 45, logo=False, monument=True)], custom={"mo-goldman-sachs"}),
    brand("jenis", "Jeni's Splendid Ice Creams", "jeni's", "#2F2F30", "#FA4616",
          places=[shop(2, 1, 2, 32, zones=MIDTOWN)], custom={"fa-jenis", "fs-jenis", "bl-jenis"}),
    brand("elevenlabs", "ElevenLabs", "ElevenLabs", "#FFFFFF", "#000000", ("elevenlabs", "#000000"), sponsor=True,
          places=[bulletin(2, 1, 4, 51), shelter()], custom={"bb-elevenlabs", "sh-elevenlabs"}),
    brand("persona", "Persona", "persona", "#000000", "#FFFFFF", ("persona", "#7379FD"), sponsor=True,
          places=[bulletin(1, 2, 4, 53, face="+X"), shelter()], custom={"bb-persona", "sh-persona"}),
    brand("nordvpn", "NordVPN", "NordVPN", "#4687FF", "#FFFFFF", ("nord", "#FFFFFF", "#4687FF"), sponsor=True,
          places=[bulletin(1, 1, 3, 54), shelter()], custom={"bb-nordvpn", "sh-nordvpn"}),
    brand("anthropic", "Anthropic", "ANTHROPIC", "#FAF9F5", "#141413",
          places=[bulletin(2, 1, 5, 55), v_board("elevenlabs", 57)], custom={"bb-anthropic"}),
    brand("lovable", "Lovable", "Lovable", "#FE7B02", "#FFFFFF", ("heart", "#FFFFFF"), sponsor=True,
          places=[v_board("openai", 56)], custom={"bb-lovable"}),
    brand("levis", "Levi's", "LEVI'S", "#EFE4CF", "#EFE4CF",
          places=[mural(1, 2, 5, 61, style="ghost", aspect=1000 / 700, art="levis-ghost")], custom={"mu-levis-ghost"}),
    brand("mlh", "Major League Hacking", "mlh", "#FFFFFF", "#111111", sponsor=True,
          places=[mural(1, 2, 4, 62)], custom={"mu-mlh"}),
    brand("notability", "Notability", "Notability", "#F6EBDA", "#1E2A44", places=[mural(1, 1, 4, 63)],
          custom={"mu-notability"}),
    brand("bobatalks", "BobaTalks", "Boba Talks", "#FFF4EA", "#BA8478", sponsor=True,
          places=[mural(1, 2, 3, 64)], custom={"mu-bobatalks"}),

    # ---- 2026-09-13: HackRice sponsors
    brand("tiger-data", "Tiger Data", "TIGER\nDATA", "#141414", "#FFFFFF", ("stripes", "#FDB515"), sponsor=True,
          short="TIGER", places=[bulletin(2, 1, 4, 81)]),
    brand("vultr", "Vultr", "vultr", "#007BFC", "#FFFFFF", ("chevrons", "#FFFFFF", "#51B9FF"), sponsor=True,
          places=[v_board("solana", 97)]),
    brand("solana", "Solana", "SOLANA", "#141414", "#FFFFFF", ("bars", "#9945FF", "#14F195"), sponsor=True),
    brand("gemini", "Gemini", "Gemini", "#FFFFFF", "#3C6FE0", ("sparkle", "#3C6FE0", "#9B72CB"), sponsor=True,
          places=[bulletin(1, 2, 3, 82, face="+X")]),
    brand("backboard", "Backboard", "Backboard", "#0F3D2E", "#FFFFFF", sponsor=True,
          short="BACKBOARD", places=[wall_board("concrete_office", 1, 2, 6, 83)]),
    brand("godaddy", "GoDaddy Registry", "GoDaddy", "#FFFFFF", "#111111", ("underline", "#1BDBDB"), sponsor=True,
          places=[mural(1, 2, 4, 84)]),
    brand("mathworks", "MathWorks", "MathWorks", "#FFFFFF", "#0076A8", ("membrane", "#E16737", "#0076A8"),
          sponsor=True, places=[hq(2, 2, 9, 85)]),
    brand("presage", "Presage", "presage", "#14213D", "#FFFFFF", ("eye", "#3FD0E0"), sponsor=True,
          places=[wall_board("concrete_office", 1, 2, 5, 86)]),

    # ---- 2026-09-13: SF and Bay Area companies
    brand("stripe", "Stripe", "stripe", "#635BFF", "#FFFFFF", places=[hq(2, 2, 13, 87)]),
    brand("visa", "Visa", "VISA", "#1A1F71", "#FFFFFF", ("underline", "#F7B600"), places=[bulletin(2, 1, 5, 88)]),
    brand("schwab", "Charles Schwab", "SCHWAB", "#00A0DF", "#FFFFFF",
          places=[shop(1, 2, 4, 89, facade="stone")]),
    brand("robinhood", "Robinhood", "Robinhood", "#CCFF00", "#000000", ("feather", "#000000"),
          places=[v_board("lyft", 98)]),
    brand("plaid", "Plaid", "PLAID", "#111111", "#FFFFFF", ("tartan", "#FFFFFF"),
          places=[wall_board("brick_loft", 1, 2, 4, 90, area="soma", zones=MIDTOWN)]),
    brand("airbnb", "Airbnb", "airbnb", "#FFFFFF", "#FF5A5F", ("loop", "#FF5A5F"),
          places=[hq(2, 1, 6, 91, zones=MIDTOWN, area="soma")]),
    brand("dropbox", "Dropbox", "Dropbox", "#FFFFFF", "#0061FE", ("box", "#0061FE"), places=[hq(2, 2, 11, 92)]),
    brand("lyft", "Lyft", "lyft", "#FF00BF", "#FFFFFF"),
    brand("doordash", "DoorDash", "DOORDASH", "#FF3008", "#FFFFFF", ("dash", "#FFFFFF"),
          places=[bulletin(1, 2, 4, 93, face="+X")]),
    brand("ghirardelli", "Ghirardelli", "GHIRARDELLI", "#4A2C21", "#EFE4CF", short="GHIRAR-\nDELLI",
          places=[mural(1, 2, 5, 94)]),
    brand("blue-bottle", "Blue Bottle Coffee", "BLUE BOTTLE", "#FFFFFF", "#1F8FD6", ("bottle", "#1F8FD6"),
          short="BLUE\nBOTTLE", places=[shop(1, 2, 3, 95, area="embarcadero")]),
    brand("gap", "Gap", "GAP", "#002664", "#FFFFFF", places=[shop(1, 2, 5, 96)]),
]

BY_ID = {b["id"]: b for b in BRANDS}
