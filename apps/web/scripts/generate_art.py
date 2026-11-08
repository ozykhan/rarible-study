#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["mflux==0.24.0", "pillow>=11"]
# ///
"""
Generates the card art and set banners in public/art on an Apple Silicon Mac,
with an open image model run locally through mflux (MLX, MIT license):

- FLUX.2 klein 4B (https://huggingface.co/black-forest-labs/FLUX.2-klein-4B,
  Apache 2.0), the default: 4 steps, about 9 GB of weights at 8 bits, so it
  fits a 16 GB Mac.
- Z-Image Turbo (https://huggingface.co/Tongyi-MAI/Z-Image-Turbo, Apache 2.0),
  for comparison, from a 4-bit copy so it fits in 16 GB too.

The prompts describe the fictional creatures in packages/seed; nothing is
copied from a real card game. Cards and sets are read from the seed package
through Node, so a card is written down once.

    uv run apps/web/scripts/generate_art.py --only FV-001,HR-005 --out /tmp/trial   # try a few, outside the repo
    uv run apps/web/scripts/generate_art.py --model z-image-turbo --only FV-001 --out /tmp/trial-z
    uv run apps/web/scripts/generate_art.py                                         # every image not made yet
    uv run apps/web/scripts/generate_art.py --sheet /tmp/sheet.png --only FV-001,FV-002   # a contact sheet to review

Every image made into public/art is recorded in packages/seed/src/art.json with
its prompt, seed, model and hash. A rerun skips an image whose record matches,
so a run can stop at any point and pick up where it left off. The seed gives
each card its art path from that file, hash included.
"""

import argparse
import hashlib
import json
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
ART = ROOT / "apps" / "web" / "public" / "art"
MANIFEST = ROOT / "packages" / "seed" / "src" / "art.json"
CATALOG = ROOT / "packages" / "seed" / "src" / "catalog.ts"

MODELS = {
    "flux2-klein-4b": {"label": "black-forest-labs/FLUX.2-klein-4B", "steps": 4, "quantize": 8, "path": None},
    "z-image-turbo": {"label": "Tongyi-MAI/Z-Image-Turbo", "steps": 9, "quantize": None, "path": "filipstrand/Z-Image-Turbo-mflux-4bit"},
}

STYLE = (
    "Painted fantasy creature illustration in a rich storybook style: one creature as the clear subject, "
    "centered and fully in frame, soft dramatic lighting, vivid color, detailed painted background. "
    "No text, no letters, no numbers, no logos, no border or card frame, no people."
)

SETTING = {
    "OS": "a lush green meadow at the edge of an old forest in golden afternoon light",
    "TW": "a coral reef under a moonlit lagoon, teal and turquoise water with glowing bioluminescence",
    "EF": "a volcanic landscape with glowing lava rivers, drifting embers and ash, orange and crimson light",
    "SE": "deep space with a colorful nebula, stars and small planets, violet and blue cosmic light",
    "FV": "a frozen glacier field under a green and violet aurora, blue-white snow and ice",
    "HR": "a vast underground cavern of giant glowing mushrooms and ancient roots, blue and magenta glow in the dark",
    "SK": "floating islands above a sea of clouds, waterfalls spilling into the clouds, bright golden sunlight",
    "DS": "wind-carved sand dunes and sandstone ruins under a blazing white sun, warm ochre and gold",
}

# A card's lore is its subject, unless the lore is not something a painter can
# see. Invented names stay out of every prompt: "Sprite" draws a girl and
# "Ironhide" a suit of armor.
SUBJECT = {
    "OS-003": "A small round wind creature made of swirling air and leaves, with two glowing eyes",
    "OS-005": "A hulking construct like a squat statue, its body mossy boulders bolted together with rusted iron plates, a blank helmet-shaped head with two glowing eye slits",
    "TW-001": "One glowing reef fish like a goldfish with long flowing fins, seen from the side",
    "TW-003": "A huge sea serpent with a long scaly body, fanged jaws and glowing eyes, rising from the dark deep ocean",
    "TW-008": "A hermit crab in a big spiral shell decorated with old bottle caps, on the sandy sea floor",
    "TW-009": "A small creature with a body of driftwood, seaweed hair and two big glowing eyes",
    "EF-006": "A small ghost made of curling grey smoke with two glowing ember eyes, floating over embers",
    "EF-010": "A long glowing eel with fins, swimming through a river of lava",
    "SE-004": "A glowing manta ray spirit gliding through space",
    "SE-007": "A large moth with a fuzzy body and wide wings rippling like the northern lights",
    "SE-008": "A glowing jellyfish spirit drifting between the stars",
    "SE-010": "A small dragon with glowing ember wings flying through a starfield",
    "FV-005": "A tiny spirit made of clear icicles with two glowing blue eyes, hovering over the snow",
    "FV-010": "A woolly mammoth with a long trunk and huge curved tusks, shaggy white fur, icicles hanging from its tusks",
    "HR-010": "A giant old mushroom with a gentle sleepy face in its stem, glowing softly",
    "SK-001": "A huge whale made of white cloud, swimming through a sea of clouds with rain falling from its belly",
    "SK-002": "A griffin with the head, wings and front talons of a golden eagle and the body and tail of a lion, wings spread, lightning behind it",
    "SK-005": "A brass machine golem with a round furnace belly, pipes and bellows on its back puffing wind, riveted plates and a blank face of two glowing portholes",
    "SK-006": "A four-winged dragonfly-like insect crackling with blue static electricity",
    "SK-008": "A small wisp of white cloud with a warm lantern glow at its center and two dark eyes",
    "SK-009": "A round fluffy dandelion seed creature with tiny eyes, drifting on the breeze",
    "DS-001": "A long sand-colored dragon bursting up out of a sand dune in a spray of sand, half of its serpent body still under the sand",
    "DS-007": "A round little cactus creature with stubby legs, waddling toward a patch of shade",
    "DS-008": "A shadowy spirit inside a small swirling dust storm, with two glowing eyes",
    "DS-010": "A giant eagle-like roc bird perched on the tallest tower of a ruined desert city",
}

