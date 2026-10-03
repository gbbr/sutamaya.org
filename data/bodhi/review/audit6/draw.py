"""Draws fresh SN, AN and KN texts with roughly equal audit-line budgets."""
import json
import random
import re
from pathlib import Path

SEED = 20261006
TARGET_LINES = 2500
TRANSLATOR = Path(__file__).resolve().parents[2].name
ROOT = Path(__file__).resolve().parents[4]
COLLECTIONS = ("sn", "an", "kn")


def words(text):
    return re.sub(r"<[^>]+>", "", text).strip()


def draw():
    """Returns whole texts not drawn in earlier audits, counted as read --every counts them."""
    review = ROOT / "data" / TRANSLATOR / "review"
    excluded = set()
    for folder in review.glob("audit*"):
        number = re.fullmatch(r"audit(\d+)", folder.name)
        if folder.name != "audit" and (not number or int(number.group(1)) >= 6):
            continue
        for batch in sorted(folder.glob("batch-*.txt")):
            with batch.open() as source:
                excluded.update(
                    line[3:].split(",")[0].strip()
                    for line in source
                    if line.startswith("## ")
                )

    pools = {collection: {} for collection in COLLECTIONS}
    base = ROOT / "data" / TRANSLATOR / "sutta"
    for path in sorted(base.rglob("*.json")):
        relative = path.relative_to(base)
        collection = relative.parts[0]
        if collection not in pools:
            continue
        with path.open() as source:
            translated = json.load(source)
        pali_path = ROOT / "data" / "pali" / "sutta" / str(relative).replace(
            f"_translation-en-{TRANSLATOR}.json", "_root-pli-ms.json"
        )
        sujato_path = ROOT / "data" / "sujato" / "sutta" / str(relative).replace(
            f"-en-{TRANSLATOR}.json", "-en-sujato.json"
        )
        with pali_path.open() as source:
            pali = json.load(source)
        sujato = {}
        if sujato_path.exists():
            with sujato_path.open() as source:
                sujato = json.load(source)
        counts, has_translation = {}, set()
        for key, text in translated.items():
            uid, segment = key.split(":")
            if segment.startswith("0.") or uid in excluded:
                continue
            english = words(text)
            if english:
                has_translation.add(uid)
            if english or pali.get(key, "").strip() or sujato.get(key, "").strip():
                counts[uid] = counts.get(uid, 0) + 1
        for uid in has_translation:
            pools[collection][uid] = pools[collection].get(uid, 0) + counts[uid]

    available = {collection: sum(pool.values()) for collection, pool in pools.items()}
    targets = {collection: 0.0 for collection in COLLECTIONS}
    remaining = min(TARGET_LINES, sum(available.values()))
    pending = {collection for collection in COLLECTIONS if available[collection]}
    while pending:
        share = remaining / len(pending)
        capped = {collection for collection in pending if available[collection] <= share}
        if not capped:
            for collection in pending:
                targets[collection] = share
            break
        for collection in capped:
            targets[collection] = available[collection]
            remaining -= available[collection]
        pending -= capped

    rng = random.Random(SEED)
    result = {}
    for collection in COLLECTIONS:
        candidates = sorted(pools[collection])
        rng.shuffle(candidates)
        selected, lines = [], 0
        for uid in candidates:
            if lines >= targets[collection]:
                break
            size = pools[collection][uid]
            if selected and lines + size >= targets[collection]:
                if abs(lines - targets[collection]) <= abs(lines + size - targets[collection]):
                    break
            selected.append(uid)
            lines += size
        result[collection] = {
            "eligible_texts": len(candidates),
            "available_lines": available[collection],
            "target_lines": targets[collection],
            "selected_lines": lines,
            "selected_texts": len(selected),
            "texts": selected,
        }
    return {
        "translator": TRANSLATOR,
        "seed": SEED,
        "target_lines": TARGET_LINES,
        "excluded_texts": len(excluded),
        "denominator": "non-title rows with Pali or either English, in translated texts",
        "selected_lines": sum(item["selected_lines"] for item in result.values()),
        "collections": result,
    }


if __name__ == "__main__":
    print(json.dumps(draw(), ensure_ascii=False, indent=2))
