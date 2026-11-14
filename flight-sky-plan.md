# Plan 0.3.x — Flight Envelope & Inter-planet Sky

Subject scope: a focused follow-up to 0.3.0 that makes atmospheric loads
visible, gives the autopilot useful flight-envelope limits, improves the
landing prediction shown to the player, and then (0.3.7) puts a visual sky
above the atmosphere — moons, planets, a star, a proper escape-speed readout,
a flown / predicted trajectory and a log scale that follows the approach to a
body. Keep the existing pad-to-pad velocity controller and shared physics:
0.3.7 adds no orbital state, no second gravity model and no new forces. A
separate experiment phase (0.3.9) measures whether Lagrange points and
multi-body gravity can be added cleanly before any of it reaches the flight
loop. Do not turn this arcade-scale game into an orbital simulator or replace
the controller with a large optimizer.

The series should leave the game easier to tune and provide measurements that
0.4 (parts / market) and 0.5 (damage / failures) can reuse. Subject numbers
are not a version sequence; the plan file is named for the subject, not the
number.

## What to borrow from MechJeb2

MechJeb2 is a useful reference for *flight-computer features*, not a design to
port wholesale. Its module set separates ascent guidance, landing guidance,
attitude aids, and flight / delta-v information. The useful patterns here are:

- **Ascent safety envelopes:** expose dynamic-pressure, acceleration, and
  angle-of-attack limits instead of asking the pilot to guess when to throttle
  back. MechJeb's ascent documentation lists these limits and automatic
  staging; that page also warns that some of its algorithm descriptions are
  outdated, so use it as feature vocabulary rather than a technical spec.
- **Targeted landing:** predict where a vehicle will reach the ground and make
  the distinction between a projected impact and a guaranteed landing.
- **Explainable flight data:** show the state and limits that caused the
  autopilot to change its commands, and keep useful per-flight measurements.

This game has a small, wrap-around 2D world, no orbit state, and already has a
purpose-built pad-to-pad controller. Orbital ascent, maneuver planning,
rendezvous, and other KSP-specific modules are outside the 0.3.1–0.3.4
increments and remain outside 0.3.7's visual sky slice. No MechJeb code or
dependencies are copied.

