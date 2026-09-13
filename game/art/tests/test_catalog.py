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

class Houses(unittest.TestCase):
    def test_sixteen_house_models_have_every_facing(self):
        houses = catalog.HOUSES
        self.assertEqual(len(houses), 64)
        self.assertEqual(len({e['id'] for e in houses}), 64)
        groups = {}
        for entry in houses:
            groups.setdefault(entry['id'].rsplit('-', 1)[0], []).append(entry)
            self.assertTrue(entry['walls'])
            self.assertFalse(entry['unique'])
            self.assertEqual(entry['zones'], ['residential'])
        self.assertEqual(len(groups), 16)
        for entries in groups.values():
            self.assertEqual({e['facing'] for e in entries}, {'n', 'e', 's', 'w'})
            self.assertEqual(len({e['seed'] for e in entries}), 1)

    def test_property_boards_have_sale_and_rental_facings(self):
        boards = catalog.CATALOG['common/property']
        self.assertEqual(len(boards), 8)
        self.assertEqual({e['id'] for e in boards}, {f'{label}-{f}' for label in ('sale', 'rent') for f in 'nesw'})
        self.assertTrue(all(e['entry_kind'] == 'prop' and not e['fill'] for e in boards))

    def test_six_home_tiers_have_every_facing(self):
        homes = catalog.CATALOG['common/home']
        self.assertEqual(len(homes), 24)
        for tier in range(6):
            self.assertEqual({e['facing'] for e in homes if e['tier'] == tier}, {'n', 'e', 's', 'w'})
        self.assertTrue(all(e['entry_kind'] == 'home' for e in homes))


if __name__ == "__main__":
    unittest.main()
