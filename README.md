# Ascension Rush: Payload Delivery

A small 2D rocket-delivery game: wrap-around planets, staged rockets, manual
flight or autopilot, pad-to-pad delivery, fuel/hull/payload economics, a
logarithmic altitude view with an adaptive inter-planet sky, in-flight damage
and failures, and a competing logistics company.

## Status
The 0.1 world/render scaffold, the 0.2 playable flight slice, the 0.3
autopilot + planet presets, the 0.3.1 aerodynamic envelope and load
measurements, the 0.3.2 flight-envelope autopilot, the 0.3.3 coast-impact
prediction and debrief, the 0.3.4 staging-authority rule, and the 0.3.5
operations deck are implemented. Pick a world from the boot menu and fly it
from the deck. **Dispatch** sends one validated leg on autopilot between any
two pads — one-way or out-and-back, refuelling at the destination or keeping
the exact stack that landed — and says specifically why a leg cannot go yet
(`NO ROCKET AT <PAD>`, `ROCKET BUSY`, `PAYLOAD EXCEEDS CAPACITY`,
`NEEDS REFUEL`, `INSUFFICIENT FUNDS`). **Routes** holds reusable pad-to-pad
services: pause, delete, change rocket type while nothing is in the air, and
opt-in auto-launch behind a cancellable countdown that never fires while a
dialog is open. The **flight log** keeps every finished leg — crashes too —
with its measured touchdown data, the rocket-type snapshot that flew it, and
itemized cash, and can turn any entry into a reviewed route or restore its
rocket type. Rocket types are edited in the workshop dialog; a route points to
a type, and each rocket is a fleet instance that stays where it landed.
Every dispatched leg starts on autopilot, which fades forward thrust as dynamic
pressure nears the world's cap, caps its thrust acceleration, keeps an
angle-of-attack backstop, and names the limit holding it back in the flight
HUD. It also stages on authority: a stage whose thrust cannot hold the rocket
up for the burn it has left is separated as soon as a later stage carrying at
least as much fuel can, rather than flown dry and landed with an engine that
cannot stop the descent — the HUD marks that frame `EARLY`, and a shipped
reference route never triggers it. Press `A` in flight to take manual control:
mouse aiming, Shift/Ctrl throttle, Space staging, no limits. In flight a
`COAST` marker on the ground forecasts where the drag-aware, engine-off
trajectory reaches the surface — coloured by whether that arrival would
deliver, land safely elsewhere, or break the world's touchdown limits — with
two HUD rows quoting the distance from the selected pad and the predicted
arrival speeds. The debrief reports the measured touchdown speeds and pad error
alongside peak Q and peak thrust acceleration.
`[` and `]` move a `0.5x–4x` time scale. Flights are sized for 20–30 s of real
time at the default `2x`.

The **0.4.1** market gives every pad its own prices: fuel, steel and delivery
drift a bounded step per finished leg, from a seed each world reproduces, and
the deck's **Market** tab shows all four pad tables and their contract boards.
A contract names the destination, the payload, a rate per kg, a deadline in
finished legs and sometimes a **fragile** flag (a stricter touchdown limit; the
cargo is lost above it, and the log says so). A dispatch or route without a
contract is a standing service that sells at the destination's current price
plus a distance factor. Either way the payout is quoted at dispatch and paid on
delivery, so a price that drifts mid-flight cannot change what the deck
promised, and fuel and structure are charged at the pad the leg leaves from —
tanking up where it is cheap is real money. Loading a contract into dispatch
pins its pads and payload; the flight log records the rate it was paid, the
contract it flew and whether the cargo was lost.

The **0.4.2** parts catalog makes a build a bill of materials — engines, tanks
and a fairing, with mass, cost, Isp and service life — and the **0.4.3** service
model rates an engine in seconds at throttle and a tank in legs flown: an
overhaul buys the seconds back, a flown-out tank is replaced by the turnaround,
and the deck sells the overhaul the stack needs. The **0.4.4** balance pass is
the Monte Carlo behind the prices, recorded in `experiments/logs/0.4.4-balance.txt`.

The **0.5.1** damage model charges a flight for how hard it flew. A stage is
rated against the world's own certified envelope — the pressure and
acceleration limits the autopilot flies — times how strongly it was built. A
reference stage accumulates only cheap fatigue inside its rating; sustained
overload wears it quickly, and a skimpy one is damaged much sooner on the same
hop. What the loads leave behind is stress, and stress is what fails: an
engine that loses half its thrust, an engine that dies (the
autopilot stages on the spot), a tank that leaks faster and faster, a fairing
that pops early, or a tank that comes apart entirely when it is pushed far
enough past its rating with propellant aboard. The flight HUD carries a
`STRUCTURE` bar and names the failure on an `ALARM` row; the debrief and the log
say what broke and what it cost. A hard arrival bills the stack and the cargo:
the payout is for the share that arrived, and a soft one inside the autopilot's
own band costs nothing. Repair is part of what a dispatch has to afford, charged
at the pad that does the work like the overhaul, so a stack is serviced before
it launches — what the player decides is how strongly to build, which profile to
fly, and when to overhaul. `experiments/logs/0.5.1-failures.txt` is the Monte
Carlo the rates were tuned on, and `experiments/logs/0.5.1-balance-damage.txt`
is the economy with the model switched on.

