# Findings, pitfalls & useful techniques

- Keep flight `wx` unbounded; store pad longitudes canonically and use positive modulo for their periodic screen copies. JavaScript `%` is a remainder, not mathematical modulo, for negative inputs.
- At a viewport that spans a whole planet circumference, a physical rocket's horizontal dimensions are sub-pixel. Draw its orientation as a small screen-space glyph while projecting its world position; do not distort it through the world transform.
- Keep the surface line fixed at the top of the soil strip when using an absolute logarithmic altitude map. A vertical camera translation would move the ground strip and invalidate the inverse mapping.
- Aim the flight-control nose from the rocket's screen-space position to the cursor; unprojecting through log-Y makes mouse angles disagree with the visible heading glyph. Use that heading as the world thrust vector, and retain the fixed-step integrator in world units.
- Landing tolerances must account for the wrap-map's horizontal compression. On a 1,000 km circumference shown one-to-one across the viewport, a 50 m pad radius is effectively invisible; choose and render a kilometer-scale gameplay radius or add zoom before tightening it.
- Compare a builder's Tsiolkovsky readout with the ideal staged rocket equation, not with flight delta-v after gravity and drag losses. Full mission range depends on the player's steering and coast/burn profile.
