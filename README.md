# Ascension Rush: Payload Delivery

A small 2D rocket-delivery game: wrap-around planets, staged rockets, manual
flight or autopilot, pad-to-pad delivery, fuel/hull/payload economics, and a
logarithmic altitude view. Persistent parts, damage and a rival company are
planned follow-ups.

## Status
The 0.1 world/render scaffold, the 0.2 playable flight slice, the 0.3
autopilot + planet presets, the 0.3.1 aerodynamic envelope and load
measurements, the 0.3.2 flight-envelope autopilot, the 0.3.3 coast-impact
prediction and debrief, and the 0.3.4 staging-authority rule are implemented.
Pick a world from the boot menu, configure a one-to-three-stage rocket against
that world's reference build, launch, and either fly it by hand (mouse aiming,
Shift/Ctrl throttle, Space staging, no limits) or hand it to the autopilot in
the builder. The autopilot flies a **Balanced** or **Gentle** profile: it fades
forward thrust as dynamic pressure nears the world's cap, caps its thrust
acceleration, keeps an angle-of-attack backstop, and the flight HUD names the
limit that is holding it back. It also stages on authority: a stage whose
thrust cannot hold the rocket up for the burn it has left is separated as soon
as a later stage carrying at least as much fuel can, rather than flown dry and
landed with an engine that cannot stop the descent — the HUD marks that frame
`EARLY`, and a shipped reference route never triggers it. In flight a `COAST`
marker on the ground forecasts where the drag-aware, engine-off trajectory
reaches the surface — coloured by whether that arrival would deliver, land
safely elsewhere, or break the world's touchdown limits — with two HUD rows
quoting the distance from the selected pad and the predicted arrival speeds.
The debrief reports the measured touchdown speeds and pad error alongside peak
Q and peak thrust acceleration.
`[` and `]` move a `0.5x–4x` time scale. Flights are sized for 20–30 s of real
time at the default `2x`. Economy is still prototype balance; parts, wear and
failures are not implemented yet.

## Plans (subject-numbered, not version sequence)
Active:
- [`0.3.5-plan.md`](./0.3.5-plan.md) — Autopilot operations deck: pad-to-pad dispatch, return flights, fleet availability, flight logs, and reusable automatic routes.
- [`0.4-plan.md`](./0.4-plan.md) — Economy balance, parts catalog with service/repair, market prices & contract board.
- [`0.5-plan.md`](./0.5-plan.md) — Damage/failures mid-flight and landing, competitor company AI.

Implemented, kept in `archive/` next to their worklogs (the completed 0.3.x
umbrella plan remains at the repository root):
- [`0.3.x-plan.md`](./0.3.x-plan.md) — Aerodynamics, Q / acceleration-aware autopilot, drag-aware impact prediction, flight diagnostics, and staging authority (0.3.1–0.3.4).
- [`archive/0.1.0-plan.md`](./archive/0.1.0-plan.md) — World, canvas scaffold, log-Y wrap-X planet, launch pads, triangle rocket.
- [`archive/0.2.0-plan.md`](./archive/0.2.0-plan.md) — Rocket physics, stage builder, manual flight controls, time scale, first-pass economy & landing.
- [`archive/0.3.0-plan.md`](./archive/0.3.0-plan.md) — Autopilot (pad-to-pad + landing) and planet presets (gravity / atmo / size / reference build).
- [`archive/0.3.3-worklog.md`](./archive/0.3.3-worklog.md), [`archive/0.3.4-worklog.md`](./archive/0.3.4-worklog.md) — the 0.3.x follow-ups: aero loads, envelope autopilot, coast-impact prediction and debrief, staging authority.

Original draft is preserved verbatim in
[`archive/0.1.0-draft.md`](./archive/0.1.0-draft.md).

See [`AGENTS.md`](./AGENTS.md) for code-style and workflow conventions.

## Run
Open `index.html` in a modern browser (no build step; classic `<script>`
tags, `file://`-friendly). Node smoke/regression tests:

```sh
node experiments/coords-test.js
node experiments/aerodynamics-test.js
node experiments/flight-test.js
node experiments/builder-test.js
node experiments/render-smoke-test.js
node experiments/autopilot-test.js         # envelope limits, profiles, staging, frame rates
node experiments/trajectory-test.js        # coast predictor: integrator equivalence, edges
node experiments/envelope.js verdant 0     # flight envelope per planet/build
node experiments/envelope.js cinder 0 gentle 30 4   # profile (or `off`), fps, time scale
node experiments/build-sweep.js 300 1      # random builds: dry baseline vs limits off and profiles
node experiments/impact-accuracy.js 12 7   # coast-forecast error and cost per state
```

Measurement scripts share `experiments/harness.js`; their recorded output is in
`experiments/logs/`.
