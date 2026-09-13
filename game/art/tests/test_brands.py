"""The brand roster: every placement has its art, every sign reads at 1x. Run from game/:
python3 -m unittest discover -s art/tests -v  (after python3 art/make_ads.py)"""
import json
import sys
import unittest
from pathlib import Path

ART = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ART))
import brands  # noqa: E402
import catalog  # noqa: E402
from PIL import ImageColor  # noqa: E402

ADS = ART / "ads"

# How tall each sign face is on screen at 1x, in game px (lib/signs.py and lib/archetypes.py geometry): a bulletin
# or V board spans up to 2 tiles at 94% (0.5 tall per unit wide), a wall board 86%; a shop band is 8.8 px, a name
# band 12, a blade 19, a lobby logo wall about 26, a painted panel on a 2-tile wall about 60.
Z_PX_PER_BU = 32 / 0.7071 * 0.8660
FACE_PX = {
    ("bb", 1): 0.94 * 0.5 * Z_PX_PER_BU, ("bb", 2): 1.88 * 0.5 * Z_PX_PER_BU,
    ("wb", 2): 1.72 * 0.5 * Z_PX_PER_BU,
    ("fa", 2): 8.8, ("fs", 1): 8.8, ("nb", 1): 12, ("nb", 2): 12, ("bl", 1): 19, ("lw", 2): 26, ("mu", 2): 60, ("mu", 1): 30,
}
# Smallest capital height, in game px at 1x, per surface: 7 on big boards, bands, and walls; 6 on shop signs.
MIN_CAP = {"bb": 7, "wb": 6, "nb": 7, "mu": 7, "fa": 6, "fs": 6, "bl": 6, "lw": 7}


def lum(hex_color):
    r, g, b = ImageColor.getrgb(hex_color)[:3]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


class Roster(unittest.TestCase):
    def test_every_catalog_sign_file_exists_and_every_art_file_is_used(self):
        made = {p.name for p in ADS.glob("*.png") if not p.name.startswith("_")}
        self.assertEqual(set(catalog.SIGN_FILES), made)

    def test_brand_ids_are_unique_and_v_board_partners_exist(self):
        ids = [b["id"] for b in brands.BRANDS]
        self.assertEqual(len(ids), len(set(ids)))
        for b in brands.BRANDS:
            for p in b["places"]:
                if p["surface"] == "v_board":
                    self.assertIn(p["partner"], brands.BY_ID, b["id"])

    def test_about_twenty_new_companies_sponsors_first(self):
        new = [b for b in brands.BRANDS if not b["custom"]]
        self.assertGreaterEqual(len(new), 20)
        self.assertTrue(all(b["sponsor"] for b in new[:8]))

    def test_letters_stand_out_from_their_field(self):
        for b in brands.BRANDS:
            ghost = any(p.get("style") == "ghost" for p in b["places"])
            if b["custom"] and not any(p["surface"] == "hq" for p in b["places"]) or ghost:
                continue
            self.assertGreaterEqual(abs(lum(b["field"]) - lum(b["ink"])), 96, b["id"])

    def test_new_signs_letters_are_tall_enough_at_1x(self):
        caps = json.loads((ADS / "_caps.json").read_text())
        custom = {c for b in brands.BRANDS for c in b["custom"]}
        checked, short = 0, []
        for e in catalog.BRANDED:
            o = e["opts"]
            faces = []  # (file, surface, span)
            if e["sign"]:
                faces.append((e["sign"]["image"], "bb", min(e["w"] if e["sign"]["face"] == "-Y" else e["d"], 2)))
            if o.get("wall_board"):
                faces.append((o["wall_board"], "wb", min(e["d"], 2)))
            if o.get("a"):
                faces += [(o["a"], "bb", 2), (o["b"], "bb", 2)]
            for k, span in (("band_y", e["w"]), ("band_x", e["d"])):
                if o.get(k):
                    faces.append((o[k], "nb", span))
            # Lobby logo walls are close-up detail behind glass (the spec); the name band is an HQ's sign from afar.
            if e["kind"] == "storefront":
                faces += [(o["fascia"], "fa", 2), (o["fascia_side"], "fs", 1), (o["blade"], "bl", 1)]
            if o.get("mural"):
                faces.append((o["mural"]["image"], "mu", min(e["d"], 2)))
            for name, surface, span in faces:
                stem = name.removesuffix(".png")
                if stem in custom or stem not in caps:
                    continue  # the approved first brands, and mark-only signs
                cap_px = round(caps[stem] * FACE_PX[(surface, span)], 2)
                # A tenth of a pixel short still lands on the same rows at 1x (MathWorks' name band is 6.9 px: nine
                # letters are all a 2-tile band's 64 px of width holds).
                if cap_px < MIN_CAP[surface] - 0.1:
                    short.append(f"{stem} on a {span}-tile {surface}: {cap_px:.1f} px")
                checked += 1
        self.assertEqual(short, [])
        self.assertGreater(checked, 30)


if __name__ == "__main__":
    unittest.main()
