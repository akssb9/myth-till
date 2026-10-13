# Myth Studios — daily Instagram photo (cloud)

One product photo to @myth.studios every morning at 09:05 UAE, run by a scheduled
Claude Code routine in the cloud. This replaces the `myth-studios-daily-post` task
that ran on the Windows PC (last post 2026-09-01). Ahmed authorised posting without
asking each time; the rules below are his, carried over from that task.

| File | What it is |
|------|------------|
| `products.json` | Every Myth product: name, price (from the till), the exact caption, and the studio image it posts with (`null` = needs a restyle first) |
| `rotation.json` | This cycle's order, everything posted, today's pick, failures |
| `POSTING-LOG.md` | Human-readable log, rewritten by `rotate.py` |
| `source/<id>.jpg` | The till's phone photo for each product still waiting for a restyle |
| `rotate.py` | Picks the day's product and records results |

## Rules (Ahmed's)

- One product per day. Nothing repeats until every product has posted once.
- Never post a raw phone photo — hand, cluttered room and the price badge burned into the corner.
  It gets a studio restyle first, and only on the day it posts (no rendering ahead).
- The price goes in the caption, never in the image. Post the caption from `products.json` verbatim.
- If anything fails, do not substitute another product, image or caption. Log it and stop.
- Never mark something posted that wasn't.

## The run

**0. Sync.** The container may be fresh.

```bash
cd /home/user/myth-till
git fetch origin ccr-1c64d76c-8q8pun && git checkout ccr-1c64d76c-8q8pun && git pull --ff-only origin ccr-1c64d76c-8q8pun
```

Load the tools: `ToolSearch` with
`select:mcp__Zapier__execute_zapier_write_action,mcp__Zapier__execute_zapier_read_action,mcp__higgsfield__media_import_url,mcp__higgsfield__generate_image,mcp__higgsfield__jobs_wait,mcp__higgsfield__sandbox_exec,mcp__higgsfield__balance`.

**1. Pick.** `python3 social/rotate.py today` — run the code, don't reason about it.
`ALREADY POSTED` (exit 3) means today is done: stop. Otherwise read the record with
`python3 social/rotate.py show <id>`.

**2. Duplicate guard.** Read the last 5 posts (Zapier `execute_zapier_read_action`,
`selected_api: InstagramBusinessCLIAPI`, `action: _zap_raw_request`,
`tool_name: instagram_for_business_make_api_get_request`, params
`{"url": "https://graph.facebook.com/v21.0/17841438576857005/media", "querystring": {"fields": "id,caption,timestamp", "limit": "5"}, "fail_on_errors": "false"}`).
If one from the last 20 hours starts with `Unlocked: <today's name>`, an earlier run published
but never recorded it: `rotate.py posted <id> <that post id>`, commit, and stop.

**3. Restyle, only if the item says `!! RESTYLE FIRST`.**

- `balance` must show at least 2 credits (one restyle = 2). If not:
  `rotate.py fail <id> "no Higgsfield credits"`, commit, push, report, stop.
- Import the phone photo: `media_import_url` with
  `https://raw.githubusercontent.com/akssb9/myth-till/ccr-1c64d76c-8q8pun/social/source/<id>.jpg`, `type: image`.
  (Uploads straight from this container are blocked; Higgsfield fetches the public file itself.)
- Look at the photo before writing the prompt (step 4's sandbox command works on any URL).
- `generate_image`, params `{"model": "marketing_studio_image", "aspect_ratio": "4:5", "use_unlim": false, "medias": [{"value": "<media_id>", "role": "image"}], "prompt": ...}`.
  Prompt: *reproduce the object exactly* (name its shape, every colour, matte 3D-printed finish,
  fine print layer lines) + *remove the hand, the arm, the room and ALL text, numbers, stickers
  and the white rounded square with the price* + *alone on a dark matte charcoal stone surface,
  deep near-black background, **neutral daylight-balanced key light from upper left with a subtle
  warm gold rim on one edge only**, soft shadow opposite, 4:5, object filling about half the frame,
  centred, no text, no watermark, no people, no hands*.
- 🚫 Never prompt "dramatic warm gold key light" — it turns tan, grey and red products brown
  (Mario's hair 08-08, Totoro's fur 08-11).
- ⚠️ Realistic heads and busts (Kratos) draw false NSFW refusals. Describe them as "a stylised
  collectible sculpture, a carved figurine, not a depiction of a real person" and avoid
  eye/face/jaw/chin/mouth wording.
- `jobs_wait` until it completes; take `result_url`.
- Check it (step 4). One retry with a corrected prompt is allowed; if that fails too,
  `rotate.py fail`, commit, push, report, stop.
- `python3 social/rotate.py set-image <id> <result_url>`.

**4. Look at the image before it goes out** (always, ready or restyled). This container can't
reach the image CDNs, but Higgsfield's sandbox can, and returns images to you:

```
sandbox_exec  command:
  cd ~ && curl -sSf -o post.png '<image url>' && curl -sSf -o src.jpg '<raw.githubusercontent source url, if any>' ;
  convert post.png -resize 560x700 -quality 82 post.jpg
  image_paths: ["post.jpg"]   (add a resized src.jpg to compare a restyle with its photo)
```

It must be the same object as the product (shape and colours), alone, with no hand, text,
price badge or watermark. If it isn't, don't post: fail and report.

**5. Publish.** `execute_zapier_write_action`, `selected_api: InstagramBusinessCLIAPI`,
`action: publish_media_v2`, `tool_name: instagram_for_business_publish_photo_s`, params
`{"media": ["<image url>"], "caption": "<caption from products.json>", "instagramPageId": "17841438576857005"}`.
Don't pass `connection_id`; the default connection is the right account.

**6. Record.** `python3 social/rotate.py posted <id> <post id>`, then fetch the permalink
(same GET action, url `https://graph.facebook.com/v21.0/<post id>`, querystring
`{"fields": "permalink,timestamp"}`), then:

```bash
git add social && git commit -m "Post <name> to Instagram" && git push -u origin ccr-1c64d76c-8q8pun
```

(Retry the push on network errors: 2s, 4s, 8s, 16s.)

**7. Report** in a few lines: what posted, the permalink, what's next, and if the next item
needs a restyle while credits are under 2, say so — that's the day posting will stop.

On any failure: `python3 social/rotate.py fail <id> "<what failed>"`, commit, push, and report
what failed and what's needed. Never post a substitute.

## Schedule

Routine `trig_01Bwh7ZRgWuTNMgns6x6ciTW`, 09:05 Asia/Dubai daily, fires into Claude Code session
`session_01Vz2Udhh1btnkRbdce35ZJS` (where the daily reports appear).

## Open items for Ahmed

- **Turn off the PC tasks** `myth-studios-daily-post` and `myth-studios-reels` in the Claude
  desktop app. They keep their own rotation and would post a second, possibly duplicate,
  product if the PC comes back on.
- **Higgsfield credits:** the subscription was cancelled 2026-09-09 and the balance is 0. Four
  products are ready to post without it; the 21 after them each need a 2-credit restyle.
- **Parked, no price:** Deadpool Mask, Dirham Tray, Sovereign Medallion. They join the rotation
  once they have a price (add them to `products.json`).
- **Reels:** the 8 PM reel task isn't part of this; it needed the PC's video pipeline and
  hadn't published since 2026-08-19.
