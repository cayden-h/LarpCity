"""Catalog rules. Run from game/:  python3 -m unittest discover -s art/tests -v"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import catalog  # noqa: E402


class Storefronts(unittest.TestCase):
    def test_every_storefront_sign_is_its_own_brand(self):
        shops = [e for city in catalog.CATALOG.values() for e in city if e["kind"] == "storefront"]
        self.assertTrue(shops)
        for e in shops:
            names = [e["opts"][k] for k in ("fascia", "fascia_side", "blade") if e["opts"].get(k)]
            self.assertEqual({catalog.sign_brand(n) for n in names}, {e["brand"]}, e["id"])

    def test_sign_brand_strips_the_kind_prefix_and_extension(self):
        self.assertEqual(catalog.sign_brand("fa-capital-one-cafe.png"), "capital-one-cafe")
        self.assertEqual(catalog.sign_brand("bl-jenis.png"), "jenis")

    def test_a_storefront_names_every_sign_from_one_brand(self):
        opts = catalog.shop("wells-fargo", facade="stone", atm=True)
        self.assertEqual((opts["fascia"], opts["fascia_side"], opts["blade"]),
                         ("fa-wells-fargo.png", "fs-wells-fargo.png", "bl-wells-fargo.png"))
        self.assertTrue(opts["atm"])


if __name__ == "__main__":
    unittest.main()
