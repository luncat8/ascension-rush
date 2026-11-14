# View scale control — worklog

Plan: the "View scale control" section of `flight-sky-plan.md`.

## Steps

- `constants.view.modes` + `sky.setMode`; selector in the top bar and key `V`
  (`controls.setViewMode`).
- `coords.flatToScreen / screenToFlat`, `camera.flat`, `camera.setFlat`, a
  per-view wheel band (`camera.setZoomBand`) and a geometric zoom ease.
- `sky.js`: `solveFlat` (real-scale auto-fit, nearest-surface pole with travel
  on a swap), bodies and orbits as geometrically sampled circles
  (`sampleCircle`), `sky.airRing`.
- `render.js`: `curves.flat` skips the ground curve; ring path, real night
  side, air ring, surface-frame pads and coast marker, bar / ring rulers.
- `body` view: pole held at the influence body's centre; star hand-over beyond
  `worldDepartRadii`, back inside `worldApproachRadii`.
- Fixed while here: orbit polylines were wrapped to their previous sample
  *after* the lap offset, which folded every lap onto the first, so on the
  deck an orbit line covered one period from the pole's column instead of the
  whole viewport.

## Validation

- New `experiments/view-mode-test.js` passes; `render-smoke-test.js` draws
  both flat views at 0 m, 3 km and 23 radii through the finite-argument stub
  and the body view above the air.
- Pictures of each view were rendered through the real renderer into a
  software canvas (landed, 3 km, 8 R, 23 R beside Lune, zoomed out to the
  system) and read by eye.
- Suites: 17 pass. `autopilot-test`, `campaign-test` and `operations-test`
  fail exactly as before this change — they still assume the flight speeds
  from before the spherical-physics correction.

## Next step

Rebalance the three failing suites against the spherical-world physics; then
drag-pan / focus-on-body for the flat views.
