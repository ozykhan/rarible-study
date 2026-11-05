"""
Generates the card art, set banners and hero background in public/art.

Every image is made locally on CPU with LCM Dreamshaper v7
(https://huggingface.co/SimianLuo/LCM_Dreamshaper_v7, MIT license) in four
steps. The prompts describe the fictional creatures in packages/seed; nothing
is copied from a real card game.

    python3 -m venv .venv && .venv/bin/pip install torch diffusers transformers accelerate safetensors pillow
    .venv/bin/python apps/web/scripts/generate_art.py [--only EF-001,hero]

A fixed seed per image keeps a rerun close to the committed files.
"""

import argparse
import hashlib
import os
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "public" / "art"
MODEL = os.environ.get("ART_MODEL", "SimianLuo/LCM_Dreamshaper_v7")

SET_STYLE = {
    "OS": "lush green meadow and old forest, golden afternoon light, storybook fantasy painting",
    "TW": "underwater coral reef and moonlit lagoon, teal and turquoise water, glowing bioluminescence",
    "EF": "volcanic landscape, glowing lava rivers, drifting embers and ash, orange and crimson light",
    "SE": "deep space nebula with stars and small planets, violet and blue cosmic light",
}

# (id, name, lore) mirrors packages/seed/src/catalog.ts.
CARDS = [
    ("OS-001", "Cinderwing Drake", "a small fierce red dragon with ember wings shedding sparks as it dives"),
    ("OS-002", "Mossback Tortoise", "a pond tortoise with a garden growing on its shell"),
    ("OS-003", "Gale Sprite", "a small round wind creature made of swirling air and leaves with two glowing eyes, no people"),
    ("OS-004", "Thornmane Lion", "a lion with a mane of bramble and thorns"),
    ("OS-005", "Ironhide Golem", "a hulking mossy stone golem monster patched with rusted iron plates"),
    ("OS-006", "Duskhollow Owl", "an owl hunting in the last minute of sunset"),
    ("OS-007", "Frostpetal Fox", "a white fox whose tail leaves frost flowers in the snow"),
    ("OS-008", "Emberkit", "a tiny fire kitten napping on warm stones"),
    ("OS-009", "Lumen Moth", "a glowing moth shining in the dark night"),
    ("OS-010", "Verdant Wyrmling", "a leaf-scaled baby dragon rooted in moss"),
    ("TW-001", "Glimmerfin", "a glowing goldfish-like reef fish with long flowing fins, close-up, side view"),
    ("TW-002", "Reefguard Crab", "a crab guarding coral with oversized claws"),
    ("TW-003", "Abyssal Leviathan", "a huge sea serpent dragon with a long scaly body, fanged jaws and glowing eyes, in the dark deep ocean"),
    ("TW-004", "Kelpie Foal", "a young water horse with a mane of kelp"),
    ("TW-005", "Stormcaller Heron", "a heron calling thunder over a stormy marsh"),
    ("TW-006", "Coralbloom", "a flowering coral opening at high tide"),
    ("TW-007", "Tidewyrm", "a blue-scaled sea dragon with fins swimming up toward the surface"),
    ("TW-008", "Shellback Hermit", "a cute hermit crab in a big spiral shell decorated with bottle caps, on the sandy sea floor"),
    ("TW-009", "Driftwood Sprite", "a cute little creature with a body of driftwood, seaweed hair and two big glowing eyes"),
    ("TW-010", "Pearl Otter", "a playful otter juggling pearls on its belly"),
    ("EF-001", "Ashen Wyrm", "an ancient grey dragon sleeping under cooled lava"),
    ("EF-002", "Magma Hound", "a lean wolf-like hound with molten glowing paws leaving burning tracks"),
    ("EF-003", "Cinder Salamander", "a salamander bathing in campfire embers"),
    ("EF-004", "Obsidian Golem", "a golem of black volcanic glass with a hollow glowing chest"),
    ("EF-005", "Pyre Phoenix", "a phoenix of fire reborn from a single spark"),
    ("EF-006", "Smoke Wisp", "a small ghost made of curling grey smoke with two glowing ember eyes, floating over embers"),
    ("EF-007", "Basalt Ram", "a ram whose horns are columns of basalt rock"),
    ("EF-008", "Flare Drakeling", "a small red dragon sneezing little flares"),
    ("EF-009", "Charcoal Beetle", "a black beetle rolling a ball of glowing charcoal"),
    ("EF-010", "Lava Eel", "a long glowing eel-like serpent creature with fins, swimming through a river of lava"),
    ("SE-001", "Nebula Drake", "a dragon with a nebula swirling inside its wings"),
    ("SE-002", "Comet Hare", "a hare leaving a comet tail as it runs"),
    ("SE-003", "Orbit Owl", "an owl circling a glowing moon"),
    ("SE-004", "Void Ray", "a manta ray spirit gliding through space"),
    ("SE-005", "Starlit Unicorn", "a white unicorn whose horn points at a bright star"),
    ("SE-006", "Meteor Golem", "a golem built from a fallen meteorite"),
    ("SE-007", "Aurora Moth", "a large moth with fuzzy body and wide wings rippling like the northern lights"),
    ("SE-008", "Lunar Jellyfish", "a glowing jellyfish spirit drifting between stars"),
    ("SE-009", "Solar Lion", "a lion whose mane burns like the sun's corona"),
    ("SE-010", "Cinderwing Drake", "a small dragon with glowing ember wings flying through a starfield"),
]

