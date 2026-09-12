#!/usr/bin/env python3
"""Upscale the official card art for the Card Shop.

Issuers publish most card art at 250-480 px wide, which looks soft in a tile on
a retina screen. This crops each official image to the card itself (dropping
drop shadows and white corner fringes), upscales it 4x with Real-ESRGAN
(RealESRGAN_x4plus, https://github.com/xinntao/Real-ESRGAN) on the GPU, and
saves a 1200 px WebP. Alpha is resized separately with Lanczos so rounded
corners stay clean. Originals move to art/original/ and the manifest records
both files, so nothing official is lost.

Setup (once, from the repo root; the weights are 67 MB and gitignored):
  pip install -r requirements.txt
  mkdir -p research/data/cards/models
  curl -fL -o research/data/cards/models/RealESRGAN_x4plus.pth \\
    https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth
Run:
  python3 research/data/cards/upscale_art.py
then rerun build_cards.py so the game picks up the new files.
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from spandrel import ModelLoader

ART = Path(__file__).resolve().parents[3] / "game" / "public" / "cards" / "art"
TARGET_WIDTH = 1200
CARD_ASPECT = 1.586  # ISO/IEC 7810 ID-1


def card_bounds(img: Image.Image) -> tuple[int, int, int, int]:
    """Bounding box of the card: opaque pixels that aren't near-white page background."""
    a = np.asarray(img.convert("RGBA")).astype(np.int16)
    alpha = a[..., 3] > 200
    not_white = (a[..., :3].min(axis=2) < 235)
    mask = alpha & not_white
    # Rows and columns where a real share of pixels belong to the card.
    rows = np.where(mask.mean(axis=1) > 0.35)[0]
    cols = np.where(mask.mean(axis=0) > 0.35)[0]
    if len(rows) < 10 or len(cols) < 10:
        return (0, 0, img.width, img.height)
    return (int(cols[0]), int(rows[0]), int(cols[-1]) + 1, int(rows[-1]) + 1)


def rounded_alpha(w: int, h: int) -> Image.Image:
    """Card-shaped alpha (corner radius about 3.2% of the width, like a real card)."""
    scale = 4
    big = Image.new("L", (w * scale, h * scale), 0)
    from PIL import ImageDraw

    ImageDraw.Draw(big).rounded_rectangle((0, 0, w * scale - 1, h * scale - 1), radius=int(w * scale * 0.032), fill=255)
    return big.resize((w, h), Image.LANCZOS)


def upscale(model, device: str, rgb: Image.Image) -> Image.Image:
    x = torch.from_numpy(np.asarray(rgb, dtype=np.float32) / 255.0).permute(2, 0, 1).unsqueeze(0).to(device)
    with torch.no_grad():
        y = model(x).clamp(0, 1)
    out = (y.squeeze(0).permute(1, 2, 0).cpu().numpy() * 255.0).round().astype(np.uint8)
    return Image.fromarray(out, "RGB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", default=str(Path(__file__).resolve().parent / "models" / "RealESRGAN_x4plus.pth"))
    ap.add_argument("--min-width", type=int, default=1000, help="upscale images narrower than this")
    args = ap.parse_args()

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model = ModelLoader().load_from_file(args.weights).eval().to(device)
    manifest_path = ART / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    (ART / "original").mkdir(exist_ok=True)

    for m in manifest:
        # Always work from the official file (moved to original/ on the first run).
        orig_name = m.get("originalFile") or m["file"]
        orig = ART / "original" / orig_name
        if not orig.exists():
            shutil.move(ART / m["file"], orig)
        src = Image.open(orig).convert("RGBA")
        box = card_bounds(src)
        card = src.crop(box)
        # Trim to the card aspect ratio around the center (the crop can keep a sliver of shadow).
        w, h = card.size
        if w / h > CARD_ASPECT + 0.02:
            nw = round(h * CARD_ASPECT)
            card = card.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
        elif w / h < CARD_ASPECT - 0.02:
            nh = round(w / CARD_ASPECT)
            card = card.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))

        if card.width < args.min_width:
            big = upscale(model, device, card.convert("RGB"))
            how = "Real-ESRGAN x4plus"
        else:
            big = card.convert("RGB")
            how = None
        th = round(TARGET_WIDTH / CARD_ASPECT)
        out = big.resize((TARGET_WIDTH, th), Image.LANCZOS).convert("RGBA")
        out.putalpha(rounded_alpha(TARGET_WIDTH, th))
        name = f"{m['slug']}.webp"
        out.save(ART / name, "WEBP", quality=90, method=6)

        m["originalFile"] = orig_name
        m["originalWidth"], m["originalHeight"] = src.size
        m["file"] = name
        m["width"], m["height"] = out.size
        if how:
            m["upscaled"] = f"{how} from the official {card.width}x{card.height} art"
        else:
            m.pop("upscaled", None)
        print(f"{m['slug']:<30} {src.size[0]}x{src.size[1]} -> crop {card.width}x{card.height} -> {out.size[0]}x{out.size[1]} {'(' + how + ')' if how else ''}")

    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
