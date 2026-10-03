# Ascension Rush: Payload Delivery

A small 2D rocket-delivery game: wrap-around planets, staged rockets, manual
flight or autopilot, pad-to-pad delivery, fuel/hull/payload economics, and a
logarithmic altitude view. Persistent parts, damage and a rival company are
planned follow-ups.

## Status
The 0.1 world/render scaffold, the 0.2 playable flight slice, the 0.3
autopilot + planet presets, and the 0.3.1 aerodynamic envelope and load
measurements are implemented. Pick a world from the boot menu,
configure a one-to-three-stage rocket against that world's reference build,
launch, and either fly it by hand (mouse aiming, Shift/Ctrl throttle, Space
staging) or hand it to the autopilot. `[` and `]` move a `0.5x–4x` time scale.
Flights are sized for 20–30 s of real time at the default `2x`. Economy is
still prototype balance; parts, wear and failures are not implemented yet.

## Plans (subject-numbered, not version sequence)
Active:
- [`0.3.x-plan.md`](./0.3.x-plan.md) — Aerodynamics, Q / acceleration-aware autopilot, drag-aware impact prediction & flight diagnostics.
- [`0.4-plan.md`](./0.4-plan.md) — Economy balance, parts catalog with service/repair, market prices & contract board.
- [`0.5-plan.md`](./0.5-plan.md) — Damage/failures mid-flight and landing, competitor company AI.

Implemented, kept in `archive/` next to their worklogs:
- [`archive/0.1.0-plan.md`](./archive/0.1.0-plan.md) — World, canvas scaffold, log-Y wrap-X planet, launch pads, triangle rocket.
- [`archive/0.2.0-plan.md`](./archive/0.2.0-plan.md) — Rocket physics, stage builder, manual flight controls, time scale, first-pass economy & landing.
- [`archive/0.3.0-plan.md`](./archive/0.3.0-plan.md) — Autopilot (pad-to-pad + landing) and planet presets (gravity / atmo / size / reference build).

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
node experiments/envelope.js verdant 0     # flight envelope per planet/build
```