# Old words for a dragon that an image model reads otherwise: a drake is also a
# male duck. A dragon card's lore says "dragon" in the prompt instead.
DRAGON_WORDS = {"drake": "dragon", "drakeling": "baby dragon", "wyrm": "dragon", "wyrmling": "baby dragon"}

BANNER = {
    "OS": "a wide fantasy landscape, rolling green hills, ancient forest, a small dragon flying far away, golden hour",
    "TW": "a wide fantasy seascape, glowing coral reef under a moonlit lagoon, a sea serpent silhouette, teal light rays",
    "EF": "a wide fantasy volcanic landscape, rivers of lava, ash clouds, a dragon silhouette on a ridge, crimson glow",
    "SE": "a wide cosmic vista, colorful nebula, ringed planet, shooting comet, violet and blue light",
    "FV": "a wide fantasy landscape of glaciers and snowfields under a green and violet aurora, a swan silhouette in the sky",
    "HR": "a wide fantasy view of an underground cavern full of giant glowing mushrooms and ancient roots",
    "SK": "a wide fantasy sky with floating islands and waterfalls pouring into a sea of clouds, a griffin silhouette in golden light",
    "DS": "a wide fantasy desert of tall dunes and sandstone ruins under a white sun, a giant bird silhouette far away",
}
BANNER_STYLE = "Epic matte painting, no creatures up close. No text, no letters, no logos, no border."

# A reroll for an image that came out wrong: bump its number and run again.
REROLL: dict[str, int] = {}

CARD_SIZE, CARD_DRAW = (384, 528), (768, 1056)
BANNER_SIZE, BANNER_DRAW = (768, 432), (1024, 576)


@dataclass(frozen=True)
class Job:
    key: str
    prompt: str
    draw: tuple[int, int]
    size: tuple[int, int]
    file: str


