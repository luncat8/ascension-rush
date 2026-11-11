# Plan 0.3 — Autopilot & Planet Presets

Subject scope: (a) an autopilot that can fly from pad A to pad B and land
safely, usable as an AI "hire" option and as the foundation for the
competitor AI in 0.5; (b) a set of planet presets that vary gravity,
atmosphere, size, and pad layout — pickable from the start menu and saved
with the run. Economy balance constants from 0.2 are per-planet so each
world feels different.

## Files (added / changed)
```
js/planets.js       # planet preset table; replaces the hard-coded world constants
js/world.js         # live planet record, pad construction, pad lookup
js/autopilot.js     # guidance: velocity profile + thrust budget + staging
js/camera.js        # derived scale rebuilt from the active planet
js/controls.js      # shared actuators, autopilot hand-off, time scale
js/menu.js          # boot planet menu and planet switch
js/main.js          # run creation, planet switch, frame loop
js/physics.js       # reads g, density, Isp and the fixed step from the planet
js/economy.js       # prices and starting cash per planet
```

## Planet presets
A planet preset is a single object copied into `world.planet` at run start, so
gameplay modules read the live world instead of a constants table and a planet
switch is one assignment pass.

```
{
  id, name, description,
  circumference,          // m; implies radius = C / (2*PI)
  surfaceGravity,         // m/s² at wy = 0
  seaLevelDensity,        // kg/m³ (0 = airless)
  atmosphereScaleHeight,  // m for exp(-wy / H)
  maxAltitude,            // m, ceiling of the log altitude map
  logAltitudeScale,       // m, altitude where the log map stops expanding detail
  landingRadius, landingVerticalSpeed, landingHorizontalSpeed,
  pads: [{ name, frac }], // frac is a fraction of the circumference
  prices: { fuel, steel, delivery },
  defaultFuel: [f0, f1, f2], defaultPayload,   // the world's reference build
  flight: { ... }         // optional autopilot tuning overrides
}
```

Sizing rule: the circumference is the pacing lever. A world is made easier or
harder by moving its pads, not by inflating its rockets — pad-to-pad distance
comes straight from `C` and the pad fractions. Target at 1x: a standard
one-quarter hop flies in 40–60 s of simulated time, which is 20–30 s of real
time at the default `2x` time scale.

Shipped presets (pads named per world, four each):

```
world       C km   g m/s²  rho0   H m    pads (frac)                 prices fuel/steel/delivery   reference build
Verdant     20     9.81    1.225  800    0 / .25 / .5 / .75         $1.40 / 2.50 / 60            [420, 260, 200] kg, 80 kg
Tinmoon     16     1.62    0      900    0 / .16 / .5 / .68         $0.90 / 2.00 / 42            [200, 140, 100] kg, 80 kg
Cinder      24     16.5    1.9    900    0 / .25 / .5 / .75         $2.60 / 3.60 / 130           [1500, 900, 400] kg, 60 kg
Gossamer    26     5.4     3.4    2200   0 / .2 / .45 / .75         $1.10 / 2.20 / 85            [380, 240, 180] kg, 80 kg
```

Each world is a different problem: Verdant is the reference (thin air, even
spacing), Tinmoon has no drag at all so every metre per second must be bought
with fuel, Cinder's gravity makes the reference build five times heavier and
punishes a weak first stage, and Gossamer's deep atmosphere adds real drag
losses on the way up but helps on the way down. Wind (horizontal air velocity
feeding the drag term, seeded and off by default) stays a reserved field; 0.3
ships without it.

The chosen planet persists for the run. The boot menu lists the presets with
their headline numbers; the builder header reopens the same menu to start a
fresh run on another world.

## Autopilot design
The autopilot flies the *same* physics the player uses: it reads rocket state
and the target pad, writes `{ heading, throttle, stage }` into a command
record, and `controls.js` applies those commands through the same turn-rate
and throttle-rate limits as player input. It never touches position,
velocity, mass or fuel directly.

### Guidance
One velocity-profile controller covers the whole flight instead of a phase
machine per manoeuvre, with the phase labels used only for the HUD:

1. **PAD / LIFT** — the target is captured on the first tick (downrange
   distance fixes the cruise altitude) and the rocket climbs vertically to
   `liftAltitude` at full throttle.
2. **CRUISE** — altitude target is the cruise altitude; horizontal speed
   target is `min(speedCap, sqrt(2 * brakeAccel * dx), dx * arrivalGain)`, the
   classic "fastest speed from which the pad is still reachable".
3. **APPROACH** — the brake term takes over as `dx` shrinks, and the altitude
   target rides a glide slope down to an arrival floor so the rocket is
   already low and slow over the pad.
4. **TOUCHDOWN** — inside the arrival radius the descent rate is limited to
   what the remaining thrust can still cancel, then to the planet's touchdown
   velocity, so the last metres are a controlled sink rather than a hover.
5. **ABORT** — no fuel and no way to stop: cut throttle and take the crash
   instead of commanding impossible burns.

The commanded acceleration is assembled as an acceleration *vector*, not an
angle: the vertical component is gravity plus a bounded climb/descent
correction, the horizontal component is the velocity error minus the brake
profile's own feed-forward term, and the vector is clipped to
`thrustReserve * thrustAccel`. Clipping the vector (rather than clamping the
thrust angle) is what keeps the vertical channel supported on low-gravity
worlds; the horizontal command can only use what is left after gravity.

Staging fires when the active stage runs dry and a stage remains. Fuel left is
also compared with the impulse still needed to null the current velocity
(`remainingDeltaV`); below that the horizontal target is clamped to the
current speed, so the autopilot stops adding range and saves everything for
the landing.

### Player-facing
- `A` toggles the autopilot in flight, and the builder has a checkbox for
  handing over the flight; the HUD shows the phase label (`CLIMB`, `CRUISE`,
  `APPROACH`, …) or `OFF`.
- A ground tick shows the projected impact point, updated from a ballistic
  (drag-free) projection every frame.
- A delivery flown by the autopilot keeps a `10 %` fee of the reward.

## Contracts (deferred to 0.4)
0.3 keeps the 0.2 target selector: every other pad on the current world is a
legal destination, and the reward is `payloadMass * prices.delivery`. Payload
masses, distance bonuses, per-pad prices and urgency are 0.4's subject; the
mission record already carries `departedPadId`, `targetPadId` and
`payloadMass`, which is what that work needs.

## Acceptance criteria for 0.3
- Boot menu lists every preset with its headline numbers; picking one starts a
  run on that world, and the builder header reopens the menu.
- Each world is flyable with its shipped reference build: `node
  experiments/envelope.js <planet> 0` reports `delivered` on every route.
- Flight pacing holds the design band: 40–60 s of simulated time for a
  standard one-quarter hop, i.e. 20–30 s of real time at the default `2x`.
- The time scale ladder is player-selectable over `0.5x–4x`, and a flight
  reproduces identically at any multiplier (fixed step, scaled budget).
- Physics is planet-driven: the same build has identical Δv but different TWR
  per world, and gravity/density/Isp read the active planet on every step.
- Player can toggle the autopilot mid-flight, take over, and re-enable it
  without state corruption; an autopilot delivery keeps a 10 % fee.
- The projected landing marker moves during coast and converges on the target
  pad during descent.
