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
	//     y = oy − s · ln(distance)
	//
	// Both axes carry the same pixels per e-fold of radius. That is the whole
	// point: a sphere is round in the plane, so its image is a lens whose width
	// and height agree in scale, and a body thousands of radii away is still a
	// visible lens instead of a one-pixel line.
	//
	// With the pivot on the active world this reduces exactly to the deck's
	// own map: `oy = groundY + s·ln(ref)` puts the surface on the ground line,
	// and `atan2` cancels to the plain angle, so
	//
	//     y = groundY − s · ln(1 + wy / ref)      x = ox + s · wx / ref
	//
	// which is the wrap-X / log-Y chart with the body's radius as the log knee.
	// Nothing is bolted on: the deck view *is* the log-polar chart.
	// The camera owns the projection state. `flat` selects the closed-form
	// rectilinear view of this same map, used while the pivot is the active
	// world; otherwise the general log-polar form is used.

	coords.worldToScreen = function(wx, wy, camera, out) {
		var planeX;
		var planeY;
		var angle;
		var distance;

		if (camera.flat) {
			// The rectilinear form of the same map: one wrap across the
			// viewport and the log ladder up it.
			out.x = (wx - camera.leftWx) * camera.pixelsPerMeterX;
			out.y = camera.groundY - camera.usableHeight *
				Math.log1p(R.util.clamp(wy, 0, camera.ceiling) / camera.logScale) /
				camera.altitudeLogRange;
			return out;
		}
		// The world point is placed in the plane at its own radius from the
		// world's centre, then measured against the pivot.
		planeX = (camera.worldRadius + Math.max(0, wy)) * Math.sin(wx / camera.worldRadius) - camera.pivotX;
		planeY = (camera.worldRadius + Math.max(0, wy)) * Math.cos(wx / camera.worldRadius) - camera.pivotY;
		angle = Math.atan2(planeX, planeY);
		distance = Math.max(1e-9, Math.sqrt(planeX * planeX + planeY * planeY));
		out.x = camera.ox + camera.scalePx * angle;
		out.y = camera.oy - camera.scalePx * Math.log(distance);
		return out;
	};

	coords.screenToWorld = function(sx, sy, camera, out) {
		var angle;
		var distance;
		var planeX;
		var planeY;

		if (camera.flat) {
			out.x = camera.leftWx + sx / camera.pixelsPerMeterX;
			out.y = camera.logScale * Math.expm1(
				(camera.groundY - sy) * camera.altitudeLogRange / camera.usableHeight);
			out.y = R.util.clamp(out.y, 0, camera.ceiling);
			return out;
		}
		// Chart -> plane point relative to the pivot, then back to a world
		// radius from the world's centre. This is the exact inverse above.
		angle = (sx - camera.ox) / camera.scalePx;
		distance = Math.exp((camera.oy - sy) / camera.scalePx);
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
