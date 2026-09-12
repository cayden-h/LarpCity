"""Which sprites each city gets.

Branded entries are unique: placed once per city, on a lot in the inner part of
their zone when one fits, otherwise on another lot in the zone (sprite-pick.ts),
so a small city never repeats a mural or campaign. Following SF's sign rules (no rooftop signs
downtown), towers carry no brand names: brands live at street level, on
lobby walls, and on billboards atop older low buildings outside downtown.
"""

DOWNTOWN, MIDTOWN, MIXED = ["downtown"], ["midtown"], ["downtown", "midtown"]
KINDS = {"glass_tower": "glass", "brick_loft": "loft", "concrete_office": "office", "storefront": "shop",
         "hq_lobby": "hq", "monopole": "pole", "shelter": "shelter", "salesforce_tower": "lm", "ferry_building": "lm"}


def _e(kind, w, d, floors, seed, zones, sign=None, brand=None, opts=None, unique=None, sid=None,
       entry_kind=None, landmark=None, prop=None, side=None, fill=True, crown=False, pad=0):
    if sid is None:
        sid = f"{KINDS[kind]}-{w}x{d}-f{floors}-" + (brand or str(seed))
    return {
        "id": sid, "kind": kind, "w": w, "d": d, "floors": floors, "seed": seed, "zones": zones, "sign": sign,
        "brand": brand, "unique": (brand is not None) if unique is None else unique, "opts": opts or {},
        "entry_kind": entry_kind, "landmark": landmark, "prop": prop, "side": side, "fill": fill, "crown": crown, "pad": pad,
    }


def board(image, face="-Y"):
    return {"type": "bulletin", "image": f"bb-{image}.png", "face": face}


def mural(image, aspect=1.0):
    return {"mural": {"image": f"mu-{image}.png", "aspect": aspect}}


def shop(fascia, blade, facade="brick", atm=False):
    return {"facade": facade, "fascia": f"fa-{fascia}.png", "blade": f"bl-{blade}.png", "atm": atm}


def hq(logo=None, monument=None):
    return {"logo": f"lw-{logo}.png" if logo else None, "monument": f"mo-{monument}.png" if monument else None}


CATALOG = {
    "san-francisco": [
        # Landmarks the game draws in place of their procedural models.
        _e("salesforce_tower", 2, 2, 22, 21, DOWNTOWN, sid="salesforce-tower", entry_kind="landmark", landmark="sf-glass-tower", fill=False, crown=True),
        _e("ferry_building", 4, 1, 3, 22, DOWNTOWN, sid="ferry-building", entry_kind="landmark", landmark="sf-ferry-building"),
        # Street-level brands downtown: the Capital One Cafe (101 Post St), a Wells Fargo branch, quiet tech lobbies.
        _e("storefront", 2, 1, 3, 31, DOWNTOWN, brand="capital-one-cafe", opts=shop("capital-one-cafe", "capital-one", facade="stone")),
        # Bank branches line neighborhood streets too, and downtown's 2x1 lots run out.
        _e("storefront", 2, 1, 4, 33, MIXED, brand="wells-fargo", opts=shop("wells-fargo", "wells-fargo", facade="stone", atm=True)),
        _e("hq_lobby", 2, 2, 12, 41, DOWNTOWN, brand="uber", opts=hq("uber")),
        _e("hq_lobby", 2, 2, 10, 42, DOWNTOWN, brand="google", opts=hq("google", "google")),
        _e("hq_lobby", 2, 2, 11, 43, DOWNTOWN, brand="openai", opts=hq("openai")),
        _e("hq_lobby", 2, 1, 9, 44, DOWNTOWN, brand="meta", opts=hq("meta", "meta")),
        _e("hq_lobby", 2, 1, 8, 45, DOWNTOWN, brand="goldman-sachs", opts=hq(None, "goldman")),
        # A neighborhood scoop shop.
        _e("storefront", 2, 1, 2, 32, MIDTOWN, brand="jenis", opts=shop("jenis", "jenis")),
        # SoMa: rooftop bulletins on old brick lofts, and two freeway V boards.
        _e("brick_loft", 2, 1, 4, 51, MIDTOWN, board("elevenlabs"), brand="elevenlabs"),
        _e("brick_loft", 2, 1, 3, 52, MIDTOWN, board("capital-one"), brand="capital-one"),
        _e("brick_loft", 1, 2, 4, 53, MIDTOWN, board("persona", face="+X"), brand="persona"),
        _e("brick_loft", 1, 1, 3, 54, MIDTOWN, board("nordvpn"), brand="nordvpn"),
        _e("brick_loft", 2, 1, 5, 55, MIDTOWN, board("anthropic"), brand="anthropic"),
        _e("monopole", 1, 1, 1, 56, MIDTOWN, brand="lovable-openai", opts={"a": "bb-lovable.png", "b": "bb-openai.png"}, fill=False, pad=20),
        _e("monopole", 1, 1, 1, 57, MIDTOWN, brand="anthropic-elevenlabs", opts={"a": "bb-anthropic.png", "b": "bb-elevenlabs.png"}, fill=False, pad=20),
        # Painted walls: the real Levi's ghost sign, and murals for sponsors that suit a wall.
        _e("brick_loft", 1, 2, 5, 61, MIDTOWN, brand="levis", opts=mural("levis-ghost", 1000 / 700)),
        _e("brick_loft", 1, 2, 4, 62, MIDTOWN, brand="mlh", opts=mural("mlh")),
        _e("brick_loft", 1, 1, 4, 63, MIDTOWN, brand="notability", opts=mural("notability")),
        _e("brick_loft", 1, 2, 3, 64, MIDTOWN, brand="bobatalks", opts=mural("bobatalks")),
        # Muni shelters with backlit panels; the game places them beside streets.
        *[_e("shelter", 1, 1, 1, 70 + i, MIXED, sid=f"shelter-{b}-{s}", entry_kind="prop", prop="shelter", side=s, fill=False,
             unique=False, brand=b, opts={"image": f"sh-{b}.png", "side": s})
          for i, (b, s) in enumerate((b, s) for b in ("persona", "nordvpn", "elevenlabs") for s in ("sy", "sx"))],
        # Generic buildings.
        _e("glass_tower", 2, 2, 16, 11, DOWNTOWN),
        _e("glass_tower", 2, 2, 13, 12, DOWNTOWN),
        _e("glass_tower", 2, 2, 14, 1, DOWNTOWN),
        _e("glass_tower", 2, 2, 10, 2, DOWNTOWN),
        _e("glass_tower", 1, 1, 12, 3, DOWNTOWN),
        _e("glass_tower", 1, 1, 8, 4, DOWNTOWN),
        _e("glass_tower", 2, 1, 11, 5, DOWNTOWN),
        _e("glass_tower", 1, 2, 9, 6, DOWNTOWN),
        _e("concrete_office", 2, 2, 7, 7, MIXED),
        _e("concrete_office", 2, 1, 6, 8, MIXED),
        _e("concrete_office", 1, 2, 6, 9, MIXED),
        _e("concrete_office", 1, 1, 5, 10, MIXED),
        _e("brick_loft", 1, 1, 3, 14, MIXED),
        _e("brick_loft", 1, 1, 4, 15, MIXED),
        _e("brick_loft", 2, 1, 4, 16, MIXED),
        _e("brick_loft", 1, 2, 4, 17, MIXED),
    ],
}
