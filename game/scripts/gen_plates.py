"""Generate background plates with ChatGPT Images 2.0 through the Codex CLI.

Codex uses the ChatGPT login (no API key), so anyone on the team with a
ChatGPT plan can run this. Each city gets 4 plates:

  day       generated from the text prompt (the master)
  golden    an edit of day.png
  night     an edit of day.png
  overcast  an edit of day.png

Usage:
  python3 scripts/gen_plates.py houston                 # all 4 plates
  python3 scripts/gen_plates.py houston --only night    # just one
  python3 scripts/gen_plates.py --all --jobs 4          # every city and template
  python3 scripts/gen_plates.py miami --force           # regenerate existing

Output: public/cities/<id>/plates/<plate>.jpg for the game; the full-size
<plate>.png (the edit reference) and Codex logs go to plates-src/<id>/,
which is kept out of the web build.
"""

import argparse
import concurrent.futures as cf
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PROMPTS = json.loads((ROOT / "scripts" / "plate-prompts.json").read_text())
EDITS = ("golden", "night", "overcast")


def plate_dir(city: str) -> pathlib.Path:
    """Where the game loads plates from: small JPEGs only, since public/ ships."""
    d = ROOT / "public" / "cities" / city / "plates"
    d.mkdir(parents=True, exist_ok=True)
    return d


def source_dir(city: str) -> pathlib.Path:
    """Full-size PNGs (edit references) and Codex logs, kept out of the build."""
    d = ROOT / "plates-src" / city
    d.mkdir(parents=True, exist_ok=True)
    return d


def run_codex(city: str, plate: str, prompt: str, ref: pathlib.Path | None) -> bool:
    out_dir = source_dir(city)
    instruction = (
        "Use your image generation tool to create exactly ONE landscape image, as wide as the tool allows "
        f"(16:9 if possible). Do not write code. Copy the generated file to ./{plate}.png in the current "
        "directory, then print its pixel size. Image prompt: " + prompt
    )
    cmd = ["codex", "exec", "--skip-git-repo-check", "-s", "workspace-write", "-C", str(out_dir), instruction]
    # -i takes several files, so it must come after the prompt or it swallows it.
    if ref is not None:
        cmd += ["-i", str(ref)]
    log = out_dir / f"codex-{plate}.log"
    with log.open("w") as fh:
        try:
            result = subprocess.run(cmd, stdout=fh, stderr=subprocess.STDOUT, timeout=900)
        except subprocess.TimeoutExpired:
            print(f"  TIMEOUT {city}/{plate} after 15 min; rerun to retry", flush=True)
            return False
    png = out_dir / f"{plate}.png"
    if result.returncode != 0 or not png.exists():
        print(f"  FAILED {city}/{plate} (see {log})", flush=True)
        return False
    # Plates are opaque, so JPEG keeps them small for the web build.
    jpg = plate_dir(city) / f"{plate}.jpg"
    subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "82", str(png), "--out", str(jpg)],
                   capture_output=True, check=True)
    print(f"  ok {city}/{plate}", flush=True)
    return True


def gen_city(city: str, only: set[str] | None, force: bool) -> None:
    spec = PROMPTS["cities"][city]
    src = source_dir(city)
    wanted = [p for p in ("day",) + EDITS if only is None or p in only]
    if "day" in wanted and (force or not (src / "day.png").exists()):
        master = PROMPTS["master"].format(CITY=spec["city"], BACKDROP=spec["backdrop"],
                                          SKYLINE=spec["skyline"], FOREGROUND=spec["foreground"])
        if not run_codex(city, "day", master, None):
            return
    elif "day" in wanted and not (plate_dir(city) / "day.jpg").exists():
        subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "82", str(src / "day.png"),
                        "--out", str(plate_dir(city) / "day.jpg")], capture_output=True, check=True)
    ref = src / "day.png"
    edits = [p for p in EDITS if p in wanted and (force or not (src / f"{p}.png").exists())]
    # The three edits only depend on the master, so run them side by side.
    with cf.ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(lambda p: run_codex(city, p, PROMPTS["edits"][p], ref), edits))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("cities", nargs="*")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--only", help="comma-separated plates: day,golden,night,overcast")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--jobs", type=int, default=2, help="cities generated at once")
    args = ap.parse_args()
    cities = list(PROMPTS["cities"]) if args.all else args.cities
    unknown = [c for c in cities if c not in PROMPTS["cities"]]
    if not cities or unknown:
        sys.exit(f"pick cities from: {', '.join(PROMPTS['cities'])}")
    only = set(args.only.split(",")) if args.only else None
    with cf.ThreadPoolExecutor(max_workers=args.jobs) as pool:
        list(pool.map(lambda c: gen_city(c, only, args.force), cities))


if __name__ == "__main__":
    main()
