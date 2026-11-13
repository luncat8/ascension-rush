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
		// The ladder's knee and far-field slope: a fine metre-scale log over the
		// landed deck, a body-scale log in the system view (so the catalog
		// spreads instead of stacking at the top), both eased across a hand-over
		// so the curve never changes in one frame.
		knee: 0,
		ladderFar: 0.45,
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

	// One orbit polyline in screen space, reused every frame: sampling a circle
	// costs no allocation, and the renderer only reads it.
	var ORBIT_N = viewSettings.orbitSamples;
	var orbit = {
		valid: false,
		count: 0,
		period: 1,
		radius: 0,
		xs: new Float64Array(ORBIT_N + 1),
		ys: new Float64Array(ORBIT_N + 1)
	};

	var plane = { x: 0, y: 0 };
	var starPlane = { x: 0, y: 0 };
	var chartPoint = { x: 0, y: 0 };
	var shipPlane = { x: 0, y: 0 };

	sky.view = view;
	sky.pivot = pivot;
	sky.world = worldBody;
	sky.shape = shape;
	sky.orbitShape = orbit;

	// Screen x per radian. On the deck X is arc length (one circumference per
	// viewport), so a lens is drawn on that axis and a body sits at the
	// longitude the ship would see it at; away from the world both axes share
	// the chart's one scale.
	function angularScale() {
		return R.camera.flat ? R.camera.pixelsPerMeterX * view.radius : R.camera.scalePx;
	}

	// A body's screen x for an angle from the pole, on the same axis its lens
	// and its orbit are drawn with.
	function screenX(angle) {
		if (R.camera.flat) {
			return R.camera.width * viewSettings.cameraAnchorFraction +
				angularScale() * angle;
		}
		return R.camera.ox + R.camera.scalePx * angle;
	}
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
	// one table reads on every world. The plane shares the world's own frame
	// (angle from the +Y axis), so a body at longitude 0 sits due north of
	// the ship at wx 0.
	sky.planePosition = function(body, simTime, out) {
		var distance = body.distanceRadii * view.radius;
		var angle = (body.longitude + simTime * body.orbitRate / TWO_PI) * TWO_PI;

		out.x = distance * Math.sin(angle);
		out.y = distance * Math.cos(angle);
		return out;
	};

	// The ship's place in the same plane: its radius from the world's centre
	// at its own longitude. The pole, the anchor and the fit all read it.
	sky.shipPlane = function(game, out) {
		var rocket = game && game.rocket;
		var radius;

		if (!rocket) {
			out.x = 0;
			out.y = view.radius;
			return out;
		}
		radius = view.radius + Math.max(0, rocket.wy || 0);
		out.x = radius * Math.sin((rocket.wx || 0) / view.radius);
		out.y = radius * Math.cos((rocket.wx || 0) / view.radius);
		return out;
	};

	sky.bodyRadius = function(body) {
		return body === worldBody ? view.radius : body.radiusRadii * view.radius;
	};

	sky.bodyOf = function(index) {
		return index < 0 ? worldBody : bodies[index];
	};

	// Screen Y of a plane distance from the pivot centre, through the chart's
	// own law: the log ladder above the surface, a single log below it. The
	// lens, the fit and the hand-over all read this one helper, so a body is
	// never drawn by one curve and picked by another.
	sky.distanceY = function(distance, oy, scale) {
		if (distance >= pivot.radius) {
			return oy - scale * R.coords.ladderOf(distance - pivot.radius,
				R.camera.logScale, R.camera.ladderQ0, R.camera.ladderFar);
		}
		return oy + scale * Math.log(pivot.radius / Math.max(1e-9, distance));
	};

	// Farthest surface of the whole charted system from the pivot's centre,
	// ship included: the shared scale is set from this so every body and the
	// ship itself fit on one scale.
	function maxExtent(game) {
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
		sky.shipPlane(game, shipPlane);
		dx = shipPlane.x - pivot.x;
		dy = shipPlane.y - pivot.y;
		extent = Math.max(extent, Math.sqrt(dx * dx + dy * dy));
		return Math.max(extent, view.radius * 1.5);
	}

	var simTime = 0;

	// The shared scale, damped. `range` is the double-log span the chart
	// covers, so the scale is just the pixel span divided by it.
	function fitScale(dt, game) {
		var top = R.camera.height * viewSettings.chartTopFraction;
		var line = R.camera.baseGroundY;
		var extent = maxExtent(game);
		var range = R.coords.ladderOf(Math.max(0, extent - Math.max(1, pivot.radius)),
			R.camera.logScale, R.camera.ladderQ0, R.camera.ladderFar);

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
		// The deck inherits the damped range, so its closed form and the lenses
		// below are the same curve at every frame of the ease.
		R.camera.setRangeUnits(fit.range);
		return (line - top) / Math.max(fit.range, 0.2) * R.camera.zoom;
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
		view.knee = planet.logAltitudeScale;
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
		var body;
		var radius;
		var dx;
		var dy;
		var distance;

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
		if (index < 0) {
			plane.x = 0;
			plane.y = 0;
		} else {
			sky.planePosition(body, simTime, plane);
		}
		radius = sky.bodyRadius(body);
		sky.shipPlane(game, shipPlane);
		dx = shipPlane.x - plane.x;
		dy = shipPlane.y - plane.y;
		distance = Math.sqrt(dx * dx + dy * dy);
		if (distance > 1e-9) {
			pivot.anchorX = plane.x + dx / distance * radius;
			pivot.anchorY = plane.y + dy / distance * radius;
		} else {
			pivot.anchorX = plane.x;
			pivot.anchorY = plane.y + radius;
		}
		// The anchor is stored without the pointer pan: the pose is solved for
		// the base, and the pan is added on top, so a drag mid-hand-over pans
		// the view instead of moving the anchor.
		if (wasFlat) {
			// The deck's map is the closed form of this same chart. Its
			// horizontal axis is arc length around the world, so the anchor's
			// own longitude gives its screen x; its surface is the ground line.
			pivot.anchorSx = (Math.atan2(pivot.anchorX, pivot.anchorY) * view.radius -
				R.camera.baseLeftWx) * R.camera.pixelsPerMeterX;
			pivot.anchorSy = R.camera.baseGroundY;
			pivot.fromOx = R.camera.baseOx;
			pivot.fromOy = R.camera.baseOy;
		} else {
			pivot.anchorSx = R.camera.baseOx + R.camera.scalePx *
				Math.atan2(pivot.anchorX - pivot.x, pivot.anchorY - pivot.y);
			pivot.anchorSy = sky.distanceY(Math.sqrt((pivot.anchorX - pivot.x) * (pivot.anchorX - pivot.x) +
				(pivot.anchorY - pivot.y) * (pivot.anchorY - pivot.y)), R.camera.baseOy, R.camera.scalePx);
			pivot.fromOx = R.camera.baseOx;
			pivot.fromOy = R.camera.baseOy;
		}
		// A seat returns to the fitted overview: the pan the player dragged in is
		// kept (it is their place in the chart) but the wheel zoom eases back to
		// the fit, so landing on a distant body does not land on empty space.
		R.camera.zoomTarget = 1;
		pivot.previousIndex = pivot.index;
		pivot.index = index;
		pivot.fromX = pivot.x;
		pivot.fromY = pivot.y;
		pivot.fromRadius = pivot.radius;
		pivot.fromScale = R.camera.scalePx;
		pivot.morph = 0;
		pivot.reseating = true;
		// The first frame after this must reproduce the pose that was on
		// screen, in the spelling the hand-over will use. Without this the
		// switch to the general form would be a jump all by itself.
		applyPose(R.camera.scalePx, game);
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

	// Place the pose. Seated, the pivot's centre is the pole, its surface sits
	// on the ground line, and the ship sits at the anchor fraction: the offsets
	// follow the ship, so a rocket above the atmosphere stays centred while
	// the ground stays on the line. Mid-hand-over the offsets are solved from
	// the anchor instead: the anchor's angle and distance are read against the
	// *live* pole, so however the pole slides its screen position does not
	// move. That is what makes the change continuous — the chart travels under
	// the point the player is watching.
	function applyPose(scale, game) {
		var camera = R.camera;
		var ax;
		var ay;
		var distance;

		camera.pivotX = pivot.x;
		camera.pivotY = pivot.y;
		camera.pivotRadius = pivot.radius;
		camera.worldRadius = view.radius;
		camera.scalePx = scale;
		if (!pivot.reseating) {
			sky.shipPlane(game, shipPlane);
			camera.baseOx = camera.width * viewSettings.cameraAnchorFraction -
				scale * Math.atan2(shipPlane.x - pivot.x, shipPlane.y - pivot.y);
			camera.baseOy = camera.baseGroundY;
			camera.syncPan();
			return;
		}
		ax = pivot.anchorX - pivot.x;
		ay = pivot.anchorY - pivot.y;
		distance = Math.sqrt(ax * ax + ay * ay);
		camera.baseOx = pivot.anchorSx - scale * Math.atan2(ax, ay);
		camera.baseOy = pivot.anchorSy + (distance >= pivot.radius ?
			scale * R.coords.ladderOf(distance - pivot.radius, camera.logScale, camera.ladderQ0,
				camera.ladderFar) :
			-scale * Math.log(pivot.radius / Math.max(1e-9, distance)));
		camera.syncPan();
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

		// A landed chart compresses the top so the bodies sit low over the
		// surface; the system view is a plain log, where every body is at its
		// own ratio from the pole and the orbits spread instead of stacking.
		view.ladderFar = ease(view.ladderFar, pivot.index < 0 ? viewSettings.ladderFar : 1,
			step, settings.pivotSeconds * 0.5);
		// The knee follows the pole: the planet's metre ladder on its own
		// surface, the pivot body's own radius once the chart is seated on it.
		// A log that knees at a body radius spreads the catalog by distance
		// ratio, which is what makes the orbits readable from another body.
		view.knee = ease(view.knee, pivot.index < 0 ? planet.logAltitudeScale : pivot.radius,
			step, settings.pivotSeconds * 0.5);
		view.logScale = view.knee;
		R.camera.setLadder(view.knee, planet.ladderSwitch, view.ladderFar);
		// The follow runs here, not beside it: the zoom it eases is the scale
		// this same frame solves the pose with, so a wheel notch cannot move the
		// deck and the lenses a frame apart.
		if (game && game.rocket) {
			R.camera.follow(game.rocket.wx, game.rocket.wy, step);
		}
		scale = fitScale(step, game);
		applyPose(scale, game);

		// Only after the pose is drawn does the hand-over end: clearing the
		// flag first would make the final frame jump to the settled offsets.
		if (pivot.reseating && pivot.morph >= 1) {
			pivot.previousIndex = -1;
			pivot.reseating = false;
			R.camera.flat = pivot.index < 0;
		}

		view.logScale = planet.logAltitudeScale;
		view.ceiling = planet.maxAltitude;
		// Air belongs to the active world; a chart seated elsewhere has none.
		view.atmosphereTop = ease(view.atmosphereTop,
			pivot.index < 0 ? R.physics.atmosphereTop() : 0, step, settings.easeTau);
		view.gravity = view.from.gravity + (planet.surfaceGravity - view.from.gravity) * blend;
		view.radius = view.from.radius + (planet.radius - view.from.radius) * blend;
		R.camera.setCircumference(TWO_PI * pivot.radius);
		// The follow needs to know where the air ends to decide whether the
		// camera's target is the ground or the ship.
		R.camera.airTop = view.atmosphereTop;
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
		shape.halfWidth = alpha * angularScale();
		shape.centerX = screenX(centre);
		// The near limb is the part of the sphere closest to the pivot, and the
		// pivot's centre is below its surface on screen, so the near limb is the
		// *lower* edge of the lens: `nearY` is greater than `farY`.
		shape.nearY = sky.distanceY(distance - rho, camera.oy, camera.scalePx);
		shape.farY = sky.distanceY(distance + rho, camera.oy, camera.scalePx);
		for (j = 0; j <= SAMPLES; j += 1) {
			psi = -alpha + 2 * alpha * j / SAMPLES;
			cosPsi = Math.cos(psi);
			half = Math.sqrt(Math.max(0, rho * rho - distance * distance * Math.sin(psi) * Math.sin(psi)));
			shape.xs[j] = screenX(centre + psi);
			shape.nearYs[j] = sky.distanceY(Math.max(1e-9, distance * cosPsi - half), camera.oy, camera.scalePx);
			shape.farYs[j] = sky.distanceY(Math.max(1e-9, distance * cosPsi + half), camera.oy, camera.scalePx);
		}
		shape.centerY = (shape.nearY + shape.farY) * 0.5;
		sky.planePosition(bodies[0], simTimeOf(game), starPlane);
		shape.shade = R.util.clamp(0.55 + 0.45 * Math.cos(
			Math.atan2(dx, dy) - Math.atan2(starPlane.x - pivot.x, starPlane.y - pivot.y)), 0, 1);
		return shape;
	};

	// The smallest a body is ever drawn. A distant sphere is a hairline in log
	// space, so it is charted as a small disc instead: visible, clickable, and
	// the same size the picker uses.
	sky.iconRadius = function(index) {
		var body = sky.bodyOf(index);

		if (body === worldBody) {
			return 10;
		}
		if (body.kind === 'star') {
			return 9;
		}
		return body.radiusRadii >= 10 ? 7 : 4.5;
	};

	// Pick a body under a screen point, through the same lens geometry the
	// renderer draws (including the minimum-height stretch, so a distant body
	// is clickable). Returns the body index (-1 for the world), or -2 for
	// empty space. The seated body is the ground, never a pick.
	sky.pick = function(mx, my, game) {
		var camera = R.camera;
		var period = TWO_PI * camera.scalePx;
		var best = -2;
		var bestDistance = Infinity;
		var i;
		var lens;
		var halfHeight;
		var dx;
		var dy;
		var distance;

		for (i = -1; i < bodies.length; i += 1) {
			if (i === pivot.index) {
				continue;
			}
			lens = sky.outline(i, game);
			if (!lens.visible || lens.alpha <= 0.01) {
				continue;
			}
			halfHeight = Math.max(sky.iconRadius(i), (lens.nearY - lens.farY) * 0.5);
			dx = lens.centerX - mx;
			if (period > 0) {
				dx -= period * Math.round(dx / period);
			}
			dy = lens.centerY - my;
			distance = Math.sqrt(dx * dx + dy * dy);
			if (distance <= Math.max(10, Math.max(lens.halfWidth, sky.iconRadius(i)) + halfHeight) &&
				distance < bestDistance) {
				// Ellipse test in the lens's own axes, so the rim is the rim.
				if ((dx * dx) / Math.max(1, lens.halfWidth * lens.halfWidth) +
					(dy * dy) / Math.max(1, halfHeight * halfHeight) <= 1.2) {
					best = i;
					bestDistance = distance;
				}
			}
		}
		return best;
	};

	// A catalog body's orbit around the active world, sampled through the same
	// map that draws its lens: the circle is charted, not drawn as an ellipse.
	// Points inside the pivot body are dropped, which is what keeps the log
	// pole from throwing a line across the chart.
	sky.orbit = function(index) {
		var body;
		var distance;
		var camera = R.camera;
		var poleDistance;
		var i;
		var angle;
		var px;
		var py;
		var dx;
		var dy;
		var d;

		orbit.valid = false;
		orbit.count = 0;
		orbit.period = TWO_PI * camera.scalePx;
		if (index < 0) {
			return orbit;
		}
		body = bodies[index];
		distance = body.distanceRadii * view.radius;
		if (!(distance > 0)) {
			return orbit;
		}
		if (camera.flat) {
			// On the deck a circular orbit is a level lane at one altitude: an
			// arc length across the viewport and the ladder's height for its
			// radius. Same circle, same law, other spelling.
			orbit.valid = true;
			orbit.radius = distance;
			orbit.period = camera.width;
			for (i = 0; i <= ORBIT_N; i += 1) {
				angle = TWO_PI * i / ORBIT_N;
				R.camera.project(angle * view.radius, distance - view.radius, chartPoint);
				orbit.xs[i] = chartPoint.x;
				orbit.ys[i] = chartPoint.y;
			}
			orbit.count = ORBIT_N + 1;
			return orbit;
		}
		poleDistance = Math.sqrt(pivot.x * pivot.x + pivot.y * pivot.y);
		// An orbit that runs through the pole is not a curve on this chart.
		if (Math.abs(distance - poleDistance) < pivot.radius * 1.01) {
			return orbit;
		}
		orbit.valid = true;
		orbit.radius = distance;
		for (i = 0; i <= ORBIT_N; i += 1) {
			angle = TWO_PI * i / ORBIT_N;
			px = distance * Math.sin(angle);
			py = distance * Math.cos(angle);
			dx = px - pivot.x;
			dy = py - pivot.y;
			d = Math.sqrt(dx * dx + dy * dy);
			if (d <= pivot.radius) {
				orbit.xs[i] = NaN;
				orbit.ys[i] = NaN;
				continue;
			}
			orbit.xs[i] = camera.ox + camera.scalePx * Math.atan2(dx, dy);

			orbit.ys[i] = sky.distanceY(d, camera.oy, camera.scalePx);
			orbit.count += 1;
		}
		return orbit;
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = sky;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
