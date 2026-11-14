# Worklog — Prograde and nose-locked rocket views

## Steps

- Added separate `prograde` and `nose` modes on the body-centred log-polar chart. Both keep the rocket near the lower centre; prograde rolls with velocity, while nose lock rolls with rocket attitude. Prograde falls back to the nose at rest, where velocity has no defined direction.
- Kept mouse aim consistent with the currently locked axis; pointer readout and body picking inverse-transform screen coordinates before reading the shared projection.
- Made `body`, `prograde` and `nose` automatically select the rocket's local visual body; a click-made seat from `ship` is not sticky. Catalog hand-offs are geometric reach bands, not gravity calculations, because catalog bodies do not yet exert force.
- Strengthened `real-log` coverage: the nearest-body hand-off is checked on either side of the equal-surface-clearance boundary, then followed through its eased settle. Prograde mode also checks body-to-star and return hand-overs with the rocket pinned on screen.

## Validation

- `node experiments/view-mode-test.js`
- `node experiments/render-smoke-test.js`
- `node experiments/sky-test.js`
- `node experiments/coords-test.js`
- `node experiments/chart-test.js`
- `node experiments/flight-test.js`
- `node experiments/trajectory-test.js`
- `node experiments/test-mode-test.js`
- Investigated the unrelated `autopilot-test.js` failure: its Q-fade probe is already overspeeding at 800 m and 310–350 m/s (Verdant's target there is capped at 0.7 circular speed, about 111 m/s), so guidance commands braking thrust. Braking is deliberately not Q-faded; the assertion expects forward-thrust fade from a braking state. Neither autopilot code nor that test was changed for this view work.

## Next step

Review both direction locks in a live flight, especially the nose fallback when speed is near zero. Keep physical sphere-of-influence selection separate until catalog masses and multi-body forces exist.