# Cards whose name pulls the model the wrong way ("Sprite" draws a girl, "Ironhide" a suit of
# armor). Their prompt is the description alone.
NAME_MISLEADS = {"OS-001", "OS-003", "OS-005", "EF-006", "TW-001", "TW-009", "SE-010"}

QUALITY = "fantasy creature illustration, highly detailed digital painting, vibrant colors, dramatic lighting, centered subject, sharp focus"

BANNERS = {
    "OS": "a wide fantasy landscape, rolling green hills, ancient forest, a small dragon flying far away, golden hour, epic matte painting",
    "TW": "a wide fantasy seascape, glowing coral reef under a moonlit lagoon, sea serpent silhouette, teal light rays, epic matte painting",
    "EF": "a wide fantasy volcanic landscape, rivers of lava, ash clouds, a dragon silhouette on a ridge, crimson glow, epic matte painting",
    "SE": "a wide cosmic vista, colorful nebula, ringed planet, shooting comet, violet and blue light, epic matte painting",
}

HERO = (
    "dark cinematic studio, floating black volcanic rocks, glowing iridescent rainbow light ribbons swirling, "
    "reflections on a wet black floor, moody, high contrast, deep shadows, product photography backdrop"
)


# A reroll for an image that came out wrong: bump its number and generate it again.
REROLL: dict[str, int] = {"EF-006": 1, "TW-001": 1, "TW-009": 1}


def seed_for(key: str) -> int:
    salted = f"{key}:{REROLL[key]}" if key in REROLL else key
    return int(hashlib.sha256(salted.encode()).hexdigest()[:8], 16)


def jobs():
    for cid, name, lore in CARDS:
        subject = lore if cid in NAME_MISLEADS else f"{name}, {lore}"
        prompt = f"{subject}, {SET_STYLE[cid[:2]]}, {QUALITY}"
        yield cid, prompt, (512, 704), OUT / "cards" / f"{cid}.webp", (384, 528)
    for sid, prompt in BANNERS.items():
        yield f"set-{sid}", prompt, (768, 432), OUT / "sets" / f"{sid}.webp", (768, 432)
    yield "hero", HERO, (896, 512), OUT / "hero.webp", (1600, 914)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", default="", help="comma-separated keys, e.g. EF-001,set-OS,hero")
    parser.add_argument("--steps", type=int, default=6)
    args = parser.parse_args()
    only = {k for k in args.only.split(",") if k}

    import torch
    from diffusers import DiffusionPipeline

    torch.set_num_threads(os.cpu_count() or 4)
    pipe = DiffusionPipeline.from_pretrained(MODEL, safety_checker=None, requires_safety_checker=False)
    pipe.to("cpu")
    pipe.set_progress_bar_config(disable=True)

    for key, prompt, (w, h), path, (ow, oh) in jobs():
        if only and key not in only:
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        g = torch.Generator("cpu").manual_seed(seed_for(key))
        image = pipe(prompt, width=w, height=h, num_inference_steps=args.steps, guidance_scale=8.0, generator=g).images[0]
        image = image.resize((ow, oh), resample=1)  # LANCZOS
        image.save(path, "WEBP", quality=82, method=6)
        print(f"{key} -> {path.relative_to(OUT.parent.parent)}", file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()
