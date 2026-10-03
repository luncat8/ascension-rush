# Findings, pitfalls & useful techniques

- Keep flight `wx` unbounded; store pad longitudes canonically and use positive modulo for their periodic screen copies. JavaScript `%` is a remainder, not mathematical modulo, for negative inputs.
- At a viewport that spans a whole planet circumference, a physical rocket's horizontal dimensions are sub-pixel. Draw its orientation as a small screen-space glyph while projecting its world position; do not distort it through the world transform.
- Keep the surface line fixed at the top of the soil strip when using an absolute logarithmic altitude map. A vertical camera translation would move the ground strip and invalidate the inverse mapping.
