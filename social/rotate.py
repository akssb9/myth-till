"""Daily Instagram rotation for @myth.studios — one product photo per day.

Every product posts once per cycle before anything repeats. Order lives in
rotation.json so it can be read and edited by hand; products.json holds the
captions and the studio image each product posts with.

    python3 social/rotate.py today              today's item (picks it on first call)
    python3 social/rotate.py show <id>          full product record, caption included
    python3 social/rotate.py set-image <id> <url>
    python3 social/rotate.py posted <id> <post_id>
    python3 social/rotate.py fail <id> <reason>
    python3 social/rotate.py status

Dates are UAE dates (UTC+4, no daylight saving), the day the post goes out in.
"""
import json
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
PRODUCTS = HERE / "products.json"
ROTATION = HERE / "rotation.json"
LOG = HERE / "POSTING-LOG.md"
UAE = timezone(timedelta(hours=4))

EXIT_ALREADY_POSTED = 3


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def save(path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def today():
    return datetime.now(UAE).date().isoformat()


def by_id(products):
    return {p["id"]: p for p in products}


def posted_this_cycle(rot):
    return {p["id"] for p in rot["posted"] if p["cycle"] == rot["cycle"]}


def start_cycle(rot, products):
    """Shuffle every product into a new cycle, deferred ones last."""
    rot["cycle"] += 1
    rng = random.Random(rot["cycle"])
    front = [p["id"] for p in products if not p["deferred"]]
    back = [p["id"] for p in products if p["deferred"]]
    rng.shuffle(front)
    rng.shuffle(back)
    rot["order"] = front + back


def next_item(rot, products):
    done = posted_this_cycle(rot)
    for pid in rot["order"]:
        if pid not in done:
            return pid
    start_cycle(rot, products)
    return rot["order"][0]


def line(p):
    state = "READY" if p["image"] else "!! RESTYLE FIRST"
    return f"PHOTO  {p['id']}  {p['name']:<26} AED {p['price']:>4}  {state}"


def progress(rot):
    return f"cycle {rot['cycle']}, {len(posted_this_cycle(rot))}/{len(rot['order'])} posted"


def write_log(rot, products):
    names = by_id(products)
    rows = []
    for p in rot["posted"]:
        prod = names.get(p["id"], {"name": p["id"], "price": ""})
        kind = "" if p.get("kind", "photo") == "photo" else f" ({p['kind']})"
        rows.append(f"| {p['date']} | {prod['name']}{kind} | {prod['price']} | {p['post_id']} |")
    out = ["# Myth Studios — Instagram posting log", "",
           "Written by `social/rotate.py`; do not edit by hand.", ""]
    last_post = rot["posted"][-1]["date"] if rot["posted"] else ""
    fails = [f for f in rot["failures"] if f["date"] >= last_post]
    if fails:
        f = fails[-1]
        out += ["## Last failure", "", f"{f['date']} — {names[f['id']]['name']}: {f['reason']}", ""]
    out += [f"## Posts ({progress(rot)})", "",
            "| Date | Item | AED | Post ID |", "|------|------|-----|---------|", *rows, ""]
    LOG.write_text("\n".join(out), encoding="utf-8")


def main(argv):
    products = load(PRODUCTS)
    rot = load(ROTATION)
    names = by_id(products)
    cmd = argv[0] if argv else "today"

    if cmd == "today":
        date = today()
        done_today = [p for p in rot["posted"] if p["date"] == date and p.get("kind", "photo") == "photo"]
        if done_today:
            p = done_today[-1]
            print(f"ALREADY POSTED {date}: {names[p['id']]['name']} ({p['post_id']})")
            return EXIT_ALREADY_POSTED
        pid = rot["assignments"].get(date)
        if pid is None:
            pid = next_item(rot, products)
            rot["assignments"][date] = pid
            save(ROTATION, rot)
        print(line(names[pid]))
        print()
        print(f"{date}, {progress(rot)}")
        return 0

    if cmd == "show":
        sys.stdout.reconfigure(encoding="utf-8")
        print(json.dumps(names[argv[1]], indent=2, ensure_ascii=False))
        return 0

    if cmd == "set-image":
        pid, url = argv[1], argv[2]
        if not url.startswith("https://"):
            sys.exit("image must be a public https URL")
        names[pid]["image"] = url
        names[pid]["image_note"] = f"Mode A, {today()}"
        save(PRODUCTS, products)
        print(f"{pid} image set")
        return 0

    if cmd == "posted":
        pid, post_id = argv[1], argv[2]
        if pid not in names:
            sys.exit(f"unknown product {pid}")
        if any(p["post_id"] == post_id for p in rot["posted"]):
            sys.exit(f"post {post_id} is already recorded")
        # Book it on the day it was picked, so a run that crosses midnight
        # doesn't swallow the next morning's post.
        posted_days = {p["date"] for p in rot["posted"] if p["id"] == pid}
        picked = [d for d, a in rot["assignments"].items() if a == pid and d not in posted_days]
        date = max(picked) if picked else today()
        if not picked:
            print(f"warning: {pid} was never picked by `today`; booking it on {date}")
        rot["posted"].append({"cycle": rot["cycle"], "date": date, "id": pid,
                              "post_id": post_id, "kind": "photo"})
        save(ROTATION, rot)
        write_log(rot, products)
        print(f"recorded {names[pid]['name']} -> {post_id}; {progress(rot)}")
        return 0

    if cmd == "fail":
        pid, reason = argv[1], " ".join(argv[2:])
        rot["failures"].append({"date": today(), "id": pid, "reason": reason})
        save(ROTATION, rot)
        write_log(rot, products)
        print(f"failure noted for {names[pid]['name']}")
        return 0

    if cmd == "status":
        done = posted_this_cycle(rot)
        left = [pid for pid in rot["order"] if pid not in done]
        print(progress(rot))
        ready = [pid for pid in left if names[pid]["image"]]
        print(f"{len(left)} to go, {len(ready)} with a studio image ready")
        for pid in left:
            print("  " + line(names[pid]))
        if rot.get("parked"):
            print("parked until priced: " + ", ".join(p["name"] for p in rot["parked"]))
        return 0

    sys.exit(__doc__)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
