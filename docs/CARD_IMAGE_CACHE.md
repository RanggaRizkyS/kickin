# Optional original FUT card image cache

The project retains an optional MariaDB-backed image mapping/cache service in `src/services/card-image-cache.js`. It is not used by the current player-card renderer because the game now uses one consistent user-supplied Gold/Silver/Bronze template layout for every card.

## Player IDs are not FUT item IDs

The bundled game catalogue is `EAFC26-DataHub`. Its `player_id` values identify a player record; they are not guaranteed to be an EA Item ID or third-party catalogue/card ID. The CSV's `player_face_url` field is a player portrait, not a complete Ultimate Team card.

Do not create card-image URLs by guessing from a SoFIFA player ID. An exact full-card mapping requires a verified card identity, game version, and a direct image URL from a provider that permits the intended use.

## Mapping file retained for future use

`data/card-image-map.json` remains empty by default. The generic mapping/cache service is retained for a future build where a verified original-card source is configured. It is not allowed to override the current local template renderer.

Example mapping structure for future reference only:

```json
{
  "252371": {
    "gameVersion": "FC26",
    "eaItemId": "REAL_EA_ITEM_ID",
    "providerCardId": "REAL_PROVIDER_CARD_ID",
    "provider": "approved-provider",
    "imageUrl": "https://approved-image-host.example/path/to/card.png"
  }
}
```

Replace all example values with a real, tested mapping and a direct image URL from a source that permits its use. Never assume a player ID is an EA Item ID.

## Current card rendering

All cards currently go through `src/services/card-renderer.js` and use:

- `public/img/blueprint/card-gold.png`
- `public/img/blueprint/card-silver.png`
- `public/img/blueprint/card-bronze.png`

Portraits come from the SoFIFA player portrait cache, not from a full-card image API. The supplied card template, player portrait, OVR, position, country and stats are composited locally into a PNG attachment.

See `docs/CARD_LAYOUT_TEMPLATE.md` for the measured 1024×1536 layout and exact text/portrait coordinates.
