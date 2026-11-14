# Orbital flight

- Replaced flat horizontal integration with a shared tangent/radial step on the active world's spherical geometry. Velocities are physical local components and longitude remains unbounded surface arc length.
- Derived catalog orbit rates from the active world's gravitational parameter. Catalog bodies remain massless visual test particles; the fixed star remains a light source.
- Updated the coast rollout and delivery guidance for spherical motion, including fairing drag in the forecast and a suborbital delivery speed cap.
- Added orbit, escape, catalog-clock, time-warp and reference delivery coverage. Updated flight and trajectory tests whose flat-world assumptions no longer apply.
- Validation: `node experiments/orbit-test.js`, `trajectory-test.js`, `flight-test.js`, `sky-test.js`, `chart-test.js`, `render-smoke-test.js`, `competitor-test.js`, `damage-test.js` and `service-test.js` pass. Reference Farport hops deliver on all four worlds; Tinmoon's takes about 318 simulation seconds. `impact-accuracy.js` scored 1,583 states with none outside tolerance.
- The full test sweep still has three failures: `autopilot-test.js` probes forward thrust at speeds above the new delivery speed cap; `operations-test.js` assumes the reference long hop sheds a stage; and `campaign-test.js` compares against logs from the old flight model. These fixtures and the economy/campaign balance need remeasurement rather than treating old flight outcomes as invariants.

Next: rebenchmark delivery profiles, stage replacement and campaign economics for spherical flights, then implement and validate a coherent multi-body model before allowing landings on catalog bodies.
