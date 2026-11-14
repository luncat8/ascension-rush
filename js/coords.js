(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var coords = R.coords || (R.coords = {});
	var TWO_PI = Math.PI * 2;
	var plane = { x: 0, y: 0 };

	// The chart is ONE log-polar map of the system plane, read from a pole.
	//
	//     angle    a = atan2(px − poleX, py − poleY)
	//     distance d = |p − pole|
	//     depth    u = d ≥ r0 ? ladder(d − r0) : −ln(r0 / d)
	//
	//     x = ox + angularScale · a
	//     y = oy − scale · u          with  oy = originY + scale · u(target)
	//
	// `r0` (`camera.ladderRef`) is the distance from the pole where the ladder
	// starts: the pivot body's radius while the pole is its centre, so the
	// ladder reads as altitude above that surface, and zero once the pole stands
	// on a surface or floats in free space. `target` (`camera.targetDistance`)
	// is the camera target's own distance from the pole, and it is what the
	// origin line holds: the pivot's surface while the ground is the target, the
	// ship's own distance once it is above the air. That single substitution is
	// the whole "the ship becomes the centre of the scale" behaviour — the ship
	// stays on its line and the ground sinks below it by exactly the climb.
	//
	// Bodies, orbits, trails, pads, the atmosphere and the cutaway are all
	// placed by those three lines, so nothing is a sprite in a second
	// projection and a pick can only agree with a drawing.
	//
	// The ladder is a log on a knee with a gentler slope beyond a switch
	// altitude. The knee is what spends the chart's height: a metre-scale knee
	// gives the air column most of the deck and compresses everything above it,
	// so distant bodies sit low over the horizon instead of stacking at the top
	// edge; a body-radius knee spreads the catalog by distance ratio instead.
	// Below the ladder's start the depth is a single log, which keeps a cutaway
	// shallow and makes the surface the origin in both directions.

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

	// The same law against an arbitrary ladder, so the fit can be solved for a
	// pole and a knee the chart is travelling to rather than only the one it is
	// drawing with.
	coords.depthWith = function(distance, ladderRef, knee, q0, far) {
		var delta = distance - ladderRef;

		if (delta >= 0) {
			return coords.ladderOf(delta, knee, q0, far);
		}
		if (ladderRef <= 0) {
			return 0;
		}
		return -Math.log(ladderRef / Math.max(1e-9, distance));
	};

	coords.distanceWith = function(depth, ladderRef, knee, q0, far) {
		if (depth >= 0) {
			return ladderRef + coords.unladder(depth, knee, q0, far);
		}
		return ladderRef * Math.exp(R.util.clamp(depth, -640, 0));
	};

	coords.depthOf = function(distance, camera) {
		return coords.depthWith(distance, camera.ladderRef,
			camera.logScale, camera.ladderQ0, camera.ladderFar);
	};

	coords.distanceAt = function(depth, camera) {
		return coords.distanceWith(depth, camera.ladderRef,
			camera.logScale, camera.ladderQ0, camera.ladderFar);
	};

	// A world state (wx along the surface, wy above it) is a plane point at the
	// active world's radius. The catalog lives in the same frame, angle 0 due
	// north of longitude zero, so one plane holds the ship and every body.
	coords.planeOfWorld = function(wx, wy, worldRadius, out) {
		var radius = Math.max(1e-6, worldRadius + Math.max(0, wy || 0));
		var angle = (wx || 0) / worldRadius;

		out.x = radius * Math.sin(angle);
		out.y = radius * Math.cos(angle);
		return out;
	};

	coords.worldOfPlane = function(px, py, worldRadius, out) {
		out.x = Math.atan2(px, py) * worldRadius;
		out.y = Math.sqrt(px * px + py * py) - worldRadius;
		return out;
	};

	coords.planeToScreen = function(px, py, camera, out) {
		var dx = px - camera.poleX;
		var dy = py - camera.poleY;

		out.x = camera.ox + camera.angularScale * Math.atan2(dx, dy);
		out.y = camera.oy - camera.scale * coords.depthOf(Math.sqrt(dx * dx + dy * dy), camera);
		return out;
	};

	coords.screenToPlane = function(sx, sy, camera, out) {
		var angle = (sx - camera.ox) / Math.max(1e-9, camera.angularScale);
		var distance = coords.distanceAt((camera.oy - sy) / Math.max(1e-9, camera.scale), camera);

		out.x = camera.poleX + distance * Math.sin(angle);
		out.y = camera.poleY + distance * Math.cos(angle);
		return out;
	};

	coords.worldToScreen = function(wx, wy, camera, out) {
		coords.planeOfWorld(wx, wy, camera.worldRadius, plane);
		return coords.planeToScreen(plane.x, plane.y, camera, out);
	};

	coords.screenToWorld = function(sx, sy, camera, out) {
		coords.screenToPlane(sx, sy, camera, plane);
		return coords.worldOfPlane(plane.x, plane.y, camera.worldRadius, out);
	};

	// The chart is a cylinder: X is an angle, so everything repeats every
	// `period` pixels and a curve is drawn in every lap that touches the
	// viewport. This puts one screen x in the lap nearest `refX` — a polyline
	// passes its previous point, a body passes the anchor, and the seam becomes
	// an exact period translate instead of a jump across the screen.
	coords.wrapScreenX = function(sx, refX, period) {
		if (!(period > 0)) {
			return sx;
		}
		return sx - period * Math.round((sx - refX) / period);
	};

	// Laps either side of one x that cover `width`, so a draw loop covers the
	// wrap without guessing a copy count.
	coords.lapSpan = function(period, width) {
		return period > 0 ? Math.ceil(width * 0.5 / period) + 1 : 0;
	};

	coords.periodOf = function(angularScale) {
		return TWO_PI * Math.max(1e-9, angularScale);
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = coords;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