The **0.5.2** rival, Skybolt Logistics, owns a catalog-built courier, budget and
reputation, and bids probabilistically on the same open contracts. After each
finished player flight leg at the deck, it resolves at most one rival delivery
using the actual autopilot and fixed-step physics in an isolated simulation.
For an out-and-back order, the player authorizes the return from the deck after
the first leg, so the rival may act between the two flights. Rival failures,
repair, refuelling and replacement vehicles use the same operations and economy
rules. Deliveries from either company add pressure in proportion to surviving
cargo mass, then destination prices recover toward baseline over later turns.
The Market tab shows cash, deliveries and reputation side by side, plus each
pad's rival delivery count and kilograms. The rival is seeded per world; its
contracts remain ordinary shared-board contracts, so a player cannot dispatch
cargo the rival has already taken.

The **0.6** campaign gives the company named goals. Every world has a ladder of
six milestones — a first delivery, board contracts, cargo hauled, a clean
reputation run or a cash target, a contract to the far pad — shown in a strip
under the deck's tabs that expands into the whole ladder. A milestone clears
only when a delivered leg settles on the deck; it pays a grant, unlocks the
*Gentle* profile, or opens the next world (Verdant → Tinmoon → Cinder →
Gossamer). The last milestone is the settlement against Skybolt: more cash, and
every pad served at least as often and at least three times, makes the company
**dominant courier** of that world. Reputation carries to the next world,
clamped to 60, and Skybolt arrives there a little more skilled for it; cash,
fleet and routes start over. The world menu shows each world as locked (with
the milestone that opens it), in progress or dominant, and the campaign is kept
in the browser's local storage until "Start a new campaign" erases it.

The **0.3.7** inter-planet sky slice puts a visual system above the atmosphere:
a star, two planets and two moons placed by an azimuthal projection from their
orbit geometry, a labelled atmosphere ceiling, adaptive decade altitude marks,
and a solid flown trail beside the dashed engine-off coast trace. Surface and
current escape speeds come from `sqrt(2 * g0 * R^2 / r)`, the same GM the
integrator uses, and an above-atmosphere rocket at that speed is marked
`UNBOUND`. As the rocket climbs toward a body the camera's log knee and ceiling
ease toward it; a world switch morphs gravity, radius, air ceiling and scale
over about a second instead of snapping. No force, route, price or flight
report changes. The 0.3.8 gravity / Lagrange-point work is an experiment phase
in the plan, not wired into the flight loop.

Plans now use short descriptive filenames (`flight-sky-plan.md`,
`market-parts-plan.md`, …); subject numbers like 0.3.7 stay inside the
documents and in worklog names.

## Plans (subject numbers inside, short descriptive filenames)
Active:
- [`flight-sky-plan.md`](./flight-sky-plan.md) — Aerodynamics, safer guidance, flight diagnostics (0.3.1–0.3.4) and the inter-planet sky / escape-speed / adaptive-projection phase (0.3.7, with 0.3.8 as a gravity experiment).
- [`campaign-plan.md`](./campaign-plan.md) — Milestones & campaign arc: company milestones, rewards, world unlocks and a dominant-courier end condition.
- [`deck-hud-plan.md`](./deck-hud-plan.md) — Self-explained deck & HUD.
- [`damage-rivals-plan.md`](./damage-rivals-plan.md) — Damage & failures (0.5.1) and competitor pressure (0.5.2), both shipped.
- [`market-parts-plan.md`](./market-parts-plan.md) — Economy balance, parts catalog with service/repair, market prices & contract board.

Increments of the active plans, recorded in `archive/` as they land:
- [`archive/0.6.2-worklog.md`](./archive/0.6.2-worklog.md) — Campaign record, four world ladders, gated world menu, settlement card, measured reference runs (0.6.2).
- [`archive/0.6.1-worklog.md`](./archive/0.6.1-worklog.md) — Company milestones on Verdant and the Gentle-profile lock (0.6.1).
- [`archive/0.5.2-worklog.md`](./archive/0.5.2-worklog.md) — Rival bidding, isolated autopilot flights, market pressure and scoreboard (0.5.2).
- [`archive/0.5.1-worklog.md`](./archive/0.5.1-worklog.md) — Damage & failures: stress, failure modes, landing damage, repair bills (0.5.1).
- [`archive/0.4.1-worklog.md`](./archive/0.4.1-worklog.md) — Pad markets & contract board (0.4.1).
- [`archive/0.3.6-worklog.md`](./archive/0.3.6-worklog.md) — Operations deck review fixes (0.3.6).

