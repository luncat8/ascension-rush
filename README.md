# Ascension Rush: Payload Delivery

A small 2D rocket-delivery game. Wrap-around planet, launch pads,
staged rockets, pad-to-pad flight, fuel/hull/payload economics,
autopilot, planet presets, part wear & failures, and a rival company.

## Status
In planning. No playable build yet.

## Plans (subject-numbered, not version sequence)
- [`0.1-plan.md`](./0.1-plan.md) — World, canvas scaffold, log-Y wrap-X planet, launch pads, triangle rocket sprite.
- [`0.2-plan.md`](./0.2-plan.md) — Rocket physics, stage builder, manual flight controls, first-pass economy & landing.
- [`0.3-plan.md`](./0.3-plan.md) — Autopilot (pad-to-pad + landing) and planet presets (gravity / atmo / size).
- [`0.4-plan.md`](./0.4-plan.md) — Economy balance, parts catalog with service/repair, market prices & contract board.
- [`0.5-plan.md`](./0.5-plan.md) — Damage/failures mid-flight and landing, competitor company AI.

Original draft is preserved verbatim in
[`archive/0.1.0-draft.md`](./archive/0.1.0-draft.md).

See [`AGENTS.md`](./AGENTS.md) for code-style and workflow conventions.

## Run
Open `index.html` in a modern browser (no build step; classic `<script>`
tags, `file://`-friendly). `experiments/` contains node-runnable
measurement scripts used for tuning.
