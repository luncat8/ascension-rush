# Plan 0.5 — Damage, Failures & Competitor Pressure

Subject scope: a stress-and-repair model that makes the loads of a flight matter,
and a rival delivery company that competes for contracts and changes destination
prices. Both systems share the existing parts, autopilot, operations and market
rules; neither introduces a second flight or economy model.

This plan ships in two increments:

- **0.5.1 Damage & failures** — accumulated flight stress, part failures,
  landing damage and repair costs.
- **0.5.2 Competitor pressure** — a shared-board rival, isolated physics
  simulation, delivery-volume pricing and a standings view.

## Files

```
js/constants.js            # damage and competitor tuning
js/damage.js               # stage and payload stress, failure sampling
js/physics.js              # proper-acceleration and dynamic-pressure input
js/rocket.js               # per-stage damage state and separation stress
js/parts.js                # repair value, scrap threshold, servicing
js/economy.js              # repair, fuel, turnaround and delivery accounting
js/mission.js              # landing/rupture adjudication and debrief
js/operations.js           # shared dispatch/result path and player standings
js/competitor.js           # rival fleet, bids and bounded headless flights
js/market.js               # ownership, delivery volumes and price pressure
js/deck.js                 # market scoreboard and rival-owned contracts
js/render.js               # flight damage HUD and rupture blast
index.html / css/style.css # classic script order and standings layout
experiments/damage-test.js
experiments/competitor-test.js
experiments/competitor-sweep.js
experiments/failure.js
experiments/logs/0.5.1-failures.txt
experiments/logs/0.5.1-balance-damage.txt
experiments/logs/0.5.2-competitor.txt
experiments/logs/0.5.2-balance-pressure.txt
experiments/logs/0.5.2-balance-pressure-damage.txt
```

## 0.5.1 — Damage & failures

### Structural stress

Each attached stage carries one cumulative stress value. Its certified
acceleration and dynamic-pressure limits come from the active world's flight
envelope, scaled by `structureMargin` and the build's `strength` (0.5–1). The
load is proper acceleration — thrust and aerodynamic force, with gravity added
back — so free-fall weight is not treated as structural load. The payload has a
separate damage channel.

```
shareG = properAcceleration / stageAccelerationLimit
shareQ = dynamicPressure / stagePressureLimit
stress += stressRate * (
    max(0, shareG - 1)^2 + max(0, shareQ - 1)^2
    + fatigueWeight * (shareG^2 + shareQ^2)
) * dt
```

The fatigue term is deliberately small but non-zero inside the rating. Large,
sustained overload adds stress much faster. A stress of `scrapStress` makes a
stage uneconomical to repair; `ruptureStress` with propellant aboard ruptures
the tank. All tuning belongs in `constants.damage`.

Cargo accumulates damage from sustained G-load. Once its fairing is gone, it
also takes pressure damage. A soft touchdown is measured against the shipped
autopilot landing band; harder vertical and horizontal arrivals damage both
cargo and the surviving stages. A fragile contract keeps its stricter touchdown
limit.

### Failures and servicing

The active stage can fail while it is burning. Its rate is driven by the stress
it already carries and the engine's burn-time wear:

```
rate = min(maxFailureRate,
    failureRate * stress^failureExponent + wearRate * wearExcess^2)
p = 1 - exp(-rate * dt)
```

The exponential sample keeps risk independent of the physics step. Each flight
has a seeded damage stream, separate from market and competitor randomness.
Failure modes have visible effects: a degraded engine loses thrust and Isp, an
engine-out stages on the next viable stage, a tank leak drains fuel at an
increasing rate, and a failed fairing exposes the cargo. A fueled tank at the
rupture threshold ends the mission, writes off the vehicle, records its cause
and shows a short blast at the rupture position.

A safe but hard landing leaves stress on every surviving stage. At the next
launch, servicing is quoted with the other dispatch costs and paid at the
origin pad. A stage beyond the scrap threshold is replaced by the turnaround;
a dead engine is replaced as part of repair. A repair cannot be skipped to
launch a damaged stack. The HUD shows the active stage's structure and latest
alarm, while the report and log name failures, cargo loss and repair cost.

### Damage validation

- `node experiments/damage-test.js` checks stress and rate shape, step-size
  independence, strength scaling, every failure effect, rupture, landing damage,
  deterministic rolls and the repair path.
- `node experiments/failure.js [legs] [seed]` measures failure rates, stress,
  repair cost and cargo damage per world and build strength. The tuned run is
  `experiments/logs/0.5.1-failures.txt`.
- `node experiments/balance.js 20261004 4 2 damage` checks the economy with
  damage on; `experiments/logs/0.5.1-balance-damage.txt` records the tuned run.
  Physics baselines continue to run with damage disabled.

## 0.5.2 — Competitor pressure

