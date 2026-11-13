(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var sky = R.sky || (R.sky = {});
	var settings = R.constants.sky;
	var viewSettings = R.constants.view;
	var bodies = settings.bodies;
	var TWO_PI = Math.PI * 2;
	var SAMPLES = settings.outlineSamples;

	// The chart's pivot is the body whose surface is the ground line. `-1` is
	// the active world. Everything else in the catalog is a body of the same
	// plane, drawn as the lens its sphere casts on the chart.
	var view = {
		planetId: '',
		logScale: 0,
		ceiling: 0,
		gravity: 0,
		radius: 0,
		atmosphereTop: 0,
		morph: 1,
		from: { gravity: 0, radius: 0 }
	};

	// Live pivot. A re-seat moves `index` and lets the camera follow, so the
	// chart's pole walks from one body's centre to the next while every plane
	// point keeps its place. The surface that was the ground becomes a lens;
	// the lens that was a body becomes the ground.
	var pivot = {
		index: -1,
		previousIndex: -1,
		reseating: false,
		morph: 1,
		radius: 0,
		x: 0,
		y: 0,
		// Transition state: where the first frame's pole and scale were, and
		// the screen anchor that a chosen surface point must keep.
		fromX: 0,
		fromY: 0,
		fromRadius: 0,
		fromScale: 1,
		fromOx: 0,
		fromOy: 0,
		toX: 0,
		toY: 0,
		toRadius: 1,
		anchorX: 0,
		anchorY: 0,
		anchorSx: 0,
		anchorSy: 0
	};

	// The active world as a body of the plane: the origin of the catalog, and
	// a lens like any other once the chart is seated elsewhere.
	var worldBody = {
		id: 'world', name: '', kind: 'world', color: '#b4c7ad', shade: '#232a26',
		distanceRadii: 0, radiusRadii: 1, longitude: 0, orbitRate: 0
	};

	// Silhouette of the last outlined body, in screen space. The two limbs are
	// solved per sample angle, so the shape is the true lens and never an
	// ellipse guess.
	var shape = {
		visible: false,
		alpha: 1,
		centerX: 0,
		centerY: 0,
		halfWidth: 0,
		nearY: 0,
		farY: 0,
		distance: 0,
		angularRadius: 0,
		shade: 1,
		xs: new Float64Array(SAMPLES + 1),
		nearYs: new Float64Array(SAMPLES + 1),
		farYs: new Float64Array(SAMPLES + 1)
	};

	// The damped fit: the shared scale widens at once when a body recedes and
	// narrows slowly when it returns, so the farthest body stays fitted without
	// the whole system breathing at the orbit period.
	var fit = { range: 1, target: 1, at: 0, time: 0, ready: false };

	var plane = { x: 0, y: 0 };
	var starPlane = { x: 0, y: 0 };
	var chartPoint = { x: 0, y: 0 };

	sky.view = view;
	sky.pivot = pivot;
	sky.world = worldBody;
	sky.shape = shape;
	sky.fit = fit;
	sky.bodies = bodies;

	function smoothstep(t) {
		return t * t * (3 - 2 * t);
	}

	function ease(current, goal, dt, tau) {
		return current + (goal - current) * (1 - Math.exp(-dt / tau));
	}

	function simTimeOf(game) {
		return game && game.simTime ? game.simTime : 0;
	}

	// A catalog body's place in the plane, in metres, from the world's centre.
	// Its orbit radius and body radius are quoted in active-planet radii, so
	// one table reads on every world.
	sky.planePosition = function(body, simTime, out) {
		var distance = body.distanceRadii * view.radius;
		var angle = (body.longitude + simTime * body.orbitRate / TWO_PI) * TWO_PI;

		out.x = distance * Math.cos(angle);
		out.y = distance * Math.sin(angle);
		return out;
	};

	sky.bodyRadius = function(body) {
		return body === worldBody ? view.radius : body.radiusRadii * view.radius;
	};

	sky.bodyOf = function(index) {
		return index < 0 ? worldBody : bodies[index];
	};

	// Farthest surface of the whole charted system from the pivot's centre.
	// The shared scale is set from this so every body fits on one scale.
	function maxExtent() {
		var extent = 0;
		var body;
		var dx;
		var dy;
		var i;

		for (i = -1; i < bodies.length; i += 1) {
			body = i < 0 ? worldBody : bodies[i];
			if (i === pivot.index) {
				continue;
			}
			if (body === worldBody) {
				plane.x = 0;
				plane.y = 0;
			} else {
				sky.planePosition(body, simTime, plane);
			}
			dx = plane.x - pivot.x;
			dy = plane.y - pivot.y;
			extent = Math.max(extent, Math.sqrt(dx * dx + dy * dy) + sky.bodyRadius(body));
		}
		return Math.max(extent, view.radius * 1.5);
	}

	var simTime = 0;

	// The shared scale, damped. `range` is the natural log of how many e-folds
	// the chart covers, so the scale is just the pixel span divided by it.
	function fitScale(dt) {
		var top = R.camera.height * viewSettings.chartTopFraction;
		var line = R.camera.groundY;
		var range = Math.log(Math.max(1.0001, maxExtent() / Math.max(1, pivot.radius)));

		if (!fit.ready) {
			fit.range = fit.target = range;
			fit.at = fit.time = 0;
			fit.ready = true;
		} else {
			fit.time += dt;
			if (fit.time - fit.at >= settings.fitSampleSeconds) {
				fit.target = range;
				fit.at = fit.time;
			}
			fit.range = ease(fit.range, fit.target, dt, fit.target > fit.range ?
				settings.fitGrowTau : settings.fitCloseTau);
		}
		return (line - top) / Math.max(fit.range, 0.2);
	}

	sky.ensure = function() {
		var planet;

		if (view.planetId !== '') {
			worldBody.name = R.world.planet.name;
			return;
		}
		planet = R.world.planet;
		view.planetId = planet.id;
		view.logScale = planet.logAltitudeScale;
		view.gravity = planet.surfaceGravity;
		view.radius = planet.radius;
		view.atmosphereTop = R.physics.atmosphereTop();
		view.morph = 1;
		view.from.gravity = view.gravity;
		view.from.radius = view.radius;
		pivot.index = -1;
		pivot.previousIndex = -1;
		pivot.reseating = false;
		pivot.morph = 1;
		pivot.radius = view.radius;
		pivot.x = 0;
		pivot.y = 0;
		fit.ready = false;
		worldBody.name = planet.name;
		R.camera.flat = true;
	};

	// Seat the chart on a catalog body, or back on the world with -1.
	//
	// The hand-over must not cut. Three things are captured first: the plane
	// point the player is watching (the ship), where that point is on screen,
	// and the pose the map is drawing with. The pole then walks to the new
	// body and the scale eases, while the screen offsets are solved every frame
	// so the watched point keeps its place. At the end the pose is the new
	// body's own, with its surface on the ground line — no snap, because that
	// is the same pose the interpolation has been approaching.
	sky.seatPivot = function(index, game) {
		var wasFlat;
		var angle;
		var body;

		sky.ensure();
		if (pivot.reseating || index === pivot.index) {
			return false;
		}
		wasFlat = R.camera.flat;
		// The anchor is the point the hand-over must not move. It is the
		// destination body's own surface point nearest the ship: that is the
		// point which is about to become the ground line, so holding it still is
		// exactly "the new surface arrives where the ground already is".
		body = index < 0 ? worldBody : bodies[index];
		plane.x = index < 0 ? 0 : 0;
		if (index < 0) {
			angle = 0;
			plane.x = 0;
			plane.y = 0;
		} else {
			sky.planePosition(body, simTime, plane);
			angle = Math.atan2(plane.y, plane.x);
		}
		pivot.anchorX = plane.x + Math.sin(angle) * sky.bodyRadius(body);
		pivot.anchorY = plane.y + Math.cos(angle) * sky.bodyRadius(body);
		if (wasFlat) {
			// The deck's map is the closed form of this same chart. Its
			// horizontal axis is arc length around the world, so the anchor's
			// own longitude gives its screen x; its surface is the ground line.
			pivot.anchorSx = (Math.atan2(pivot.anchorX, pivot.anchorY) * view.radius -
				R.camera.leftWx) * R.camera.pixelsPerMeterX;
			pivot.anchorSy = R.camera.groundY;
			pivot.fromOx = R.camera.ox;
			pivot.fromOy = R.camera.oy;
		} else {
			pivot.anchorSx = R.camera.ox + R.camera.scalePx *
				Math.atan2(pivot.anchorX - pivot.x, pivot.anchorY - pivot.y);
			pivot.anchorSy = R.camera.oy - R.camera.scalePx * Math.log(Math.max(1e-9,
				Math.sqrt((pivot.anchorX - pivot.x) * (pivot.anchorX - pivot.x) +
					(pivot.anchorY - pivot.y) * (pivot.anchorY - pivot.y))));
		}
		pivot.previousIndex = pivot.index;
		pivot.index = index;
		pivot.morph = 0;
		pivot.reseating = true;
		// The first frame after this must reproduce the pose that was on
		// screen, in the spelling the hand-over will use. Without this the
		// switch to the general form would be a jump all by itself.
		applyPose(R.camera.scalePx);
		R.camera.flat = false;
		return true;
	};

	sky.reset = function() {
		view.planetId = '';
		pivot.index = -1;
		pivot.previousIndex = -1;
		pivot.reseating = false;
		pivot.morph = 1;
		pivot.radius = 0;
		fit.ready = false;
		sky.ensure();
	};

	// Where the pivot body is now: the target of any hand-over, and the live
	// pose when nothing is moving.
	function placePivot() {
		if (pivot.index < 0) {
			pivot.toX = 0;
			pivot.toY = 0;
			pivot.toRadius = view.radius;
		} else {
			sky.planePosition(bodies[pivot.index], simTime, plane);
			pivot.toX = plane.x;
			pivot.toY = plane.y;
			pivot.toRadius = bodies[pivot.index].radiusRadii * view.radius;
		}
		if (!pivot.reseating) {
			pivot.x = pivot.toX;
			pivot.y = pivot.toY;
			pivot.radius = pivot.toRadius;
		}
	}

	// Place the pole and solve the screen offsets. Seated on a body, the
	// offsets are chosen so that body's surface sits on the ground line and its
	// centre is the pole. Mid-hand-over they are chosen so a fixed plane point
	// (`pivot.anchor`) stays at the screen position it had when the hand-over
	// started: the pole and the scale are what move, the anchor does not jump.
	//
	// Solving for the offsets instead of interpolating them is what makes the
	// change continuous. The pole travels from one body's centre to the next,
	// the scale eases, and the ground line arrives where the new surface is
	// because that is where the anchor's own surface ends up.
	// Place the pose. Seated, the pivot's centre is the pole and its surface
	// sits on the ground line, which fixes both offsets. Mid-hand-over the
	// offsets are solved from the anchor instead: the anchor's angle and
	// distance are read against the *live* pole, so however the pole slides its
	// screen position does not move. That is what makes the change continuous —
	// the chart travels under the point the player is watching.
	function applyPose(scale) {
		var camera = R.camera;
		var ax;
		var ay;

		camera.pivotX = pivot.x;
		camera.pivotY = pivot.y;
		camera.pivotRadius = pivot.radius;
		camera.worldRadius = view.radius;
		camera.scalePx = scale;
		camera.ox = camera.width * 0.5;
		camera.oy = camera.groundY + scale * Math.log(pivot.radius);
		if (!pivot.reseating) {
			return;
		}
		ax = pivot.anchorX - pivot.x;
		ay = pivot.anchorY - pivot.y;
		camera.ox = pivot.anchorSx - scale * Math.atan2(ax, ay);
		camera.oy = pivot.anchorSy + scale * Math.log(Math.max(1e-9, Math.sqrt(ax * ax + ay * ay)));
	}

	sky.update = function(game, dt) {
		var planet = R.world.planet;
		var step = R.util.clamp(dt, 0, 0.25);
		var blend;
		var blendPole;
		var scale;

		sky.ensure();
		simTime = simTimeOf(game);
		if (view.planetId !== planet.id) {
			view.from.gravity = view.gravity;
			view.from.radius = view.radius;
			view.planetId = planet.id;
			view.morph = 0;
			fit.ready = false;
		}
		view.morph = Math.min(1, view.morph + step / viewSettings.transformSeconds);
		blend = smoothstep(view.morph);
		placePivot();

		if (pivot.reseating) {
			pivot.morph = Math.min(1, pivot.morph + step / settings.pivotSeconds);
			blendPole = smoothstep(pivot.morph);
			pivot.x = pivot.fromX + (pivot.toX - pivot.fromX) * blendPole;
			pivot.y = pivot.fromY + (pivot.toY - pivot.fromY) * blendPole;
			pivot.radius = pivot.fromRadius + (pivot.toRadius - pivot.fromRadius) * blendPole;
			R.camera.flat = false;
		}

		scale = fitScale(step);
		applyPose(scale);

		// Only after the pose is drawn does the hand-over end: clearing the
		// flag first would make the final frame jump to the settled offsets.
		if (pivot.reseating && pivot.morph >= 1) {
			pivot.previousIndex = -1;
			pivot.reseating = false;
			R.camera.flat = pivot.index < 0;
		}

		view.logScale = planet.logAltitudeScale * pivot.radius / planet.radius;
		view.ceiling = Math.max(planet.maxAltitude, planet.maxAltitude * pivot.radius / planet.radius);
		// Air belongs to the active world; a chart seated elsewhere has none.
		view.atmosphereTop = ease(view.atmosphereTop,
			pivot.index < 0 ? R.physics.atmosphereTop() : 0, step, settings.easeTau);
		view.gravity = view.from.gravity + (planet.surfaceGravity - view.from.gravity) * blend;
		view.radius = view.from.radius + (planet.radius - view.from.radius) * blend;
		R.camera.setRange(view.logScale, view.ceiling);
		R.camera.setCircumference(TWO_PI * pivot.radius);
		return view;
	};

	// Opacity of a body's lens during a hand-over.
	function outlineAlpha(index) {
		if (!pivot.reseating) {
			return 1;
		}
		if (index === pivot.index) {
			return 1 - pivot.morph;
		}
		if (index === pivot.previousIndex) {
			return pivot.morph;
		}
		return 1;
	}

	// A body's lens in screen space. With `alpha` its angular radius from the
	// pivot and `psi` the offset inside that angle, the near and far limbs are
	// the two intersections of the ray with the sphere:
	//
	//     half = sqrt(rho² − D² sin²ψ)
	//     near = D cosψ − half        far = D cosψ + half
	//
	// and the chart's own log-polar map puts them on screen. Nothing here is an
	// ellipse: the two limbs genuinely differ, which is what gives a close body
	// its cutaway and a distant one its lens.
	sky.outline = function(index, game) {
		var body = sky.bodyOf(index);
		var camera = R.camera;
		var rho = sky.bodyRadius(body);
		var dx;
		var dy;
		var distance;
		var centre;
		var alpha;
		var psi;
		var cosPsi;
		var half;
		var j;

		shape.visible = false;
		shape.alpha = outlineAlpha(index);
		if (index === pivot.index) {
			return shape;
		}
		if (body === worldBody) {
			plane.x = 0;
			plane.y = 0;
		} else {
			sky.planePosition(body, simTimeOf(game), plane);
		}
		dx = plane.x - pivot.x;
		dy = plane.y - pivot.y;
		distance = Math.sqrt(dx * dx + dy * dy);
		if (distance <= rho || distance <= 0) {
			return shape;
		}
		alpha = Math.asin(R.util.clamp(rho / distance, 0, 1));
		centre = Math.atan2(dx, dy);
		shape.visible = true;
		shape.distance = distance;
		shape.angularRadius = alpha;
		shape.halfWidth = alpha * camera.scalePx;
		shape.centerX = camera.ox + camera.scalePx * centre;
		// The near limb is the part of the sphere closest to the pivot, and the
		// pivot's centre is below its surface on screen, so the near limb is the
		// *lower* edge of the lens: `nearY` is greater than `farY`.
		shape.nearY = camera.oy - camera.scalePx * Math.log(distance - rho);
		shape.farY = camera.oy - camera.scalePx * Math.log(distance + rho);
		for (j = 0; j <= SAMPLES; j += 1) {
			psi = -alpha + 2 * alpha * j / SAMPLES;
			cosPsi = Math.cos(psi);
			half = Math.sqrt(Math.max(0, rho * rho - distance * distance * Math.sin(psi) * Math.sin(psi)));
			shape.xs[j] = camera.ox + camera.scalePx * (centre + psi);
			shape.nearYs[j] = camera.oy - camera.scalePx * Math.log(Math.max(1e-9, distance * cosPsi - half));
			shape.farYs[j] = camera.oy - camera.scalePx * Math.log(Math.max(1e-9, distance * cosPsi + half));
		}
		shape.centerY = (shape.nearY + shape.farY) * 0.5;
		sky.planePosition(bodies[0], simTimeOf(game), starPlane);
		shape.shade = R.util.clamp(0.55 + 0.45 * Math.cos(
			Math.atan2(dx, dy) - Math.atan2(starPlane.x - pivot.x, starPlane.y - pivot.y)), 0, 1);
		return shape;
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = sky;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
