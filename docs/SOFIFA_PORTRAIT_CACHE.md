# SoFIFA player portraits and FUT-style card rendering

The bundled FC26 DataHub CSV includes `player_face_url` for each source player. The game importer stores the portrait URL in the catalog and the gameplay view exposes it as `player.player_face_url`.

## How it works

1. `/claim`, pack reveals, `/player`, and player-detail panels use `src/services/card-renderer.js`.
2. The renderer requests the player's SoFIFA portrait through `player-portrait-cache.js`.
3. A cache miss tries SoFIFA variants `_480.png`, `_360.png`, `_240.png`, and `_120.png` in that order, with `Referer: https://sofifa.com/` and a browser-style User-Agent. The CDN may not provide every size for every player/version.
4. The portrait is validated and saved as PNG under `storage/player-portraits/fc26/hq3/`. The `hq3` directory invalidates portraits from the previous renderer/cache profile so a better available source is attempted.
5. If only the 120px portrait exists, the renderer limits its enlargement so it does not make a small source occupy the entire artwork area. No image processing can recreate facial detail absent from the original source.
6. The renderer uses the supplied 1024×1536 template. It contain-fits the portrait with no face clipping mask, then draws OVR, position, player name, six stat values, nationality flag, league badge, and club badge.
7. League and club badges are fetched from SoFIFA's `meta/league/{id}/120.png` and `meta/team/{id}/120.png` paths when IDs are available. They are cached as local PNG files. If a badge is unavailable, the card uses a compact initials badge instead.
8. Gold, Silver, and Bronze keep the existing blueprint names and share the same geometry. Later renders reuse local cached images instead of requesting them again.

Portraits are separate from full-card artwork. A SoFIFA face image is not an Ultimate Team card PNG. The project combines the user-supplied card frame, portrait, game stats, and identity marks into its own FUT-inspired collectible card.

## Layout

See [`CARD_LAYOUT_TEMPLATE.md`](./CARD_LAYOUT_TEMPLATE.md) for pixel coordinates, font families, and safe zones.

## Configuration

Append these optional settings to `.env`:

```env
SOFIFA_PORTRAIT_CACHE_DIR=storage/player-portraits
SOFIFA_REFERER=https://sofifa.com/
SOFIFA_PORTRAIT_MISSING_RETRY_HOURS=24
SOFIFA_PORTRAIT_FAILED_RETRY_MINUTES=30
```

The default Referer is already configured. The portrait service only accepts HTTPS URLs on `cdn.sofifa.net` that match the player portrait path format from the bundled dataset.

## Cache and retry behavior

- `ready`: a local PNG is available and reused.
- `missing`: no supported portrait size was returned; retry after the configured missing window.
- `failed`: network, access, validation, or conversion failed; retry after the configured failed window.
- Existing `hq2` or unversioned cache records are refreshed into `hq3` rather than silently reusing a smaller old image.
- Simultaneous requests for the same player share one in-flight fetch.
- Downloads are written to a temporary file and atomically renamed to prevent partial cache files.
- Portraits and team/league badges are stored separately from full-card PNG assets.
- The portrait prefetch command is rate-limited and capped. Avoid repeated large batches; follow SoFIFA's terms and CDN limits.

## Commands

Normal game use is lazy: portraits and badges are fetched when a player's card is first rendered.

Optionally warm the first 100 portraits:

```bash
npm run portraits:prefetch -- --limit=100 --concurrency=2
```

View portrait cache metadata:

```bash
npm run portraits:status
```

## Notes

- This uses SoFIFA portraits and metadata images, not an official EA FUT card-image API.
- Gold/Silver/Bronze styles use the supplied blank template and its original filenames.
- If a portrait or badge cannot be fetched, the card still renders with the remaining assets and vector fallbacks.
