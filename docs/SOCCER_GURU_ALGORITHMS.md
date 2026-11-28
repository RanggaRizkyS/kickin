# Public Soccer Guru mechanics adapted for Joko Soccer

This document distinguishes public, documented behavior from Joko Soccer's own mechanics. It does not claim to reproduce Soccer Guru's private source code or unpublished match formulas.

## 1. Effective-stat card pricing (publicly documented)

Soccer Guru's public Player Prices reference states that a card price is based on OVR and the sum of the six card stats: PAC, SHO, PAS, DRI, DEF, PHY. That sum is commonly called Effective Stats. Its price sheet gives an OVR base price and a multiplier based on effective-stat bands.

Joko Soccer implements that published base-price curve for OVR 70-99. For OVR below 70, the game uses a conservative local fallback because the public sheet begins at OVR 70. After the base price is calculated, Joko's own system-market supply and demand factors are applied. The dynamic supply/demand market is a Joko-specific extension, not claimed to be Soccer Guru's exact formula.

Source: https://soccerguru.live/resources/player-prices

## 2. Chemistry links and grades (publicly documented)

The public Soccer Guru chemistry guide describes global links: every starter can link to every other starter, regardless of adjacency on the pitch. Links are gained from shared club/team, nationality/country, and league. Correct-position players with enough links receive Green or Yellow individual grades; out-of-position players cannot be Green, and players moved across positional categories remain Red. Each starter contributes 7 points for Green, 5 for Yellow, and 0 for Red. Team chemistry grades are Green at 62+ points, Yellow at 49+ points, and Red below 49.

Joko Soccer converts the 0-77 point total into a 0-100 display percentage. The user-selected familiarity system is an additional Joko rule: repeated pair appearances and repeated squad appearances add limited familiarity links. It is not described as Soccer Guru's public chemistry formula.

Goalkeeper display-stat mapping follows the public guide: DIV→PAC, HAN→SHO, KIC→PAS, REF→DRI, SPE→DEF, POS→PHY. The original goalkeeper attributes are preserved in the catalog as well.

Sources:
- https://soccerguru.live/articles/conquer-the-competition
- https://staging.soccerguru.live/articles/conquer-the-competition

## 3. Pack odds (public example, not a universal pack rule)

Soccer Guru's economy article publishes one example for a two-card Gold pack: OVR 75-78: 45%; 79-82: 45%; 83-86: 6.5%; 87-90: 3%; 91-93: 0.5%. That is a documented example for that specific pack, not a universal probability for every pack. Joko's Rookie/Pro/Elite pack weights remain configurable in `.env`; do not treat those custom weights as Soccer Guru's hidden settings.

Source: https://soccerguru.live/articles/mastering-the-economy

## 4. Match simulation and ranking

Soccer Guru publicly documents Arena/PvP behavior, but does not publish the complete internal event-generation formula, player-by-player match engine, or exact rating-change equation. Joko Soccer keeps its own deterministic, seeded 90-minute event engine and its own Team-Strength matchmaking/underdog ranking model. Those are Joko-specific implementations inspired by the broad public idea of PvP competition, not copies of Soccer Guru's private algorithm.

Source: https://soccerguru.live/articles/pvp-updates

## 5. User-specific rules take precedence

The following choices belong to Joko Soccer and intentionally differ from Soccer Guru: two-hour player claim, one squad per user, three selectable formations, XP-based player development to level 50, 90-minute sparse logs with a five-second half-time pause, manual admin hard reset, one global system market plus user-to-user market, bot fallback in Classic only, and underdog rewards based on Joko Team Strength.

Betting/prediction commands and real-money wagering are not part of Joko Soccer.
