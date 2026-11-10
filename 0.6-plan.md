# Plan 0.6 — Milestones & Campaign Arc

Subject scope: a company-progression layer on top of the existing world,
autopilot, market, damage and competitor systems. The 0.5 sandbox already flies,
fails, repairs, competes and settles on a real deterministic budget; 0.6 gives
that sandbox named goals, visible company standing, a first "win" condition and
a clean handoff between worlds. It introduces no new physics, no second flight
model, no per-frame work.

This plan ships in two increments:

- **0.6.1 Company milestones** — named delivery/cash/reputation goals, a
  milestone ticker in the deck, milestone rewards, and a first end-of-arc
  settlement against Skybolt Logistics on the starting world.
- **0.6.2 Inter-world campaign** — milestone-gated world unlocks, a company
  record that carries reputation (but not fleet or cash) across worlds, and a
  final "dominant courier" condition across the whole planet set.

## Files

```
js/constants.js            # ladders per world, carry and settlement tuning
js/campaign.js             # campaign record, per-world progress, rewards, unlocks
js/operations.js           # profile lock, reputation and rival carry at world start
js/competitor.js           # rival carry and the "noticed" skill growth
js/mission.js              # settles milestones when a leg finishes on the deck
js/deck.js                 # milestone strip and ladder, award block, settlement card
js/menu.js                 # gated world picker, campaign status, new campaign
js/main.js                 # restores the campaign record before the first run
index.html / css/style.css # strip, ladder, award, settlement and menu layout
experiments/campaign-test.js
experiments/campaign-sweep.js
experiments/logs/0.6.1-milestones.txt
experiments/logs/0.6.2-campaign.txt
```

## 0.6.1 — Company milestones

### Milestone ladder

A milestone is a named threshold on one world. Each has a `kind` that picks
what it measures and a `target`:

| kind | measures |
|---|---|
| `deliveries` | delivered legs |
| `contracts` | delivered board contracts |
| `contractTo` | delivered board contracts to a named pad |
| `fragile` | fragile contracts delivered intact |
| `cargoKg` | surviving cargo, kg |
| `netCash` | cash above the opening balance, never below zero |
| `reputationClean` | reputation, counted only after N legs without a crash or lost cargo |
| `dominant` | the settlement against the rival, below |

Milestones are strictly ordered: only the first unmet one is active, and it is
checked each time a **delivered** player leg settles on the deck. Clearing it
pays a one-time reward, marks it complete and activates the next; when the next
is already met it clears on the same leg.

Task milestones (`contracts`, `contractTo`, `fragile`) count from the moment
they become active, so each is a job the player takes on rather than something
an earlier leg happened to satisfy. The others are company totals for the
world.

Failure does not block progress except through the cash and reputation it
costs: a crashed leg or a leg that loses its cargo clears nothing and restarts
the clean-leg run.

Verdant ladder:

1. **First receipt** — deliver one leg to any pad. $1,000 grant.
2. **On the board** — deliver 3 board contracts. Unlocks the *Gentle* profile.
3. **Haulier** — 1,000 kg of surviving cargo. $1,500 grant.
4. **Reliable service** — reputation 65 with the last 5 legs clean. $2,000
   grant; Skybolt takes notice and its skill grows faster from then on.
5. **Long reach** — deliver one board contract to Farport. $2,500 grant;
   opens Tinmoon.
6. **Dominant courier** — hold more cash than Skybolt and serve every pad at
   least as often as it does, and at least 3 times. Settles the world.

Grants are sized in legs of the world's own trade, so a ladder never decides
the cash race against the rival by itself.

The rival does *not* get its own milestone ladder; it is the foil whose
progress the player measures against. Its bidding, flights, cash, pressure and
reputation are as in 0.5.2.

### Milestone state and rewards

`R.campaign` keeps two things:

- **The record** outlives runs and worlds: reputation, unlocks, cleared
  milestones and one settlement per world won. The page restores it from
  `localStorage` before its first run and saves it on every settled leg.
- **The state** is rebuilt for a world by `operations.initialize`: the world's
  ladder, the active rung resumed from the record, and the counters for this
  run.

Progress never moves while physics is running. `mission.finish` calls
`campaign.onLegSettled` after the leg result and the rival turn have settled,
and stores the awards on the debrief record.

The *Gentle profile unlock* is the first non-cash reward. Until it clears the
profile is listed disabled as locked, the hint names the milestone that opens
it, and `operations.dispatch` refuses it with that milestone in the reason. A
route saved on a locked profile is not ready, shows the lock in place of READY
and is never offered. The lock applies to the player only.

### Deck presentation

A milestone strip sits under the deck's tabs, on every tab:

```
MILESTONE 3 / 6  ·  Haulier          480 / 1000 kg delivered
[x][x][>][ ][ ][ ]
```

