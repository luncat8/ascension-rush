(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var coords = R.coords || (R.coords = {});

	// The chart is the log-polar plane seen from one pivot body.
	//
	// A world state (wx, wy) sits in the plane at `angle = wx / ref` and
	// `radius = ref + wy`, measured from the pivot body's centre, where `ref`
	// is that body's radius. The chart then uses ONE scale `s` for both axes:
	//
	//     x = ox + s · atan2(dx, dy)
	//     y = oy − s · ladder(d − ref)                (d ≥ ref, above)
	//     y = oy + s · log(ref / d)                   (d < ref, below)
	//
	// `ladder` is the altitude ladder below: a log on the planet's knee, with a
	// gentler slope above the switch altitude so the top layers share the chart
	// instead of stretching it. Above the switch a distant body sits low over
	// the surface while the atmosphere keeps full resolution.
	//
	// With the pivot on the active world the polar form reduces exactly to the
	// deck's closed form: `oy = groundY` puts the surface on the ground line,
	// atan2 cancels, and the ladder is read straight off the altimeter,
	//
	//     y = groundY − usable · ladder(wy) / range
	//
	// with `range = ladder(chartedExtent)`. The deck writes that in closed form
	// (X as arc length, Y as the ladder scaled to the charted extent) so the
	// common case costs no trigonometry; both spellings agree on every
	// altitude, and the bodies are charted by the same curve the ship flies on.

	// One log ladder: `knee` is the altitude where it stops being close to
	// linear, `q0` the log altitude of the switch, `far` the slope beyond it.
	// `q0` of 0 means a plain log with no far-field compression.
	coords.ladderOf = function(height, knee, q0, far) {
		var q = Math.log1p(Math.max(0, height) / Math.max(1e-3, knee));

		return q <= q0 ? q : q0 + (q - q0) * far;
	};

	// The exact inverse of ladderOf.
	coords.unladder = function(u, knee, q0, far) {
		var q = u <= q0 ? u : q0 + (u - q0) / Math.max(1e-3, far);

		return Math.max(1e-3, knee) * Math.expm1(R.util.clamp(q, 0, 700));
	};

	coords.ladder = function(height, camera) {
		return coords.ladderOf(height, camera.logScale, camera.ladderQ0, camera.ladderFar);
	};

	coords.worldToScreen = function(wx, wy, camera, out) {
		var planeX;
		var planeY;
		var angle;
		var distance;
		var altitude;

		if (camera.flat) {
			out.x = (wx - camera.leftWx) * camera.pixelsPerMeterX;
			altitude = R.util.clamp(wy, 0, camera.ceiling);
			// Clamped again after the division so the surface lands exactly on
			// the ground line and the charted extent exactly on the top edge.
			out.y = camera.groundY - camera.usableHeight * R.util.clamp(
				coords.ladder(altitude, camera) / camera.altitudeLogRange, 0, 1);
			return out;
		}
		planeX = (camera.worldRadius + Math.max(0, wy)) * Math.sin(wx / camera.worldRadius) - camera.pivotX;
		planeY = (camera.worldRadius + Math.max(0, wy)) * Math.cos(wx / camera.worldRadius) - camera.pivotY;
		angle = Math.atan2(planeX, planeY);
		distance = Math.max(1e-9, Math.sqrt(planeX * planeX + planeY * planeY));
		out.x = camera.ox + camera.scalePx * angle;
		out.y = distance >= camera.pivotRadius ?
			camera.oy - camera.scalePx * coords.ladderOf(distance - camera.pivotRadius,
				camera.logScale, camera.ladderQ0, camera.ladderFar) :
			camera.oy + camera.scalePx * Math.log(camera.pivotRadius / distance);
		return out;
	};

	coords.screenToWorld = function(sx, sy, camera, out) {
		var angle;
		var distance;
		var planeX;
		var planeY;
		var u;

		if (camera.flat) {
			out.x = camera.leftWx + sx / camera.pixelsPerMeterX;
			u = (camera.groundY - sy) * camera.altitudeLogRange / Math.max(1e-9, camera.usableHeight);
			out.y = R.util.clamp(coords.unladder(R.util.clamp(u, 0, camera.altitudeLogRange + 1),
				camera.logScale, camera.ladderQ0, camera.ladderFar), 0, camera.ceiling);
			return out;
		}
		// Chart -> plane point relative to the pivot, then back to a world
		// radius from the world's centre. This is the exact inverse above.
		angle = (sx - camera.ox) / camera.scalePx;
		u = (camera.oy - sy) / camera.scalePx;
		if (u >= 0) {
			distance = camera.pivotRadius + coords.unladder(Math.min(u, 640),
				camera.logScale, camera.ladderQ0, camera.ladderFar);
		} else {
			distance = camera.pivotRadius * Math.exp(u);
		}
		planeX = camera.pivotX + distance * Math.sin(angle);
		planeY = camera.pivotY + distance * Math.cos(angle);
		out.x = Math.atan2(planeX, planeY) * camera.worldRadius;
		out.y = R.util.clamp(Math.sqrt(planeX * planeX + planeY * planeY) - camera.worldRadius,
			0, camera.ceiling);
		return out;
	};

	// Wrap a longitude into the viewport starting at leftWx.
	coords.nearestPeriodicX = function(wx, leftWx, circumference) {
		return leftWx + R.util.mod(wx - leftWx, circumference);
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = coords;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