Shipped earlier increments, kept beside their worklogs (the 0.3.x umbrella
plan is active again at the repository root for the sky phase):
- [`archive/operations-deck-plan.md`](./archive/operations-deck-plan.md) — Operations deck: pad-to-pad dispatch, return flights, fleet availability, flight log, reusable automatic routes.
- [`archive/world-render-plan.md`](./archive/world-render-plan.md) — World, canvas scaffold, log-Y wrap-X planet, launch pads, triangle rocket.
- [`archive/flight-controls-plan.md`](./archive/flight-controls-plan.md) — Rocket physics, stage builder, manual flight controls, time scale, first-pass economy & landing.
- [`archive/autopilot-planets-plan.md`](./archive/autopilot-planets-plan.md) — Autopilot (pad-to-pad + landing) and planet presets (gravity / atmo / size / reference build).
- [`archive/0.3.3-worklog.md`](./archive/0.3.3-worklog.md), [`archive/0.3.4-worklog.md`](./archive/0.3.4-worklog.md), [`archive/0.3.5-worklog.md`](./archive/0.3.5-worklog.md) — the 0.3.x follow-ups: aero loads, envelope autopilot, coast-impact prediction and debrief, staging authority, operations deck.

Original draft is preserved verbatim in
[`archive/0.1.0-draft.md`](./archive/0.1.0-draft.md).

See [`AGENTS.md`](./AGENTS.md) for code-style and workflow conventions.

## Run
Open `index.html` in a modern browser (no build step; classic `<script>`
tags, `file://`-friendly). Node smoke/regression tests:

```sh
node experiments/coords-test.js
node experiments/sky-test.js               # escape speed, sky projection, adaptive log scale
node experiments/aerodynamics-test.js
node experiments/flight-test.js
node experiments/builder-test.js            # rocket-type workshop, snapshots
node experiments/parts-test.js              # catalog, structure value, service pricing
node experiments/service-test.js            # wear, overhaul gate, tank life, repair quote
node experiments/render-smoke-test.js       # app startup against the real index.html
node experiments/autopilot-test.js          # envelope limits, profiles, staging, frame rates
node experiments/trajectory-test.js         # coast predictor: integrator equivalence, edges
node experiments/operations-test.js         # fleet, wait reasons, legs, routes, log, offers
node experiments/market-test.js             # pad prices, contracts, quotes, fragile cargo
node experiments/damage-test.js             # stress, failure modes, landing damage, repair
node experiments/competitor-test.js         # rival bids, shared pressure and isolated flights
node experiments/competitor-sweep.js 20 20261006 # seeded rival-tuning run
node experiments/campaign-test.js           # milestones, unlocks, world switch, persistence
node experiments/campaign-sweep.js 40 verdant    # reference player up one world's ladder
node experiments/campaign-sweep.js 60 campaign   # the four worlds in order
node experiments/envelope.js verdant 0      # flight envelope per planet/build
node experiments/envelope.js cinder 0 gentle 30 4   # profile (or `off`), fps, time scale
node experiments/build-sweep.js 300 1       # random builds: dry baseline vs limits off and profiles
node experiments/impact-accuracy.js 12 7    # coast-forecast error and cost per state
node experiments/failure.js 120 20261005    # damage Monte Carlo: failure rates per world/strength
node experiments/balance.js 20261004 4 2    # economy Monte Carlo: margin bands per world/build
```
(`node experiments/balance.js 20261004 4 2 damage` flies the same chains with
the 0.5.1 damage model on.)

Measurement scripts share `experiments/harness.js`; their recorded output is in
`experiments/logs/`. `experiments/logs/0.3.5-touchdowns.txt` is the
reference-route table for all four worlds in all three autopilot profiles, and
is byte-identical to the 0.3.4 table below its header.
`experiments/logs/0.4.4-balance.txt` is the balance run the prices were tuned
against: a margin histogram per world, bracket, stage count and payload, plus the
bands the plan targets. The dispatch card's PROFIT row quotes the same margin for
the leg it is about to fly.

`experiments/logs/0.5.1-failures.txt` is the run the damage constants were tuned
against: how often a hop breaks something on each world at four build strengths,
fresh and with worn engines. `experiments/logs/0.5.1-balance-damage.txt` is the
economy with the model on, against the same chains without it.
`experiments/logs/0.5.2-competitor.txt` records a seeded 20-turn rival run:
6 of 20 profitable bids taken, all six delivered, with per-pad mass and delivery
prices recorded. `experiments/logs/0.5.2-balance-pressure.txt` records the
steady-service economy with delivered-volume pricing enabled; every established
margin band still passes. The damage-on repeat is in
`experiments/logs/0.5.2-balance-pressure-damage.txt` and passes too.
`experiments/logs/0.6.1-milestones.txt` is a reference player's 40 legs on
Verdant with the damage model on: milestones on legs 1, 5, 9, 15, 17 and 19.
`experiments/logs/0.6.2-campaign.txt` is the same player through all four
worlds, each settled within 20 legs. Both are reproduced by
`campaign-test.js`.