def load_catalog() -> dict:
    """The seed package's sets and cards, read through Node (22.6 or later)."""
    code = "const m = await import(process.argv[1]); process.stdout.write(JSON.stringify({ sets: m.sets, cards: m.cards }))"
    out = subprocess.run(
        ["node", "--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", code, CATALOG.as_uri()],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(out.stdout)


def jobs(catalog: dict) -> list[Job]:
    out = []
    for c in catalog["cards"]:
        subject = SUBJECT.get(c["id"], c["lore"].rstrip("."))
        if "dragon" in c["kinds"]:
            subject = re.sub(r"\b(drakeling|drake|wyrmling|wyrm)\b", lambda m: DRAGON_WORDS[m.group(1).lower()], subject, flags=re.I)
        prompt = f"{subject}. Setting: {SETTING[c['setId']]}. {STYLE}"
        out.append(Job(c["id"], prompt, CARD_DRAW, CARD_SIZE, f"cards/{c['id']}.webp"))
    for s in catalog["sets"]:
        out.append(Job(f"set-{s['id']}", f"{BANNER[s['id']]}. {BANNER_STYLE}", BANNER_DRAW, BANNER_SIZE, f"sets/{s['id']}.webp"))
    return out


def seed_for(key: str) -> int:
    salted = f"{key}:{REROLL[key]}" if key in REROLL else key
    return int(hashlib.sha256(salted.encode()).hexdigest()[:8], 16)


def model_label(name: str, quantize: int | None, path: str | None) -> str:
    bits = f"{quantize}-bit" if quantize else ("4-bit copy" if path and "4bit" in path else "bf16")
    return f"{MODELS[name]['label']}, mflux 0.24.0, {bits}"


def load_model(name: str, quantize: int | None, path: str | None, small_text_encoder: bool):
    from mflux.models.common.config import ModelConfig

    if name == "flux2-klein-4b":
        from mflux.models.flux2.variants import Flux2Klein

        return Flux2Klein(
            model_config=ModelConfig.flux2_klein_4b(), quantize=quantize, model_path=path, small_text_encoder=small_text_encoder
        )
    from mflux.models.z_image import ZImage

    return ZImage(model_config=ModelConfig.z_image_turbo(), quantize=quantize, model_path=path)


def contact_sheet(dest: Path, folder: Path, keys: list[Job]) -> None:
    from PIL import Image, ImageDraw

    cell_w, cell_h, label = 192, 264, 22
    cols = 8
    rows = (len(keys) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell_w, rows * (cell_h + label)), "#111")
    draw = ImageDraw.Draw(sheet)
    for i, job in enumerate(keys):
        x, y = (i % cols) * cell_w, (i // cols) * (cell_h + label)
        path = folder / job.file
        if path.exists():
            img = Image.open(path).convert("RGB")
            img.thumbnail((cell_w - 4, cell_h - 4))
            sheet.paste(img, (x + (cell_w - img.width) // 2, y + (cell_h - img.height) // 2))
        draw.text((x + 6, y + cell_h + 4), job.key, fill="#ddd")
    dest.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(dest)
    print(f"sheet -> {dest}", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", default="", help="comma-separated keys, e.g. FV-001,set-FV")
    parser.add_argument("--model", choices=sorted(MODELS), default="flux2-klein-4b")
    parser.add_argument("--quantize", type=int, choices=[3, 4, 5, 6, 8], help="bits; default 8 for FLUX.2 klein")
    parser.add_argument("--model-path", help="a saved or pre-quantized model (local folder or Hugging Face repo)")
    parser.add_argument("--small-text-encoder", action="store_true", help="FLUX.2 klein only: a 0.6B text encoder, less memory")
    parser.add_argument("--steps", type=int)
    parser.add_argument("--out", type=Path, help="write here instead of public/art, and leave art.json alone (for trials)")
    parser.add_argument("--force", action="store_true", help="redo images even when their record matches")
    parser.add_argument("--sheet", type=Path, help="only build a contact sheet of the selected images, then stop")
    args = parser.parse_args()

    only = {k for k in args.only.split(",") if k}
    selected = [j for j in jobs(load_catalog()) if not only or j.key in only]
    if only - {j.key for j in selected}:
        sys.exit(f"unknown keys: {', '.join(sorted(only - {j.key for j in selected}))}")
    folder = args.out or ART
    if args.sheet:
        contact_sheet(args.sheet, folder, selected)
        return

    spec = MODELS[args.model]
    quantize = args.quantize if args.quantize is not None else spec["quantize"]
    path = args.model_path or spec["path"]
    steps = args.steps or spec["steps"]
    label = model_label(args.model, quantize, path)
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}

    def done(job: Job) -> bool:
        if args.force or args.out:
            return False
        rec = manifest.get(job.key)
        f = ART / job.file
        return (
            rec is not None
            and f.exists()
            and rec.get("model") == label
            and rec.get("prompt") == job.prompt
            and rec.get("seed") == seed_for(job.key)
            and rec.get("steps") == steps
            and rec.get("sha256") == hashlib.sha256(f.read_bytes()).hexdigest()
        )

    todo = [j for j in selected if not done(j)]
    print(f"{len(selected) - len(todo)} of {len(selected)} already made with {label}; {len(todo)} to go", file=sys.stderr)
    if not todo:
        return

    start = time.monotonic()
    model = load_model(args.model, quantize, path, args.small_text_encoder)
    print(f"model loaded in {time.monotonic() - start:.0f} s", file=sys.stderr, flush=True)

    times: list[float] = []
    for n, job in enumerate(todo, 1):
        t0 = time.monotonic()
        w, h = job.draw
        result = model.generate_image(seed=seed_for(job.key), prompt=job.prompt, num_inference_steps=steps, width=w, height=h)
        image = result.image.resize(job.size, resample=1)  # LANCZOS
        dest = folder / job.file
        dest.parent.mkdir(parents=True, exist_ok=True)
        image.save(dest, "WEBP", quality=82, method=6)
        if not args.out:
            manifest[job.key] = {
                "file": job.file,
                "sha256": hashlib.sha256(dest.read_bytes()).hexdigest(),
                "model": label,
                "seed": seed_for(job.key),
                "steps": steps,
                "width": w,
                "height": h,
                "prompt": job.prompt,
            }
            # Written after every image, so a stopped run keeps what it made.
            MANIFEST.write_text(json.dumps(dict(sorted(manifest.items())), indent=2) + "\n")
        times.append(time.monotonic() - t0)
        avg = sum(times) / len(times)
        left = avg * (len(todo) - n)
        print(f"[{n}/{len(todo)}] {job.key} {times[-1]:.0f} s (avg {avg:.0f} s, about {left / 60:.0f} min left)", file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()