Clicking the strip expands the whole ladder: each milestone's threshold and
reward, a check on the cleared ones and the live progress on the active one.
For the final milestone the progress reads the standing verbally ("Skybolt
Logistics still leads by $Y", or "Ahead by $X · Farport needs 2 more
deliveries").

A milestone cleared by a leg is announced once and shown under that leg's
debrief with its reward and the goal that is now active. The final milestone
opens a settlement card naming the world, the cash lead, the delivery count
and the reputation at the finish; it offers the world menu, and dismissing it
leaves the player free to keep flying. There is no forced reset.

### Milestone validation

- Milestone progress is deterministic: the same reference run advances the
  ladder identically twice.
- A failed flight (crashed or cargo lost) does not grant delivery progress,
  does grant cash-loss "progress backwards" for cash milestones, and cannot
  award a milestone mid-flight.
- The cash milestone uses net cash *above the starting* $40,000, so a player who
  loses money does not regress past zero progress.
- `node experiments/campaign-test.js` checks deterministic progress, reward
  payouts, the Gentle-profile lock, Farport unlock gating, and that a crash
  does not award a milestone.
- `node experiments/campaign-sweep.js 40 verdant` flies a reference player
  through the real game with the damage model on and reproduces
  `experiments/logs/0.6.1-milestones.txt` byte-for-byte.
- All 13 pre-existing test suites still pass.

## 0.6.2 — Inter-world campaign

### Reputation carry and unlocks

Each world's fifth milestone opens the next: Verdant opens Tinmoon, Tinmoon
opens Cinder, Cinder opens Gossamer. A world switch keeps the player's
*reputation* (clamped to 50–60, so a new world starts no worse than the
default and at most a little more trusted) and gives the rival the same
reputation carry for that world. Fleet, cash, routes and rocket
types are rebuilt per world — the existing `main.restart` already resets them,
and 0.6.2 only seeds reputation and campaign progress from the shared carry.

Cash does not transfer: each world has its own starter capital, so progression
is through skill and reputation rather than a snowballing bank account.
Unlocks — the *Gentle* profile, the world list, the milestone display — travel
with the campaign.

Each world has its own six-milestone ladder tuned to its own distances, prices
and flight envelope, with grants in that world's money: Tinmoon asks for net
cash where Verdant asks for reputation, Cinder and Gossamer ask for fragile
cargo. The final milestone on each world is the same dominant-courier
settlement. Going back to a world resumes its ladder where it stood and pays
nothing twice.

### Pan-planet victory

A separate global campaign tally tracks "dominant courier" settlements per
world. When a player is dominant on all four worlds (Verdant, Tinmoon, Cinder,
Gossamer) the game shows a final arc-complete toast and credits, then returns
to free play. The rival never loses its budget or fleet between worlds; each
world's Skybolt instance is independent but starts 0.005 more skilled per
point of reputation the player carries above the default (the rival has heard
of you).

The world-picker menu shows each world's state — locked with the milestone
that opens it, milestones cleared out of six, or dominant with the winning
margin — so the player can see where they still have work. It also starts a
new campaign, behind a second click, which erases the record.

### Campaign validation

- Reputation carry is deterministic: switching worlds from the same save seed
  seeds the rival with the same skill offset.
- A player who never unlocks Tinmoon cannot reach it through the world menu;
  the milestone gate is enforced in `menu.selectWorld` as well as in the UI.
- Dominant-courier state persists across a world switch and survives a browser
  reload through the saved campaign record.
- `node experiments/campaign-test.js` exercises the world-switch path and
  asserts reputation carry, cash reset, fleet reset and rival skill offset.
- `node experiments/campaign-sweep.js 60 campaign` flies the four worlds in
  order and reproduces `experiments/logs/0.6.2-campaign.txt` byte-for-byte,
  showing milestones hit per world and the final dominant-courier tally.
- Balance and competitor sweeps remain in their existing bands; the campaign
  layer is passive reporting and gating, never runs inside the physics step,
  and does not alter existing flight economics.

## Acceptance criteria for 0.6

- A fresh run starts with milestone 1 active and the Gentle profile locked; a
  reference Verdant player reaches milestone 6 in a measured and repeatable
  number of legs without needing to grind.
- The milestone strip updates only on the deck, never during flight, and never
  awards a milestone for a failed leg.
- Skybolt is the foil for milestone 6 but its existing 0.5.2 behaviour is
  unchanged on every other axis — bidding, flights, cash, pressure, reputation.
- World unlocks are gated by the milestone that names them; the world menu
  shows lock reasons and unlock progress.
- All 0.5 acceptance criteria still hold; all earlier tests remain green; no
  allocations enter the frame loop or physics step.
