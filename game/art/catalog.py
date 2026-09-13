"""Which sprites each city gets.

Branded entries come from the roster in brands.py and are unique: the game places each once per city, before any
generic building, on a lot in its area or the inner part of its zone when one fits, otherwise on another lot in
the zone (lots.ts), so a small city never repeats a mural or campaign. Following SF's sign rules (no rooftop signs
downtown), towers carry no brand names on their tops: brands live at street level, on HQ name bands and lobby
walls, on wall boards on low buildings, on billboards atop older low buildings outside downtown, and on V boards
beside the freeway.
"""
from brands import BRANDS, BY_ID

DOWNTOWN, MIDTOWN, MIXED = ["downtown"], ["midtown"], ["downtown", "midtown"]
KINDS = {"glass_tower": "glass", "brick_loft": "loft", "concrete_office": "office", "storefront": "shop",
         "hq_lobby": "hq", "monopole": "pole", "shelter": "shelter", "salesforce_tower": "lm", "ferry_building": "lm"}


def _e(kind, w, d, floors, seed, zones, sign=None, brand=None, opts=None, unique=None, sid=None,
       entry_kind=None, landmark=None, prop=None, side=None, fill=True, crown=False, pad=0,
       facing=None, style=None, walls=False, tier=None, area=None):
    if sid is None:
        sid = f"{KINDS[kind]}-{w}x{d}-f{floors}-" + (brand or str(seed))
    return {
        "id": sid, "kind": kind, "w": w, "d": d, "floors": floors, "seed": seed, "zones": zones, "sign": sign,
        "brand": brand, "unique": (brand is not None) if unique is None else unique, "opts": opts or {},
        "entry_kind": entry_kind, "landmark": landmark, "prop": prop, "side": side, "fill": fill, "crown": crown, "pad": pad,
        "facing": facing, "style": style, "walls": walls, "tier": tier, "area": area,
    }


def board(image, face="-Y"):
    return {"type": "bulletin", "image": f"bb-{image}.png", "face": face}


def mural(image, aspect=1.0):
    return {"mural": {"image": f"mu-{image}.png", "aspect": aspect}}


def sign_brand(name):
    """The brand a sign file is for: its name without the kind prefix and extension ("fa-jenis.png" is "jenis")."""
    return name.split("-", 1)[1].removesuffix(".png")


def shop(brand, facade="brick", atm=False):
    """A storefront's options. Its wide band (fa-, 8:1, for a 2-tile face), short band (fs-, 4:1, for a 1-tile
    face), and blade (bl-) are all named from the one brand, so no storefront can mix two brands' signs."""
    return {"facade": facade, "fascia": f"fa-{brand}.png", "fascia_side": f"fs-{brand}.png", "blade": f"bl-{brand}.png",
            "atm": atm}


def storefront(w, d, floors, seed, zones, brand, area=None, **opts):
    """A branded storefront: the entry's brand and its signs come from the same name."""
    return _e("storefront", w, d, floors, seed, zones, brand=brand, opts=shop(brand, **opts), area=area)


# A name band is 12 game px tall over an HQ's lobby and spans 92% of its face, so its art's aspect follows the
# face: 3:1 on a 1-tile face, 6:1 on a 2-tile face. The file is nb-<brand>-<span>.png.
BAND_ASPECT = {1: 3, 2: 6}


def band(brand, span):
    return f"nb-{brand}-{span}.png"


def hq(brand, w, d, logo=True, monument=False):
    return {"logo": f"lw-{brand}.png" if logo else None, "monument": f"mo-{brand}.png" if monument else None,
            "band_y": band(brand, w), "band_x": band(brand, d)}


def branded(b):
    """Every catalog entry for one roster brand."""
    out = []
    for p in b["places"]:
        s, art = p["surface"], p.get("art") or b["id"]
        if s == "bulletin":
            out.append(_e("brick_loft", p["w"], p["d"], p["floors"], p["seed"], p["zones"], board(art, p["face"]),
                          brand=art, area=p["area"]))
        elif s == "wall_board":
            out.append(_e(p["host"], p["w"], p["d"], p["floors"], p["seed"], p["zones"], brand=art, area=p["area"],
                          opts={"wall_board": f"bb-{art}.png"}))
        elif s == "mural":
            out.append(_e("brick_loft", p["w"], p["d"], p["floors"], p["seed"], p["zones"], brand=b["id"],
                          opts=mural(art, p["aspect"]), area=p["area"]))
        elif s == "shop":
            out.append(storefront(p["w"], p["d"], p["floors"], p["seed"], p["zones"], art, area=p["area"],
                                  facade=p["facade"], atm=p["atm"]))
        elif s == "hq":
            out.append(_e("hq_lobby", p["w"], p["d"], p["floors"], p["seed"], p["zones"], brand=art, area=p["area"],
                          opts=hq(art, p["w"], p["d"], p["logo"], p["monument"])))
        elif s == "v_board":
            partner = BY_ID[p["partner"]]["id"]
            out.append(_e("monopole", 1, 1, 1, p["seed"], p["zones"], brand=f"{art}-{partner}", entry_kind="prop",
                          prop="vboard", fill=False, pad=20, opts={"a": f"bb-{art}.png", "b": f"bb-{partner}.png"}))
        elif s == "shelter":
            out.extend(_e("shelter", 1, 1, 1, 70, MIXED, sid=f"shelter-{art}-{side}", entry_kind="prop", prop="shelter",
                          side=side, fill=False, unique=False, brand=art, opts={"image": f"sh-{art}.png", "side": side})
                       for side in ("sy", "sx"))
        else:
            raise ValueError(f"{b['id']}: unknown surface {s}")
    return out