References:
- [MechJeb2](https://github.com/MuMech/MechJeb2)
- [Modules overview](https://github.com/MuMech/MechJeb2/wiki/Modules)
- [Ascent Guidance](https://github.com/MuMech/MechJeb2/wiki/Ascent-Guidance)
- [Landing Guidance](https://github.com/MuMech/MechJeb2/wiki/Landing-Guidance)
- [Smart A.S.S.](https://github.com/MuMech/MechJeb2/wiki/Smart-A.S.S.)
- [Delta-V Stats](https://github.com/MuMech/MechJeb2/wiki/Delta-V-Stats)

## Current baseline and design rules

- The 0.3.0 baseline uses an exponential atmosphere and inverse-square
  gravity. Its quadratic drag uses one constant coefficient and reference
  area, independent of rocket orientation; 0.3.1 adds a measured AoA term
  while retaining that on-axis calibration.
- `autopilot.js` follows a velocity / braking profile, budgets thrust between
  axes, preserves a landing reserve, and automatically stages. Keep that
  command-layer design; the autopilot must continue to fly the same physics as
  a manual pilot. The horizontal speed target decays smoothly to zero over the
  pad and has no minimum approach speed: a floor flips the target's sign as the
  rocket crosses the pad, and on a low-gravity world, where the vertical channel
  is in free fall, the resulting heading chatter decides whether the landing
  succeeds.
- Staging is judged on authority, not only on an empty tank. The descent needs
  thrust for braking sideways and holding altitude at once, so a stage that
  cannot clear that multiple of gravity at any point in its remaining burn
  cannot fly the landing; when a later stage can, the autopilot separates early
  rather than flying the weak stage dry. See 0.3.4.
- The 0.3.0 impact marker was a drag-free ballistic projection, and in the dense
  atmospheres it was misleading: it ignored drag and promised ranges the rocket
  never reaches. 0.3.3 replaces it with the bounded coast predictor below.
- The recorded 0.3.0 route times, peak altitude / speed, dry mass, and fuel
  remaining in `market-parts-plan.md` are the baseline for new Q / AoA measurements.
- The flight record already carries peak Q with its altitude / AoA, peak AoA
  with its concurrent Q (0.3.1), and the available and applied peak thrust
  acceleration (0.3.2). 0.3.3 adds the measured touchdown and the signed target
  error to the same record and report, which is what 0.5 damage tuning reads.
- `constants.rocket.maxAcceleration` currently clips the net acceleration in
  the physics step. Do not reuse that value as a pilot's thrust-acceleration
  limit: the guidance limit is based on available thrust divided by current
  mass (`T / m`) and is applied before producing a throttle command.
- Physics and rendering stay file:// friendly, use classic scripts, and avoid
  per-step allocations. Any predictor or aerodynamic sample writes into
  caller-owned scratch / telemetry fields.
- The map is a wrap-X / log-Y cylinder: `coords` owns the only forward and
  inverse altitude transform, and `camera` owns its scale. 0.3.7 makes that
  scale dynamic through those two modules rather than adding a second
  projection for the rocket. The system chart is that same map with a movable
  pivot; there is no separate sky projection.

## Aerodynamic model

Add one small, reusable aerodynamics layer for the current point-mass rocket:

```
vRelativeAir = vRocket - vWind                   // vWind is zero for now
speed         = length(vRelativeAir)
q             = 0.5 * density * speed * speed
bodyAxis      = (sin(heading), cos(heading))
alpha         = speed > epsilon
                ? acos(clamp(abs(dot(bodyAxis, vRelativeAir / speed)), 0, 1))
                : 0
Cd            = Cd0 + CdAlpha * sin(alpha) * sin(alpha)
dragAccel     = speed > epsilon
                ? -(q * Cd * referenceArea / mass) * unit(vRelativeAir)
                : (0, 0)
```

`q` is dynamic pressure in pascals; `Cd` is dimensionless. `alpha` is the
rocket's axis-to-flow misalignment, from 0 to 90 degrees; an axially aligned
prograde or retrograde burn is not treated as broadside flight. At near-zero
airspeed, report zero angle of attack. At zero atmospheric density, dynamic
pressure and drag are zero. Keep the present on-axis `Cd0`
and reference area as the calibration baseline; tune the additional
angle-of-attack drag term from the measured envelopes, not guessed planet by
planet.

This slice models **drag only**. Do not invent lift, fin stability, body
moments, or control-surface forces while the rocket has no fin geometry,
center of pressure, or attitude dynamics. Keep wind at zero; the API may take
relative air velocity so a later wind model does not require rewriting the
drag calculation. A future fairing can modify the aerodynamic profile without
changing this interface.

## Release sequence

### 0.3.1 — Aerodynamic envelope and measurements

- Add `js/aerodynamics.js` with allocation-free helpers that accept density
  and relative-air-velocity inputs and calculate dynamic pressure, angle of
  attack, drag coefficient, and drag acceleration. Functions that return
  several values mutate a supplied output record rather than allocating one.
- Use the helper from `physics.step`; preserve the existing fixed step, fuel
  accounting, touchdown interpolation, and planet gravity / density laws.
- Record current and peak dynamic pressure, altitude and angle of attack at
  peak pressure, peak atmospheric angle of attack (with its concurrent Q), and
  peak available thrust acceleration (`T / current mass`) in the already-created
  flight record. In vacuum, report peak AoA as not applicable. Store scalars
  only; do not keep a sample array per flight.
- Add current `Q`, angle of attack, and peak `Q` to flight telemetry. The
  post-flight report should preserve peak-Q altitude / AoA, peak AoA with its
  concurrent Q, and peak thrust acceleration for tuning and feedback without
  implying that these measurements cause damage in 0.3.x.
- Extend `experiments/envelope.js` to run every directed pad-to-pad route on
  each world and include peak `Q` with altitude / AoA at that sample, peak AoA
  with its concurrent Q, and peak thrust acceleration. Keep the existing
  outcome, time, altitude, speed, and fuel measurements.

### 0.3.2 — Flight-envelope autopilot

- Add planet-tunable `maxDynamicPressure`, `qFadeStartFraction`,
  `maxThrustAcceleration`, and `maxAngleOfAttackDeg` values to the existing
  `planet.flight` tuning path. `qFadeStartFraction` is the fraction of the Q
  cap at which soft limiting begins; AoA tuning is in degrees and converts to
  radians once when resolved. A null / absent limit disables that constraint
  (zero also disables the Q limit). Apply the AoA limit only in the same Q
  fade band, so it has no effect on airless worlds. Choose starting values
  from the measured post-aerodynamics 0.3.1 envelopes, then refine them against
  the constrained-route runs. Resolve selected planet/profile values once per
  flight or tuning-cache change; do not allocate records in the update loop.
- Add two simple autopilot profiles in the builder: **Balanced** (recommended
  per-planet limits) and **Gentle** (lower Q / thrust-acceleration limits and
  a tighter angle-of-attack envelope). Give Gentle named per-planet overrides
  or named global multipliers; do not bury profile math in the update loop.
  Avoid an advanced tuning screen full of sliders. Snapshot the selected
  profile into the flight record; the autopilot fee and manual controls do not
  change.
- Apply the limits to the autopilot's acceleration command, before guidance
  assumes that acceleration is available. Fade positive thrust along the
  relative airflow as Q approaches its cap instead of abruptly switching the
  engine off; retain braking and lateral authority where the envelope allows.
  Cap commanded thrust acceleration independently of the physics integrator.
  When Q is high, constrain the commanded rocket axis to the configured
  angle-of-attack envelope, then relax that constraint as Q falls. The rocket
  is axially symmetric in this model, so choose the nearer prograde or
  retrograde aligned axis when clamping the requested heading. Keep touchdown
  braking and the existing fuel reserve higher priority than cosmetic profile
  matching.
- Express the limits in one flow-aligned step of the command layer. Resolve the
  request into thrust *along* the relative airflow (the part that raises Q) and
  thrust *across* it; fade only the positive along-flow part across the Q band
  (linearly, from `qFadeStartFraction` of the cap to the cap), so braking and
  lift are never faded. The acceleration cap lowers the thrust budget that the
  climb, brake and descent profiles plan with, and it never drops below a named
  multiple of surface gravity (about 1.7): with less, the landing burn cannot
  brake sideways and hold altitude at once.
- Treat the angle-of-attack limit as a backstop, not a steering mode. It eases
  in across the same band (no limit at the band start), keeps the thrust axis on
  the end of the airflow axis it already points at until the request is clearly
  on the other side (a request near "sideways" must not flip the nose through
  broadside), and is never tighter than the angle at which the budget can still
  hold the rocket's weight. Because only the part of a request along the
  permitted axis is burned, a sideways request delivers `budget * sin²(angle)`
  of lift, so that floor is `asin(sqrt(margin * g / budget))`. The Q fade holds
  pressure inside the band, which tilts the thrust axis toward vertical to keep
  weight support; a tight angle clamp would fight that and sink the rocket into
  denser air.
- A launch or stage separation under autopilot lights the engine at the
  throttle the guidance holds, so a capped rocket does not spike at ignition;
  a player's staging still lights the next stage at full throttle. Record the
  thrust acceleration actually applied (`thrust / mass` at the start of the
  step, the same mass the guidance and the available-thrust figure use) next to
  the available figure, and report the applied one in the debrief.
- Keep dry-stage auto-staging and the existing shared turn / throttle rate
  limits. Do not make safety clamping a second physics model or bypass the
  common actuators.
- Show a concise limiter state in the flight HUD (for example `Q LIMIT`,
  `ACCEL LIMIT`, or `AOA LIMIT`) so the player can tell why the guidance is
  holding back. Manual flight remains unconstrained but displays the same
  telemetry.

### 0.3.3 — Drag-aware coast-impact prediction and debrief

- Put the predictor in its own module, `js/trajectory.js`, not in
  `autopilot.js`: a coast forecast belongs to whoever is flying (a manual pilot
  timing a landing burn needs it most), the autopilot stays a pure command
  layer, and the predictor must never touch the live game object.
- **One integrator, two step sizes.** `trajectory.rollout(state, dt, maxSteps,
  out)` integrates engine-off flight with the live step's order and formulas:
  gravity and drag sampled at the start of the step, semi-implicit Euler, the
  same net-acceleration clip, the same linear ground-crossing interpolation.
  Heading and mass are held, because a coasting rocket burns nothing and this
  model has no attitude dynamics. `predictCoast` calls it at the live fixed step
  (`constants.rocket.fixedStep`) under a `maxCoastSteps` budget, and the
  validation reference is the same function at about 24x finer. Sharing the code
  means a forecast and its reference can only differ by step size, never by
  model, and a test can assert that a rollout at the fixed step reproduces an
  engine-off `physics.step` flight to the last digit. A coarser step is
  tempting and worse: at 1/30 s a dense-air coast carries about 150 m of range
  error, while the live step keeps every tested state inside the 1% / 25 m
  tolerance for about 0.1 ms of work per forecast.
- **Scalars into a caller-owned record.** `trajectory.impact` carries the impact
  longitude, the touchdown velocities, the coast time, the step count, validity,
  and the wrap-aware signed error from the selected pad with two flags: the
  touchdown is inside the world's landing limits, and it is inside the target
  pad's radius. Predict once per frame from the post-physics state. A rocket on
  the ground, or a game that is not flying, publishes no forecast.
- **Horizon instead of a stale point.** `coastHorizon` (120 s) bounds the work;
  a coast that has not reached the ground by then is invalid, and the HUD says
  so rather than drawing the last good point.
- **Display.** Draw the ground marker from the viewport's periodic copy of the
  impact longitude (`coords.nearestPeriodicX`): the map shows one whole
  circumference, so a long westward coast lands "off the left edge" at a
  longitude the player can already see. Show it in manual flight as well as
  under the autopilot, label it `COAST`, and colour it by the predicted arrival
  — a delivery on the target pad, a safe landing elsewhere, or a touchdown
  outside the world's limits. Two HUD rows, `COAST IMPACT` (signed distance from
  the selected pad, or `ON TARGET PAD` / `OUT OF HORIZON`) and `COAST TOUCHDOWN`
  (the predicted vertical and horizontal rates), say plainly that this is a
  projection: the engine is assumed cut now, and a powered autopilot flight
  lands where its own guidance takes it. Do not feed the forecast into the
  guidance controller in this release; the closed-loop approach stays until a
  powered-trajectory predictor is validated separately.
- **Debrief.** Record the measured touchdown — the physics step interpolates the
  ground crossing, so the arrival velocities are already exact — and the signed
  wrap-aware error from the target pad in the flight report, and quote them
  beside the 0.3.1 peak-Q and peak-acceleration figures: `Touchdown 3.8 m/s down
  and 0.4 m/s across, 12 m from Eastport centre`, or `1.2 km west of Farport`.
  These are the numbers 0.5's hard-landing stress model tunes against.
- Report them per route as well: `envelope.js` gains touchdown V/H and pad-error
  columns plus a worst-touchdown summary, so the damage baseline is measured
  rather than assumed.
- Validate with a dedicated `experiments/trajectory-test.js` (equivalence with
  the live integrator, vacuum energy conservation, drag shortening range and
  slowing arrival, zero airspeed, the horizon, wrap longitudes, no side effects)
  and a measured `experiments/impact-accuracy.js` (states sampled from flown
  routes plus a synthetic edge grid, coarse forecast against the fine reference,
  with the per-forecast cost).

### 0.3.4 — Staging authority

The 0.3.2 random-build sweep left one clear failure class, and 0.3.3 does not
touch it: a build whose middle stage cannot hover (`T / m` below local gravity)
is flown until the tank is dry, and the dry-stage-only rule never brings the
strong upper stage in early enough. About 6% of random builds fail with no
limits at all (5% Balanced, 4% Gentle); the envelope limits only change *when*
it happens, which is where the few 0.3.2 regressions came from.

- **Stage on authority, not only on an empty tank.** The descent needs thrust
  for braking sideways and holding altitude at once — the same multiple of
  gravity the acceleration cap is never allowed to fall below
  (`minThrustToWeight`, about 1.7). A stage whose thrust acceleration cannot
  clear that multiple at *any* point in the burn it has left cannot fly the
  landing, however much fuel it still has: burning only sheds mass, so the
  figure at burnout is the most that stage will ever manage. When the next
  living stage clears it, separate now instead of flying this one dry and
  arriving with an engine that cannot stop the fall.
- **The bar is local gravity**, the same figure the guidance budgets its
  braking against, so a stage is left alone while it cruises where gravity is
  weak and is separated as the descent brings it into stronger gravity.
  Measuring the bar against surface gravity stages earlier and measurably
  breaks marginal two-stage builds on the heavy worlds; the launch gate
  already certified that the first stage can lift the rocket off the pad.
- **A stage that clears the multiple later in its burn is left to burn.** A
  heavy booster lightening as it empties is not a failure, and dropping it on
  the pad throws away fuel the rocket has not used. Every shipped reference
  route is unchanged by this rule — that is the guard against a rule that
  stages too eagerly, and it is checked against the recorded 0.3.3 routes.
- **The stage taking over must carry at least as much fuel.** An early
  separation throws the rest of the current tank away, so trading a full tank
  for a smaller one spends more propellant than the authority it buys. This is
  what separates a weak middle stage behind a strong upper one — worth the
  trade — from a two-stage build whose upper stage is the smaller tank, where
  the separation buys hover authority by discarding the range it needed.
- **Never strand the rocket.** The last stage is never dropped, and neither is
  a stage when the next one cannot take over: a separation that leaves the
  rocket on an engine that cannot hold it up is worse than the landing it was
  meant to save.
- **It is guidance behaviour, not an envelope limit.** The rule flies under
  every profile and with the limits off, and a planet can switch it off
  through `flight.stageOnAuthority`. A measurement that compares against the
  behaviour before the rule existed has to hold it back explicitly.
- **Keep the dry-stage rule and the 0.3.2 ignition-throttle behaviour.** An
  authority separation lights the next stage at the throttle the guidance
  holds, exactly as a dry one does, and a player's staging still lights it at
  full throttle.
- **Say why.** The HUD marks the frame an authority separation is commanded
  (`EARLY` beside the stage number), so the player can tell why the stage
  number changed instead of guessing.
- **Judge it with `build-sweep.js`**, which flies a `dry` baseline — limits
  off, staging only on a dry tank, the behaviour the game shipped before this
  rule existed — alongside the limits-off and both-profile variants, and
  counts flights fixed against flights broken against that baseline on the
  same seeds and build counts.

### 0.3.7 — Inter-planet sky, escape speed & the system chart

One visual layer above the atmosphere. It adds no orbital state, no second
gravity model and no change to the point-mass integrator: the same fixed-step
physics, autopilot, drag law, coast predictor, pads and economy keep flying.
What changes is what the player can see and read.

- **Sky catalog.** Put a star, two planets and two moons in `constants.sky`,
  shared by every world. Each body carries a name, a kind, a colour, an orbit
  radius in planet radii, a body radius in planet radii, a longitude as a
  fraction of the circumference, and a slow drift rate. Distances therefore
  scale with the active world's radius. Bodies are visual only in this slice:
  gravity, drag, collisions and trajectory integration remain the active
  world's inverse-square field. A body's sphere of influence is not named yet.
- **One chart for the whole system.** The game's own chart is the projection:
  a log-polar map of the plane with a single shared scale `s`,
  `x = ox + s·atan2(dx, dy)` and `y = oy − s·ladder(distance)`, measured from a
  **pivot** body's centre. One scale on both axes is the requirement, not a
  detail: a sphere is round in the plane, so its image is a lens whose width and
  height agree, and a moon thousands of radii away stays a visible shape. A
  vertical-only log altitude with an independent horizontal px/metre squashes
  every distant body into a line, so it cannot be used for this.
- **One altitude ladder.** `ladder(h) = ln(1 + h/knee)` on the planet's
  `logAltitudeScale`, and above that planet's `ladderSwitch` altitude the slope
  drops to `view.ladderFar`: `ladder(h) = q0 + (ln(1 + h/knee) − q0)·ladderFar`.
  Below the pivot's surface the ladder is a single `ln(R/d)`, which keeps the
  cutaway shallow. The knee is what spends the chart's height: a metre-scale
  knee gives the air column most of the deck and compresses the top layers, so
  distant bodies sit low over the surface instead of spreading to the top edge,
  and a body-radius knee spreads the catalog by distance ratio once the chart is
  seated on a body. The knee therefore follows the pole — planet knee while
  landed, pivot radius away — and both it and `ladderFar` are eased across a
  hand-over (`sky.view.knee`), so the curve never changes in one frame.
- **The deck map is the closed form.** With the pivot on the active world,
  `oy = groundY`, `atan2` cancels and the ladder is read straight off the
  altimeter: `y = groundY − usable·ladder(wy)/ladder(extent)` and
  `x = (wx − leftWx)·pixelsPerMeter`, one circumference per viewport. Pads,
  trails, the altitude ladder, the mouse readout and the bodies all read those
  same numbers, and forward and inverse round-trip exactly. `camera.flat`
  selects the closed form; the general form is used away from the world.
  `camera.setRangeUnits` hands the deck the damped range the lenses are drawn
  with, so the two spellings are the same scale to the last bit.
- **The charted extent includes the ship.** `sky.maxExtent` takes the farthest
  far limb of the catalog *and* the ship, and the deck's top edge is that
  extent. A rocket above the atmosphere therefore widens the ladder instead of
  leaving the top of the deck; the damped fit makes the change smooth.
- **Camera target.** The follow owns two things. Horizontally the base longitude
  keeps the ship at `view.cameraAnchorFraction`. Vertically the ground line
  holds the camera while the ship is under `camera.airTop`; above it the target
  becomes the ship, and the chart slides by `camera.trackY` so the hull sits at
  `view.followHeight` and the ground leaves the bottom exactly as far as the
  climb. The track eases back to zero on the way down. The wheel zoom is
  clamped by the ship's own ladder height, so a zoomed-in view pulls back
  rather than losing the hull.
- **Gestures.** The pointer owns `camera.panX / panY`, in screen pixels, added
  to the followed pose — a drag is one pixel per pixel and a follow never
  undoes it. The wheel scales `camera.zoom`, eased at `view.zoomTau` and clamped
  to `view.zoomMin / zoomMax`; the deck zooms about the ship and the ground
  line. A press that moves less than `view.dragSlopPx` is a click, and a click
  seats the chart on the body under the pointer (`sky.pick`), which also eases
  the zoom back to the fit. Empty space is a no-op. `js/input.js` holds all of
  it, so `index.html` and `experiments/body-hop.html` get the same controls.
- **A body is a lens, not a sprite.** With `D` the distance from the pivot,
  `rho` the body's radius and `alpha = asin(rho/D)`, each ray at offset `psi`
  inside the body's angular radius crosses the sphere twice:
  `half = sqrt(rho² − D²·sin²psi)`, `near = D·cos(psi) − half`,
  `far = D·cos(psi) + half`. Both limbs are projected through the same ladder, so
  the shape is the true silhouette and a close body gets a genuine cutaway.
  A body containing the pivot has no lens and is skipped. When the lens is
  thinner than `sky.iconRadius` the body is charted as a disc of that radius
  instead — visible and clickable without pretending a distant sphere is wide —
  and the picker uses the same radius, so what is drawn is what is hit.
- **Orbits.** A catalog body's orbit is sampled around the world's origin
  (`view.orbitSamples`) and charted by the same map: a curve in the system view,
  a level lane over the deck. Samples inside the pivot body are dropped, so the
  log pole never flings a chord across the screen, and every periodic copy that
  touches the viewport is drawn.
- **Shared-scale fit.** The farthest surface of the charted system is fitted to
  `view.chartTopFraction` of the viewport, which fixes `s`. The fit is sampled
  at `sky.fitSampleSeconds` and eases outward at `fitGrowTau` and inward at
  `fitCloseTau`, so the farthest body stays fitted without the whole chart
  breathing at the orbit period.
- **Pivot hand-over.** The chart is seated on exactly one body. Seating it on
  another is a continuous change, not a cut: the pole eases to the new body's
  centre and `s` eases with it, while the offsets `ox`, `oy` are **solved every
  frame** from an anchor so the anchor's screen position does not change. The
  anchor is the destination body's surface point nearest the ship — the point
  that is about to become the ground line. Because the anchor's angle and
  distance are read against the live pole, the chart travels underneath it and
  nothing on screen jumps. Once seated, the world the ship left is a lens like
  any other. The hand-over is view-only: it never writes `wx`, `wy` or any
  physics state.
- **Proper escape speed.** Derive the gravitational parameter from the world
  the physics already uses: `mu = surfaceGravity * radius^2`, `r = radius +
  altitude`, `v_escape(r) = sqrt(2*mu/r)`, `v_circular(r) = sqrt(mu/r)`. The
  existing `gravityAtAltitude = surfaceGravity * (radius/r)^2` is the same
  field, so the readout cannot disagree with the integrator. Quote surface and
  current-altitude escape speeds in the HUD; flag an unbound state only when
  the rocket is above the atmosphere ceiling and its speed reaches
  `v_escape(r)`. There is no escape event, no new force and no mission result.
- **The ground is a sphere, and its interior is banded.** The ground belongs to
  the body whose centre the camera's pivot is nearest (`sky.groundBody`), so a
  drag or a hand-over travels the ground — curve, cutaway and colour — from one
  body to the other instead of cutting between them. Its surface is the sphere of
  radius `camera.pivotRadius` read from that pivot, charted per column by the same
  forward-ray exit the lenses use (`sky.enclosingY`): exactly the flat ground line
  in every steady state, bending into a horizon while a gesture walks the pivot
  out toward a surface. Below it, `constants.render.cutawayBands` are concentric
  spheres at fractions of that radius, painted shallowest first in the body's own
  shade at a rising alpha. Because the ladder is a log of distance, a fraction
  *is* a depth, so the bands spread downward on screen and read as crust, mantle
  and core with no geology modelled anywhere. A band sphere the pivot is outside
  has no chartable surface — a ray from outside never exits it — so the count
  solves from the shallowest inward and stops at the first miss
  (`render.curves.bands`), and when the pivot is outside the ground sphere itself
  there is no curve at all: the ground is the flat line the solved curve tends to
  as the pivot reaches the surface, so the two regimes meet without a step.
- **Atmosphere ceiling.** Define space as the altitude where density falls to
  `constants.sky.atmosphereDensityFraction` of sea-level density: `H *
  ln(1/fraction)`, zero on an airless world. Draw that ceiling as a line, a
  translucent air band below it and the star field above it. Choose altitude
  marks from a decade ladder inside the current ceiling; never clamp several
  out-of-range labels onto the top edge.
- **Smooth transform on a gravity change.** A world switch replaces
  `surfaceGravity`, radius, scale height and log scale at the run boundary.
  Capture the outgoing `gravity`, `radius`, `atmosphereTop`, `logScale` and
  `ceiling`, then blend them to the new world's values over
  `constants.view.transformSeconds` with smoothstep while the camera range
  eases to the new targets. Physics switches at the boundary; only the view
  morphs. No tween touches the integrator, the pads, the fleet or the deck.
- **Trajectory above the atmosphere.** `js/flight-path.js` keeps a fixed-
  capacity ring of sampled `(wx, wy)` points for the flown leg. Extend
  `trajectory.rollout` with an optional caller-owned trace buffer so the same
  engine-off integration that produces the coast impact also leaves a strided
  polyline; no second rollout. Draw both paths through the camera projection,
  breaking the line at world-wrap seams and fading the older half of the flown
  trail. Nothing in the physics step allocates and the trace costs no extra
  integration work.
- **HUD.** Flight telemetry gains an `ESCAPE` row, the deck's world panel
  quotes surface escape speed, and the sky labels the atmosphere ceiling. An
  unbound high-altitude state is marked near the rocket. These are readouts,
  not a new flight mode.

### 0.3.9 — Experiment: Lagrange points & multi-body gravity (next phase)

A separate experiment phase, not part of 0.3.7's shipped slice. The question is
whether proper multi-body gravity and the visual transformations it needs can
be added without breaking the deterministic pad-to-pad game.

- Write a headless `experiments/gravity-field-experiment.js` that evaluates
  candidate gravity models against invariants the shipped physics guarantees:
  inverse-square reduction to one body, energy conservation on a coast,
  continuity across a sphere-of-influence boundary, and the existing 0.3.5
  reference-route table with the extra bodies switched off.
- Locate L1/L2/L3 from the collinear balance equations and L4/L5 from the
  triangular solution numerically; report the residuals and how the points
  move with the mass ratio. Do not hardcode a diagram.
- Compare rotating-frame / patched-conic projections and the visual
  transforms they need (zoom, rotation, parallax, body-relative log scale)
  on a fixed set of camera states. Record smoothness, wrap continuity and
  frame cost.
- Decide from those measurements whether a `js/gravity.js` module is worth
  wiring in. Until it is, the experiment is isolated from `js/physics.js`,
  the autopilot and the deck, and no L-point marker is shipped in the game.

## Files

```
js/aerodynamics.js          # new shared aerodynamic calculations
js/physics.js               # drag integration, GM / escape speed, atmo ceiling
js/autopilot.js             # envelope-aware command limits
js/trajectory.js            # coast predictor, impact record and strided trace
js/sky.js                   # body catalog, projection, adaptive view transform
js/flight-path.js           # fixed-capacity flown-trail ring buffer
js/coords.js                # forward / inverse log-radial camera transform
js/camera.js                # logScale, ceiling and their eased targets
js/planets.js               # per-world flight-envelope tuning
js/constants.js             # shared aero / guidance defaults, sky catalog
js/rocket.js                # stage ignition at a given throttle, stack thrust
js/controls.js              # autopilot staging keeps its throttle
js/builder.js               # Balanced / Gentle profile selection
js/mission.js               # profile snapshot and touchdown report metrics
js/render.js                # sky, bodies, trails, altitude marks, escape HUD
js/main.js                  # per-frame sky / trail update, smooth world switch
index.html                  # classic script order for the new helpers
css/style.css               # compact profile control if required
experiments/aerodynamics-test.js # aerodynamic formula / edge-case checks
experiments/sky-test.js      # escape speed, chart, lens projection, pivot, trace
experiments/envelope.js      # cross-planet guidance and load report
experiments/flight-test.js   # physics, touchdown report and mission regressions
experiments/trajectory-test.js # coast predictor: integrator equivalence, edges
experiments/impact-accuracy.js # forecast error and cost over many states
experiments/render-smoke-test.js # new telemetry, sky and marker paths
experiments/gravity-field-experiment.js # 0.3.9 headless L-point / gravity study
experiments/autopilot-test.js # envelope limits, profiles, staging, frame rates
experiments/harness.js       # shared flight harness and flight-quality metrics
experiments/build-sweep.js   # random builds: dry baseline, limits off, profiles
```

Keep `controls.js` as the common actuator layer unless a small command-field
change is demonstrably needed. The predictor must not call `physics.step` on
the live game object or trigger economy, staging, mission, or touchdown side
effects; it shares the integrator's formulas through the physics and
aerodynamics helpers instead.

## Tuning and validation

- Use `market-parts-plan.md`'s recorded 0.3.0 envelope as the time / altitude / fuel
  baseline and rerun the current script before changing physics. Add Q / AoA
  measurements for every directed route first; only then evaluate the new
  angle-dependent drag. Keep the on-axis drag calibration unchanged, tune
  `CdAlpha` against route data, and defer Q / AoA autopilot limits to 0.3.2
  using the recorded post-aerodynamics envelope rather than guessed caps.
- Use each planet's reference build on every directed pad-to-pad route, plus
  the existing single-stage and overbuilt cases. Extend `experiments/envelope.js`
  beyond its current home-pad-only routes so wrap direction and non-home
  departures are covered. Do not tune only Verdant or infer range from ideal
  delta-v.
- For the Balanced profile, keep every shipped reference route deliverable.
  Preserve the current short-hop pacing (about 40–60 simulated seconds) and
  keep long routes close to their measured 0.3.0 times; if aero changes move
  those envelopes materially, retune planet guidance and update the 0.4
  balance baseline before using it for price tuning.
- The Q limiter may briefly overshoot its cap because thrust and speed cannot
  change instantly. Tune for a small, short transient rather than claiming a
  hard clamp the physics cannot guarantee. Confirm that limiting Q does not
  make a rocket unable to brake, descend, or land.
- Fly the routes in the frame loop's order (one control update per frame, then
  that frame's physics budget) at several frame rates and time scales, including
  the coarsest decision step (30 fps at 4x). Measure a constraint's oscillation
  by how often its limiter switches on or off during a flight, not by the thrust
  axis crossing the airflow axis, which drifts freely at near-zero throttle.
  Compare every flight with the same flight under no limits, and sweep random
  builds, routes and frame settings: count the flights the limits fix against the
  ones they break rather than trusting the reference builds alone.
- Compare the coarse predictor against a high-resolution engine-off rollout
  for states across the four worlds. Validate wrap-around longitudes, drag,
  vacuum, zero speed, and timeout / invalid results.
- For 0.3.7, measure the sky slice against the 0.3.5 reference-route table:
  no route time, fuel figure or touchdown figure may move, because no physics
  input changes. Sweep camera range targets over ground, atmosphere ceiling,
  moon, planet and star distances on all four worlds; assert forward /
  inverse round trips, monotonic screen y, finite projections and bounded
  easing at 30, 60 and 144 fps. Compare the projected apparent radius against
  the analytic angular size for each body.
- For 0.3.9, judge the gravity experiment on its residuals and on the same
  reference routes with the extra bodies off; a model that needs a special
  case inside `physics.step` or changes a shipped route is a rejected model,
  not a tuning problem.

## Acceptance criteria

- `node experiments/aerodynamics-test.js`, `node experiments/flight-test.js`,
  `node experiments/builder-test.js`, and
  `node experiments/render-smoke-test.js` pass, along with `node
  experiments/envelope.js <planet> 0` for every shipped world.
- Dynamic pressure follows `0.5 * rho * v²`; vacuum and zero-speed cases stay
  finite; drag always opposes relative airflow; aligned drag matches the 0.3.0
  baseline; broadside attitude increases drag; no aerodynamic work allocates
  objects in the physics step. Peak AoA measurements include their concurrent
  Q, and airless-world AoA is not presented as an atmospheric load.
- The Balanced autopilot delivers every reference-build route on all four
  planets. The Gentle profile produces a measurably lower peak envelope
  without losing the ability to brake and land safely. Q / acceleration / AoA
  constraints are visible and do not oscillate or command impossible thrust.
- Manual steering, manual staging, autopilot handoff, the fuel reserve,
  touchdown adjudication, and the 0.5x–4x fixed-step time-scale behavior do
  not regress. Re-run guidance tests at different render frame rates / time
  scales, not just physics-only tests.
- The coast-impact marker agrees with high-resolution engine-off rollouts
  within one percent of predicted horizontal range (with a 25 m minimum
  tolerance) for tested in-horizon states, and a rollout at the live fixed step
  reproduces an engine-off `physics.step` flight exactly. It is hidden / marked
  invalid when the horizon is exceeded, drawn from the periodic copy of its
  longitude so a wrap-around coast stays on screen, and shown to a manual pilot
  as well as to the autopilot. A forecast costs a small fraction of a frame.
- Flight reports show measured rather than estimated touchdown speeds, signed
  target error, peak Q, and peak thrust acceleration, and `envelope.js` reports
  the same touchdown figures per route as the 0.5 damage baseline. No failure or
  repair behavior is added; those remain part of 0.5.
- Staging on authority delivers every reference-build route on all four
  planets, under both profiles and with the limits off, with the same times,
  fuel left and touchdown figures the 0.3.3 routes recorded — the rule never
  fires on a shipped build. A stage that cannot hover at any point in its
  remaining burn is separated when a later stage carrying at least as much
  fuel can take over, the last stage is never dropped, a stage whose successor
  cannot take over is never dropped, and the dry-stage rule and the ignition
  throttle are unchanged. `build-sweep.js` reports the rule as flights fixed against flights broken against its `dry`
  baseline, and the trade is judged on that ratio rather than on the reference
  builds alone.
- `node experiments/sky-test.js` and `node experiments/chart-test.js` pass.
  The deck's extent is the farthest far limb, the deck and the lens law agree on
  a body's height, a drag pans one pixel per pixel, a click seats the chart on
  the body under the pointer, the seated body is not a pick, the wheel zoom is
  clamped and keeps the ship on its anchor, and the cursor reports a pickable
  body. Escape speed is `sqrt(2*g0*R^2/r)`
  on every world and decreases with altitude; an airless world reports a zero
  atmosphere ceiling; `coords` round trips hold at every eased `logScale` and
  `ceiling` in both the closed-form and general spellings of the chart; every
  catalog body is a lens whose limbs meet at the lens edges and whose near limb
  is `D − rho`; a pivot hand-over holds its anchor to 0.001 px across at least
  ten frames in both directions; the coast trace matches the rollout it came
  from.
- The chart, flown trail, coast trace, altitude marks, atmosphere ceiling,
  star, moons and planets draw on every world and at narrow viewports without
  per-frame allocations; the deck layout is unchanged because its map is the
  closed form of the chart. A world switch morphs the view over
  its configured seconds; no physics value, pad longitude, route, price or
  flight report changes. The 0.3.5 reference-route table still matches.

## Deliberately deferred

- Lift, fins, aerodynamic stability / moments, gimbals, changing rocket
  geometry, heating, Mach effects, wind, and turbulence require additional
  physical or build data and are not part of this point-mass model.
- Fairing drag modifiers, part wear, structural failure, repair, contracts,
  and economy remain in 0.4–0.5; 0.3.x only exposes a stable aerodynamic
  interface and flight-load measurements for them.
- Prograde / retrograde / surface-up manual attitude holds are a plausible
  small follow-up inspired by Smart A.S.S., but are not needed while mouse
  aiming is direct and the autopilot can be toggled. Do not add orbital
  attitude modes or KSP-specific trajectory planners to this release line.
- Real multi-body gravity, spheres of influence, Lagrange points, patched
  conics, rotating-frame projections and body-relative visual transforms are
  the 0.3.9 experiment, not part of the 0.3.7/0.3.8 visual chart. 0.3.7 draws bodies
  from orbit geometry and reads escape speed from the active world's GM, but
  applies no force from them.
- A builder warning for a stack whose later stages cannot hold the rocket up.
  The launch gate only certifies the first stage, so a build can still be flown
  whose last stage cannot land it; 0.3.4 leaves those to fail in flight, and
  0.4's builder rework is the natural place to name them before launch.
