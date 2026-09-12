"""Contact sheet layout tests. Run from game/:  python3 -m unittest discover -s art/tests -v"""
import sys
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import contact as C  # noqa: E402

G = C.GAP


def placed(pages):
    """Each page's cells as {index: (x, y)}."""
    return [{i: (x, y) for i, x, y in cells} for cells, _, _ in pages]


class Layout(unittest.TestCase):
    def test_a_row_wraps_at_the_width_limit(self):
        pages = C.layout([(30, 10)] * 3, max_w=100, max_h=1000)
        self.assertEqual(placed(pages), [{0: (G, G), 1: (G + 30 + G, G), 2: (G, G + 10 + G)}])

    def test_a_page_breaks_past_the_height_limit(self):
        pages = C.layout([(70, 30)] * 3, max_w=100, max_h=100)  # one cell per row; two rows fill a page
        self.assertEqual([sorted(p) for p in placed(pages)], [[0, 1], [2]])
        self.assertEqual(placed(pages)[1][2], (G, G))
        self.assertTrue(all(h <= 100 and w <= 100 for _, w, h in pages))

    def test_an_oversized_cell_gets_its_own_row_and_page(self):
        pages = C.layout([(30, 10), (500, 500), (30, 10)], max_w=100, max_h=100)
        self.assertEqual([sorted(p) for p in placed(pages)], [[0], [1], [2]])
        self.assertEqual(pages[1][1:], (G + 500 + G, G + 500 + G))

    def test_a_cell_is_at_least_as_wide_as_its_label(self):
        label = "a-very-long-sprite-id-" * 4
        w, _ = C.cell_size(label, [Image.new("RGBA", (2, 2))])
        self.assertGreaterEqual(w, C.FONT.getlength(label))


if __name__ == "__main__":
    unittest.main()