### Rival company and dispatches

Skybolt Logistics owns a parts-catalog courier, one fleet instance, its own
cash, a starting reputation and a reproducible skill value. The first vehicle
is starter capital, like the player's; rebuilding a lost vehicle is paid from
Skybolt's balance through the ordinary rocket-build operation. Its single
ship moves to the pad where its last delivery landed and considers contracts
posted at that pad.

After each finished player flight leg, the rival receives one opportunity to
bid on the same open board. A return order is at the deck awaiting authorization
between its flights, so the rival can act at each landing but never simulates
over active player physics. It evaluates launch readiness and expected net
revenue, including refuelling, repair, overhaul and autopilot fee, then considers
the most profitable eligible contract. Its acceptance chance is bounded to
20–60%:
a fresh company bids about 30–40% of profitable opportunities, presses harder
when the player has the cash lead, and eases off when the rival is ahead. Skill
grows with successful deliveries, modestly improving bid confidence; a skilled
rival uses the gentle profile for fragile cargo. A contract already assigned to
either company cannot be taken by the other.

The rival is not rendered as a second live rocket. It resolves at most one
flight after a finished player flight leg through the actual
`operations.dispatch`, autopilot, controls and fixed-step `physics.step` path.
The simulation has a
fixed time budget; a guidance timeout is a normal vehicle loss and releases the
contract. Rival missions use the shared parts, damage, mission and market rules,
but isolated game/fleet state: they do not advance the market a second time,
write to the player's flight log, move the player's cash or leave the player's
autopilot enabled. The rival has its own deterministic random stream.

### Shared market and standings

Every successful contract or standing-service delivery records the mass that
survived arrival, attributed to its operator. A reference payload lowers the
pad's delivery price by 3% of its baseline; the price reverts 30% of the way
toward baseline on each market turn, while fuel and steel keep their existing
reversion. The stronger local signal makes rival activity readable without
moving the established steady-service economy out of its margin band. Prices
are bounded by the market floor, and a partial cargo arrival exerts
proportionally less pressure. The market tab shows the player's and rival's
cash, deliveries and reputation, and makes the rival's destination volume
visible per pad.

Reputation starts at 50, rises by one for a successful cargo delivery and falls
by two after a crash or destroyed cargo. It is a readable standings measure,
not a win condition. The rival can lose a vehicle and contracts; it must pay to
rebuild and cannot launch an unaffordable service. Neither company has a
campaign victory condition in 0.5.

### Competitor tuning and validation

- Tune contract selection to produce roughly 30–40% rival acceptance at equal
  capital, up to 60% when the player has a substantial cash lead and down to
  20% when the rival is comfortably ahead. Only positive expected-profit
  opportunities are eligible.
- `node experiments/competitor-test.js` checks probability bounds, ownership,
  real autopilot/physics resolution, contract settlement, price pressure and
  isolation of player state.
- `node experiments/competitor-sweep.js [turns] [seed]` measures acceptance,
  cash, delivery failures and pad-level rival volume through repeated real
  rival dispatches; record the tuning run in `experiments/logs/`.
- Seed `20261006` over 20 market turns accepted 6/20 bids; all six delivered,
  cash rose from $40,000 to $50,936. The three served pads ended at
  $16.80–$17.24/kg from $17.73–$18.49 opening quotes; no-delivery Homeport
  ended at $17.97/kg from $18.06. The recorded run is
  `experiments/logs/0.5.2-competitor.txt`.
- `node experiments/balance.js 20261004 4 2` keeps the steady-service economy
  inside its established +10–20% margin band with volume pressure enabled;
  `experiments/logs/0.5.2-balance-pressure.txt` records the run. Repeating with
  `damage` enabled also passes; the steady-state margins are +10.4 / +12.6 /
  +10.9 / +13.9% across Verdant, Tinmoon, Cinder and Gossamer, recorded in
  `experiments/logs/0.5.2-balance-pressure-damage.txt`.
- Keep the rival batch bounded and outside the rendered frame loop. Reuse the
  existing simulation systems and scratch state; do not introduce a second
  approximate integrator or per-frame competitor allocations.

## Acceptance criteria for 0.5

- Failure modes visibly alter the flight; leaks drain propellant, engine
  failures reduce or remove thrust, and rupture ends the mission with a blast
  and a named report.
- Hard-but-safe landings produce damage and a proportional repair quote;
  soft arrivals inside the reference band produce none.
- Worn engines fail more often and request overhaul after their rated burn time.
- The rival shares the contract board, delivers and loses cargo through the
  same mission path, and can be beaten by better player operations.
- Delivered cargo from either operator moves destination delivery prices, and
  repeated rival service is visible in the Market standings.
- All earlier world, physics, autopilot, market, parts and operations tests
  remain green; damage and competitor work stays out of the rendered frame
  loop.
