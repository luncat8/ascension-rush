# Ascension Rush: Payload Delivery

A small 2D rocket-delivery game: wrap-around planets, staged rockets, manual
flight controls, pad-to-pad delivery, fuel/hull/payload economics, and a
logarithmic altitude view. Autopilot, planet presets, persistent parts, damage,
and a rival company are planned follow-ups.

## Status
The 0.1 world/render scaffold and 0.2 playable flight slice are implemented.
Configure a one-to-three-stage rocket, choose a pad, launch, steer with the
mouse, manage throttle/staging, and attempt a safe delivery. The current
physics and economy are prototype balance values; autopilot and detailed part
wear/failure are not implemented yet.

## Plans (subject-numbered, not version sequence)
- [`0.1-plan.md`](./0.1-plan.md) — World, canvas scaffold, log-Y wrap-X planet, launch pads, triangle rocket.
- [`0.2-plan.md`](./0.2-plan.md) — Rocket physics, stage builder, manual flight controls, first-pass economy & landing.
- [`0.3-plan.md`](./0.3-plan.md) — Autopilot (pad-to-pad + landing) and planet presets (gravity / atmo / size).
- [`0.4-plan.md`](./0.4-plan.md) — Economy balance, parts catalog with service/repair, market prices & contract board.
- [`0.5-plan.md`](./0.5-plan.md) — Damage/failures mid-flight and landing, competitor company AI.

Original draft is preserved verbatim in
[`archive/0.1.0-draft.md`](./archive/0.1.0-draft.md).

See [`AGENTS.md`](./AGENTS.md) for code-style and workflow conventions.

## Run
Open `index.html` in a modern browser (no build step; classic `<script>`
tags, `file://`-friendly). Node smoke/regression tests:

```sh
node experiments/coords-test.js
node experiments/flight-test.js
node experiments/builder-test.js
node experiments/render-smoke-test.js
```
