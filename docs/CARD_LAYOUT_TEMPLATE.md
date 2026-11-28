# FUT-style player card layout — supplied 1024 × 1536 template

The existing blueprint filenames are preserved:

- `public/img/blueprint/card-gold.png`
- `public/img/blueprint/card-silver.png`
- `public/img/blueprint/card-bronze.png`

All three use the supplied geometry; Silver and Bronze retain their own metallic palette.

## Visual layout

| Element | Placement | Rendering |
|---|---:|---|
| Main card | Existing supplied PNG | Drawn first; transparent area outside the card remains transparent |
| Player portrait | Center X 650; bottom Y 908; max 680 × 748 | Uniform contain-fit, no face mask and no crop |
| OVR | X 108; baseline Y 344 | Heavy display face, dark ink, no thick outline |
| Position | X 114; baseline Y 426 | Condensed bold uppercase face |
| Player name | Center X 512; baseline Y 991 | Large heavy uppercase text in the blank name strip |
| Stat values | Centers `[158,302,442,581,722,875]`; baseline Y 1230 | Heavy display font aligned below the template's preprinted PAC/SHO/PAS/DRI/DEF/PHY labels |
| Nationality flag | X 264; Y 1358; 100 × 64 | Clean flag tile at the foot of the card |
| League badge | Center `(512,1390)`; radius 47 | SoFIFA league icon when available; abbreviation fallback |
| Club badge | Center `(760,1390)`; radius 47 | SoFIFA club crest when available; initials fallback |

## Portrait quality

The portrait fetcher requests the SoFIFA image with `Referer: https://sofifa.com/`. It tries the larger `_480.png` and `_360.png` variants before `_240.png` and `_120.png`. The service stores the result under a new `hq3` cache path so older low-resolution cached images are not reused. When only the 120px fallback exists, the renderer reduces the enlargement rather than stretching it over the full portrait area. No image processing can recreate facial detail absent from the original source image.

## Team and league badges

The badge cache derives the SoFIFA `meta/team/{clubId}/120.png` and `meta/league/{leagueId}/120.png` paths from normalized player data. It downloads each badge once and keeps a local PNG copy. If SoFIFA does not provide a badge, the card shows a clean circular fallback with league/club initials.

## Typography and render flow

1. Draw the selected rarity template.
2. Draw the full portrait with proportional contain-fit. No inner clipping mask is used.
3. Draw OVR and position using bold condensed/display families.
4. Draw the player name in the name strip.
5. Draw six stat values beneath the template's printed labels.
6. Draw nation, league, and club identity badges at the bottom.

The card renderer remains shared by the `/claim`, pack top-pull, `/player`, and player-detail flows.