def sign_files(entries):
    """Every sign image the entries name, in order, without repeats."""
    names = []
    for e in entries:
        o = e["opts"]
        names += [e["sign"]["image"]] if e["sign"] else []
        names += [o[k] for k in ("fascia", "fascia_side", "blade", "logo", "monument", "band_y", "band_x", "wall_board",
                                 "a", "b", "image") if o.get(k)]
        names += [o["mural"]["image"]] if o.get("mural") else []
    return list(dict.fromkeys(names))


BRANDED = [e for b in BRANDS for e in branded(b)]

CATALOG = {
    "san-francisco": [
        # Landmarks the game draws in place of their procedural models.
        _e("salesforce_tower", 2, 2, 22, 21, DOWNTOWN, sid="salesforce-tower", entry_kind="landmark", landmark="sf-glass-tower", fill=False, crown=True),
        _e("ferry_building", 4, 1, 3, 22, DOWNTOWN, sid="ferry-building", entry_kind="landmark", landmark="sf-ferry-building"),
        # Every roster brand: HQs, shops, bulletins, wall boards, painted walls, V boards, and shelters.
        *BRANDED,
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

# The sign art make_ads.py draws: every file a branded entry names, with the brand and the surface it is for.
SIGN_FILES = sign_files(BRANDED) + ["fe-port-of-sf.png"]


RESIDENTIAL = ["residential"]
FACINGS = ("s", "e", "n", "w")


def _house(kind, style, variant, w, d, floors, seed, **opts):
    """One house model in all four facings; the game tints its walls from the city palette."""
    return [_e(kind, w, d, floors, seed, RESIDENTIAL, sid=f"{style}-{variant}-{w}x{d}-{f}", opts={"variant": variant, **opts},
               unique=False, facing=f, style=style, walls=True) for f in FACINGS]


# 16 models: every style has a 2-floor model, so lots under a landmark's sightline cap still get a house.
HOUSES = [
    *_house("victorian", "victorian", "italianate", 1, 1, 2, 101),
    *_house("victorian", "victorian", "stick", 1, 1, 3, 102, garage=True),
    *_house("victorian", "victorian", "queen_anne", 1, 1, 3, 103),
    *_house("edwardian", "edwardian", "single", 1, 1, 2, 111),
    *_house("edwardian", "edwardian", "double", 1, 1, 3, 112),
    *_house("stucco_row", "stucco", 0, 1, 1, 2, 121),
    *_house("stucco_row", "stucco", 1, 1, 1, 2, 122),
    *_house("stucco_row", "stucco", 2, 1, 1, 2, 123),
    *_house("stucco_row", "stucco", 3, 1, 1, 2, 124),
    *_house("suburban", "suburban", "ranch", 1, 1, 1, 131),
    *_house("suburban", "suburban", "split", 1, 1, 2, 132),
    *_house("suburban", "suburban", "colonial", 1, 1, 2, 133),
    *_house("suburban", "suburban", "craftsman", 1, 1, 1, 134),
    *_house("walkup", "walkup", 0, 1, 1, 4, 141),
    *_house("walkup", "walkup", 1, 1, 1, 3, 142),
    *_house("walkup", "walkup", 2, 2, 1, 4, 143),
]

CATALOG["san-francisco"].extend(HOUSES)

# The player's home tiers, shared by every city (public/sprites/common/home/).
HOME_KINDS = ["home_tent", "home_studio", "home_bungalow", "home_townhouse", "home_colonial", "home_villa"]
HOME_FLOORS = [1, 4, 1, 3, 2, 2]
CATALOG["common/home"] = [
    _e(kind, 1, 1, HOME_FLOORS[t], 200 + t, ["home"], sid=f"home-{t}-{f}", entry_kind="home", tier=t, facing=f, unique=False)
    for t, kind in enumerate(HOME_KINDS) for f in FACINGS
]


CATALOG["common/property"] = [
    _e("property_sign", 1, 1, 0, 300, [], sid=f"{label.lower()}-{f}", entry_kind="prop", fill=False,
       facing=f, unique=False, opts={"label": label})
    for label in ("SALE", "RENT") for f in FACINGS
]
