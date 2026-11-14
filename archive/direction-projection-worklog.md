# Direction-lock projection

- Replaced the rigid rotation of the chart with an eased body-to-rocket log-polar pole. In space it sits just behind the rocket along the locked direction, so rear bearings wrap around the chart instead of falling below a rotated horizon.
- Kept the surface chart and underground band near the body, aligned the rocket, flight guides and mouse aim to the selected direction, and removed the automatic interior overlay.
- Validated with `node experiments/view-mode-test.js`, `node experiments/render-smoke-test.js`, and `git diff --check`. The view test covers forward and rear bearings, inverse projection, hand-offs and body picking.

Next: design a separately controlled rocket-interior view and visually tune the pole offset and transition in flight.

## Forward-sightline correction

- Direction-lock charts now show at most one full angular turn across the viewport. The prior space scale could show multiple copies of the same body, including a rearward body near the forward sightline.
- Added a regression checking that the world behind an outward-pointing rocket stays at the chart seam and cannot repeat at the centre. View-mode and render smoke tests pass.
- Near the surface the pole is still body-centred during the ease, so a centred object is not yet a precise rocket-relative bearing when the locked direction is not surface-up. A complete fix requires reconciling the flat surface with rocket-relative bearing during the blend.
