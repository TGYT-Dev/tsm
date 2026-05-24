# Inventory Rendering

The inventory viewer in the web UI fetches slot data from TSMBridge and renders it as a grid of item icons.

---

## Data Flow

```
Player tab opened
  → GET /api/player/:name/inventory  (server.js proxies to TSMBridge HTTP)
  → GET /api/player/:name/enderchest
  → GET /api/player/:name/stats
  → renderSlot() called for each slot
  → itemIconUrls() builds candidate texture URLs
  → tryLoadImage() tries each URL in sequence
```

---

## Inventory Layout

The Paper API returns a flat array of 41 slots:

| Slots | Contents |
|---|---|
| 0–8 | Hotbar |
| 9–35 | Main inventory (3 rows × 9) |
| 36–39 | Armor (feet, legs, chest, head) |
| 40 | Offhand |

The UI renders:
1. Main inventory (slots 9–35) — 3×9 grid
2. Hotbar (slots 0–8) — 1×9 grid below
3. Ender chest (slots 0–26) — 3×9 grid

Null slots render as empty grey squares.

---

## Texture Resolution

Minecraft textures live in two directories in the assets repo:
- `/textures/item/` — items, tools, food, etc.
- `/textures/block/` — blocks (stone, dirt, logs, etc.)

`BLOCK_TEXTURE_NAMES` in `index.html` is a hardcoded set of block names that should be fetched from `/textures/block/` first. Everything else tries `/textures/item/` first.

`itemIconUrls(material)` returns an ordered list of candidate URLs:
1. Primary directory (item or block based on the set)
2. Secondary directory
3. `_side` variant
4. `_top` variant

`tryLoadImage(img, urls, index)` is called recursively on `onerror` until a URL succeeds or all are exhausted. If all fail, the image is hidden and a text fallback (truncated block name) is shown.

---

## Asset Source

Textures are loaded from:
```
https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.21/assets/minecraft/textures/
```

This is a community-maintained mirror of Minecraft's asset files. If a texture isn't found there, the fallback text label is shown instead.

---

## Known Limitations

- Animated textures (lava, water, fire, portals) render as static frames
- Some modded or custom items will always show the fallback label
- Enchanted items don't show enchantment glint
- Item display names with formatting codes are shown as-is
- Armor slots and offhand slot are fetched but not currently displayed in the UI grid (they are in the data)

---

## Adding Missing Textures

If a block consistently falls back to the text label, add its name to the `BLOCK_TEXTURE_NAMES` set in `public/index.html`. The name should match the Minecraft internal ID without the `minecraft:` prefix.
