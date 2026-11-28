# Match engine balance

Joko Soccer uses its own deterministic 90-minute match model. It is not intended to reproduce a proprietary EA or Soccer Guru formula.

## Current target

The chance-rate settings in `src/services/match-engine.js` are calibrated against balanced 11-player squads. The archived 600-player test fixture is used only for repeatable tests; it is not the live player catalog. Across 1,200 seeded fixture matches with the current settings, the observed averages were approximately:

- 1.55 goals for the home side and 1.50 for the away side per match.
- 6.40 home shots and 6.13 away shots per match.
- 21.8% draws.
- 4.8% 0-0 results.

These figures are a tuning reference, not a promise about every real squad matchup. A deterministic 800-match Classic CPU benchmark using 40 generated CPU line-ups averaged a 4-6 point Team Strength gap and gave the stronger user side a win rate above 45%, while keeping CPU wins possible. Player shooting, finishing, shot power, goalkeeper reflexes/handling, team strength, and CPU personality still influence outcomes.

## Balance principles

- Evenly matched teams should still create several chances and should not be locked into frequent 0-0 draws.
- Better attackers increase on-target and conversion probability; better goalkeepers still reduce conversion probability.
- Team Strength gives a clearer but non-deterministic advantage to the stronger side without guaranteeing a win.
- Classic CPU line-ups target 4-6 Team Strength points below the user's squad, so Classic remains beatable without becoming an automatic win.
- Match history derives WIN/DRAW/LOSS from the final scoreline; CPU wins cannot be mistaken for draws just because the CPU has no user ID.
- CPU personalities change build-up, shot selection, and defensive pressure, but all personalities retain a viable route to scoring.
- Penalty frequency is kept separate from open-play scoring so that higher shot volume does not create excessive penalties.

Run `node --test scripts/match-engine.test.js` after changing these values. The statistical regression test checks balanced-match goals, shots, nil-nil frequency, and draw frequency.
