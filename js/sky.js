(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var sky = R.sky || (R.sky = {});
	var settings = R.constants.sky;
	var viewSettings = R.constants.view;
	var bodies = settings.bodies;
	var TWO_PI = Math.PI * 2;
	var SAMPLES = settings.outlineSamples;
	var RING = viewSettings.flat.ringSamples;

	// The chart stands on exactly one body — its **pivot** — and everything else
	// in the catalog is a body of the same plane, drawn as the lens its sphere
	// casts on the chart.
	//
	// The log **pole** is a point on the ray from the pivot's centre to the ship.
	// On the ground it is the centre, so the pivot's surface is the flat ground
	// line the ladder starts at; once the ship is above the air it travels out
	// along that ray and stops on the pivot's surface under the ship, so the
	// chart is read from the ship's own place: the hull holds the origin line,
	// the world curves away below it as a horizon, and every body is charted
	// from the pole by its own bearing and distance. The travel is one
	// continuous map — the same sphere, bending from a flat line into that
	// horizon — and the pivot keeps its surface, its curve and its colour all
	// the way, so two bodies only trade places halfway.
	var view = {
		planetId: '',
		logScale: 0,
		ceiling: 0,
		gravity: 0,
		radius: 0,
		atmosphereTop: 0,
		// The altitude at which the camera's target changes from the ground to
		// the ship. An airless world has no atmosphere ceiling, so it falls back
		// to a fraction of its own radius.
		switchAltitude: 0,
		// The ladder's knee and far-field slope: a fine metre-scale log over the
		// landed deck, a body-scale log in the system view (so the catalog
		// spreads by distance ratio instead of stacking), both eased across a
		// hand-over so the curve never changes in one frame.
		knee: 0,
		ladderFar: 0.45,
		// How much of the chart is the system view rather than the deck, eased
		// as the ship leaves the air. It moves the origin line from the ground
		// to the ship and the tangential axis from one-circumference-per-viewport
		// to the shared scale, so both changes are one continuous morph.
		fly: 0,
		// How far the log pole has travelled out from the pivot's centre toward
		// the surface under the ship: 0 at the centre, where the surface is the
		// flat ground line, 1 standing on that surface, where the chart is read
		// from the ship's own place and the surface curves away from it.
		orbit: 0,
		morph: 1,
		from: { gravity: 0, radius: 0 }
	};

	var pivot = {
		index: -1,
		previousIndex: -1,
		reseating: false,
		morph: 1,
		radius: 1,
		x: 0,
		y: 0,
		// Whether the chart stands here because the ship flew here rather than
		// because the player pointed at it. Only an approach seat is handed back
		// when the ship leaves; a seat the player asked for stays put.
		approach: false
	};

	// The active world as a body of the plane: the origin of the catalog, and a
	// lens like any other once the chart is seated elsewhere.
	var worldBody = {
		id: 'world', name: '', kind: 'world', color: '#b4c7ad', shade: '#232a26',
		distanceRadii: 0, radiusRadii: 1, longitude: 0
	};

	// Silhouette of the last outlined body, in screen space. The two limbs are
	// solved per sample angle, so the shape is the true lens and never an
	// ellipse guess.
	var shape = {
		visible: false,
		alpha: 1,
		index: -2,
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
		farYs: new Float64Array(SAMPLES + 1),
		// A flat view draws a body as its own circle through the view's map: a
		// closed ring of points, plus where the centre is and which way on
		// screen points away from the star.
		ring: false,
		ringXs: new Float64Array(RING * 2 + 1),
		ringYs: new Float64Array(RING * 2 + 1),
		bodyX: 0,
		bodyY: 0,
		nightAngle: 0
	};

	// The damped fit: the shared scale widens at once when a body recedes, holds
	// through an orbit-sized swing, and closes fast only when it is far too
	// wide, so the farthest body stays fitted without the whole system
	// breathing at the orbit period.
	var fit = { range: 1, target: 1, extent: 1, at: 0, time: 0, ready: false };

	// One orbit polyline in screen space, reused every frame.
	var ORBIT_N = viewSettings.orbitSamples;
	var orbit = {
		valid: false,
		count: 0,
		period: 1,
		radius: 0,
		xs: new Float64Array(ORBIT_N + 1),
		ys: new Float64Array(ORBIT_N + 1)
	};

	// The ground state of a plane point: where the pole goes, what the ladder
	// starts at, which point is held 1:1 under the pointer and which screen line
	// it ends on. A click and a drag solve the same state, so they end at the
	// same view.
	var anchor = {
		bodyIndex: -2,
		poleX: 0,
		poleY: 0,
		ladderRef: 0,
		knee: 0,
		far: 1,
		groundX: 0,
		groundY: 0,
		groundRadius: 1,
		referenceX: 0,
		referenceY: 0,
		reference: 1,
		line: 0
	};

	// The pointer's own gesture. Press a point of the plane and drag it toward
	// its ground line: the pole walks to that point's ground state, the ladder
	// opens onto the body it stands on and the shared scale widens, while the
	// pressed point never slips from under the pointer.
	var hand = {
		active: false,
		pointerX: 0,
		pointerY: 0,
		startX: 0,
		startY: 0,
		k: 0,
		line: 0,
		seatIndex: -2,
		referenceX: 0,
		referenceY: 0,
		fromDistance: 1,
		fromBearing: 0,
		bearingDelta: 0,
		fromPoleX: 0,
		fromPoleY: 0,
		fromLadderRef: 0,
		fromKnee: 0,
		fromFar: 1,
		fromScale: 1,
		fromOriginLine: 1,
		fromFly: 0,
		fromGroundX: 0,
		fromGroundY: 0,
		fromGroundRadius: 1
	};

	// A pole on a surface counts as inside it: a free-space drag ends exactly on
	// the ground body's surface, and that view is the cutaway seen from the
	// ground, not empty space. The slack is far above the rounding of the pole
	// itself and far below anything a player could see.
	var GROUND_SLACK = 1 + 1e-6;

	var plane = { x: 0, y: 0 };
	var shipPlane = { x: 0, y: 0 };
	var starPlane = { x: 0, y: 0 };
	var pose = {
		poleX: 0, poleY: 0, pivotX: 0, pivotY: 0,
		ladderRef: 1, pivotRadius: 1, knee: 1, far: 1,
		targetDistance: 1, targetX: 0, targetY: 1,
		originLine: 1, fitScale: 1, range: 1, extent: 1, fly: 0,
		hold: false, holdX: 0, holdY: 0, holdSx: 0, holdSy: 0
	};
	var simTime = 0;

	// The flat views' own state: the body whose surface is nearest the hull,
	// the pole's travel when that changes, and the eased real-scale fit.
	var flat = {
		ready: false,
		nearest: -2,
		gap: 0,
		swap: 1,
		fromX: 0,
		fromY: 0,
		poleX: 0,
		poleY: 0,
		scale: 1
	};
	var flatPose = {
		log: false, poleX: 0, poleY: 0, pivotX: 0, pivotY: 0, pivotRadius: 1,
		targetX: 0, targetY: 0, up: 0, knee: 1, fitScale: 1, extent: 1,
		centreX: 0, centreY: 0
	};
	var surface = { x: 0, y: 0 };
	var pickScreen = { x: 0, y: 0 };

	function modeOf(id) {
		var modes = viewSettings.modes;
		var i;

		for (i = 0; i < modes.length; i += 1) {
			if (modes[i].id === id) {
				return modes[i];
			}
		}
		return null;
	}

	sky.mode = modeOf(viewSettings.defaultMode);
	sky.flat = flat;
	sky.view = view;
	sky.pivot = pivot;
	sky.world = worldBody;
	sky.shape = shape;
	sky.orbitShape = orbit;
	sky.fit = fit;
	sky.anchor = anchor;
	sky.hand = hand;
	sky.bodies = bodies;

	function smoothstep(t) {
		return t * t * (3 - 2 * t);
	}

	// Exponential easing, snapped shut at the end. The ladder is a log, so the
	// last part-per-million of an eased distance is still tenths of a nat on
	// screen: without the snap the pole asymptotes toward the hull and the hull
	// asymptotes toward its own line forever. The snap is far below a pixel of
	// chart at the far end of the catalog.
	function ease(current, goal, dt, tau) {
		var next = current + (goal - current) * (1 - Math.exp(-dt / Math.max(1e-6, tau)));

		return Math.abs(goal - next) <= 1e-7 * Math.max(1, Math.abs(goal)) ? goal : next;
	}

	function wrapPi(angle) {
		return R.util.mod(angle + Math.PI, TWO_PI) - Math.PI;
	}

	function simTimeOf(game) {
		return game && game.simTime ? game.simTime : 0;
	}

	sky.bodyOf = function(index) {
		return index < 0 ? worldBody : bodies[index];
	};

	sky.bodyRadius = function(body) {
		return body === worldBody ? view.radius : body.radiusRadii * view.radius;
	};

	// A catalog body's place in the plane, in metres, from the world's centre.
	// Orbit and body radii are quoted in active-planet radii, so one table reads
	// on every world. The plane shares the world's frame (angle from the +Y
	// axis), so a body at longitude 0 sits due north of the ship at wx 0.
	// Orbiters are circular test bodies in the active world's gravity; the
	// fixed star is a background light, not an orbiting body.
	sky.planePosition = function(body, time, out) {
		var distance = body.distanceRadii * view.radius;
		var radius = body.distanceRadii * R.world.planet.radius;
		var rate = body.kind === 'star' || radius <= 0 ? 0 :
			Math.sqrt(R.physics.gravitationalParameter() / (radius * radius * radius));
		var angle = body.longitude * TWO_PI + time * rate;

		out.x = distance * Math.sin(angle);
		out.y = distance * Math.cos(angle);
		return out;
	};

	sky.bodyCentre = function(index, out) {
		if (index < 0) {
			out.x = 0;
			out.y = 0;
			return out;
		}
		return sky.planePosition(bodies[index], simTime, out);
	};

	// The ship's place in the same plane: its radius from the world's centre at
	// its own longitude. The target, the pole, the anchor and the fit all read
	// it, and it uses the radius the projection itself uses, so the pole that
	// stands on the surface under the hull and the hull the chart draws are the
	// same point.
	sky.shipPlane = function(game, out) {
		var rocket = game && game.rocket;

		if (!rocket) {
			out.x = 0;
			out.y = R.camera.worldRadius;
			return out;
		}
		return R.coords.planeOfWorld(rocket.wx || 0, rocket.wy || 0, R.camera.worldRadius, out);
	};

	// Screen y of a plane distance from the pole, through the chart's own law.
	// The lens, the fit, the orbits and the hand-over all read this one helper,
	// so a body is never drawn by one curve and picked by another.
	sky.depthY = function(distance) {
		return R.camera.oy - R.camera.scale * R.coords.depthOf(distance, R.camera);
	};

	sky.distanceY = sky.depthY;

	// Whether the pole is inside the ground body rather than standing on its
	// surface. The cutaway and the air shell are spheres read from the centre, so
	// they chart only in the first case: from a pole on the surface their far side
	// is behind the ground, and drawing it fills the sky with rock.
	sky.poleInside = function(radius) {
		var dx = R.camera.pivotX - R.camera.poleX;
		var dy = R.camera.pivotY - R.camera.poleY;

		return dx * dx + dy * dy < radius * radius * (1 - 1e-9);
	};

	// Whether the pole is beyond the ground sphere, which a climb never is —
	// that stops the pole on the surface. Only a gesture walks it out past the
	// sphere, and no ray from out there exits it forward: there is no surface
	// under the chart at all, and the body is the lens `sky.outline` draws for
	// it. Standing exactly on a surface counts as on it, not beyond, which is
	// the horizon the climb ends on.
	sky.poleOutside = function(radius) {
		var dx = R.camera.pivotX - R.camera.poleX;
		var dy = R.camera.pivotY - R.camera.poleY;

		return dx * dx + dy * dy > radius * radius * GROUND_SLACK;
	};

	// The body the ground belongs to: the one whose centre the camera's pivot is
	// nearest. A drag and a hand-over both travel the pivot — and the pole with
	// it — from one body to another, so the ground keeps its sphere, its curve and
	// its colour all the way, and two bodies only trade places halfway. No
	// separate "is the pole inside it" test is needed anywhere: a body the pole is
	// inside has no lens, no orbit and no pick, because its own outline says so.
	sky.groundBody = function() {
		var best = -1;
		var bestGap = Infinity;
		var dx;
		var dy;
		var gap;
		var i;

		for (i = -1; i < bodies.length; i += 1) {
			sky.bodyCentre(i, plane);
			dx = plane.x - R.camera.pivotX;
			dy = plane.y - R.camera.pivotY;
			gap = dx * dx + dy * dy;
			if (gap < bestGap) {
				bestGap = gap;
				best = i;
			}
		}
		return best;
	};

	// --------------------------------------------------------------------- fit

	// Farthest surface of the whole charted system from a pole, ship included.
	// The shared scale is set from this, so every body and the ship itself fit
	// on one scale. A body the pole is inside is the ground: its far limb is
	// below the ground line rather than in the sky, so it sets no span.
	function maxExtentFrom(poleX, poleY, game) {
		var extent = 0;
		var radius;
		var distance;
		var dx;
		var dy;
		var i;

		for (i = -1; i < bodies.length; i += 1) {
			sky.bodyCentre(i, plane);
			radius = sky.bodyRadius(sky.bodyOf(i));
			dx = plane.x - poleX;
			dy = plane.y - poleY;
			distance = Math.sqrt(dx * dx + dy * dy);
			if (distance < radius) {
				continue;
			}
			extent = Math.max(extent, distance + radius);
		}
		sky.shipPlane(game, shipPlane);
		dx = shipPlane.x - poleX;
		dy = shipPlane.y - poleY;
		extent = Math.max(extent, Math.sqrt(dx * dx + dy * dy));
		return Math.max(extent, view.radius * 1.5);
	}

	// The log span between a pose's target line and the farthest charted surface
	// from its pole. It is the whole vertical fit: `scale = span / range`.
	function fitRangeOf(poleX, poleY, ladderRef, knee, q0, far, targetDistance, game) {
		var extent = maxExtentFrom(poleX, poleY, game);
		var farDepth = R.coords.depthWith(extent, ladderRef, knee, q0, far);
		var targetDepth = R.coords.depthWith(targetDistance, ladderRef, knee, q0, far);

		fit.extent = extent;
		return Math.max(farDepth - targetDepth, settings.minFitRange);
	}

	// The same span read off a pose, in the ladder that pose is drawing with.
	function fitRange(next, game) {
		return fitRangeOf(next.poleX, next.poleY, next.ladderRef, next.knee,
			Math.log1p(R.camera.ladderSwitch / Math.max(1e-3, next.knee)), next.far,
			next.targetDistance, game);
	}

	// Sampled and damped, with the reference's asymmetry: a receding body is
	// fitted at once, an orbit-sized swing is held, and only a genuinely too
	// wide span closes fast.
	function dampedRange(range, dt) {
		if (!fit.ready) {
			fit.range = fit.target = range;
			fit.at = fit.time = 0;
			fit.ready = true;
			return fit.range;
		}
		fit.time += dt;
		if (fit.time - fit.at >= settings.fitSampleSeconds) {
			fit.target = range;
			fit.at = fit.time;
		}
		if (fit.target > fit.range) {
			fit.range = ease(fit.range, fit.target, dt, settings.fitGrowTau);
			return fit.range;
		}
		fit.range = ease(fit.range, fit.target, dt,
			fit.target < fit.range * settings.fitCloseRatio ? settings.fitCloseTau : settings.fitHoldTau);
		return fit.range;
	}

	// ------------------------------------------------------------------- state

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
		view.switchAltitude = Math.max(view.atmosphereTop, planet.radius * 0.5);
		view.morph = 1;
		view.fly = 0;
		view.orbit = 0;
		view.from.gravity = view.gravity;
		view.from.radius = view.radius;
		pivot.index = -1;
		pivot.previousIndex = -1;
		pivot.reseating = false;
		pivot.approach = false;
		pivot.morph = 1;
		pivot.radius = view.radius;
		pivot.x = 0;
		pivot.y = 0;
		fit.ready = false;
		hand.active = false;
		worldBody.name = planet.name;
	};

	// Back to the state a run starts in: the world as ground, the follow pose,
	// no hand-over, no pan, no zoom. The game reaches it through a world switch;
	// a test or a lab page reaches it by asking.
	sky.reset = function() {
		view.planetId = '';
		view.ladderFar = viewSettings.ladderFar;
		pivot.index = -1;
		pivot.previousIndex = -1;
		pivot.reseating = false;
		pivot.approach = false;
		pivot.radius = 0;
		fit.ready = false;
		flat.ready = false;
		hand.active = false;
		R.camera.resetZoom();
		R.camera.endTransition();
		R.camera.clearDirectionLock();
		sky.ensure();
	};

	// Change the view scale mode. The two chart modes are one map and ease
	// into each other; a flat view is a different map, so going to or from one
	// is a cut, with the wheel back at that view's own fit.
	sky.setMode = function(id) {
		var next = modeOf(id);
		var camera = R.camera;

		if (!next || next === sky.mode) {
			return false;
		}
		if (next.flat || sky.mode.flat) {
			hand.active = false;
			camera.endTransition();
			sky.clearSeat();
			fit.ready = false;
			flat.ready = false;
			camera.zoom = 1;
			camera.zoomTarget = 1;
		}
		if (next.directionLock !== sky.mode.directionLock) {
			fit.ready = false;
		}
		if (!next.directionLock) {
			camera.clearDirectionLock();
		}
		sky.mode = next;
		if (next.flat) {
			camera.setZoomBand(viewSettings.flat.zoomMin, viewSettings.flat.zoomMax);
		} else {
			camera.setZoomBand(viewSettings.zoomMin, viewSettings.zoomMax);
		}
		return true;
	};

	// A new run starts over a new world: drop any seat the previous one left.
	sky.clearSeat = function() {
		pivot.index = -1;
		pivot.previousIndex = -1;
		pivot.reseating = false;
		pivot.approach = false;
	};

	// Seat the chart on a catalog body, or back on the world with -1.
	//
	// The hand-over must not cut, so it holds one plane point still: the
	// destination body's surface point nearest the ship — the point that is
	// about to become the ground under the player. The pole, the ladder and the
	// scale travel to their new values while the camera solves its offsets from
	// that anchor every frame, so the chart travels underneath the point the
	// player is watching and the new surface arrives as the flat ground.
	sky.seatPivot = function(index, game, approach) {
		var radius;
		var dx;
		var dy;
		var distance;

		sky.ensure();
		if (sky.mode.flat || R.camera.transition.active || index === pivot.index) {
			return false;
		}
		sky.bodyCentre(index, plane);
		radius = index < 0 ? view.radius : bodies[index].radiusRadii * view.radius;
		sky.shipPlane(game, shipPlane);
		dx = shipPlane.x - plane.x;
		dy = shipPlane.y - plane.y;
		distance = Math.sqrt(dx * dx + dy * dy);
		if (distance > 1e-9) {
			anchor.referenceX = plane.x + dx / distance * radius;
			anchor.referenceY = plane.y + dy / distance * radius;
		} else {
			anchor.referenceX = plane.x;
			anchor.referenceY = plane.y + radius;
		}
		pivot.previousIndex = pivot.index;
		pivot.index = index;
		pivot.morph = 0;
		pivot.reseating = true;
		pivot.approach = approach === true;
		// A seat returns to the fitted overview: the pan the player dragged in is
		// kept, but the wheel zoom eases back to the fit so landing on a distant
		// body does not land on empty space.
		R.camera.zoomTarget = 1;
		// The destination's fit is a different pole's fit: take it now instead of
		// four hundred milliseconds into the hand-over.
		fit.ready = false;
		R.camera.beginTransition(anchor.referenceX, anchor.referenceY, settings.pivotSeconds);
		return true;
	};

	// Drop the hand-over back to the follow pose. The anchor is the ship, so the
	// chart re-acquires the rocket instead of snapping to it.
	sky.releaseToFollow = function(game, seconds) {
		sky.ensure();
		if (sky.mode.flat || R.camera.transition.active) {
			return false;
		}
		sky.shipPlane(game, shipPlane);
		R.camera.zoomTarget = 1;
		R.camera.beginTransition(shipPlane.x, shipPlane.y, seconds || settings.releaseSeconds);
		return true;
	};

	function placePivot() {
		if (pivot.index < 0) {
			pivot.x = 0;
			pivot.y = 0;
			pivot.radius = view.radius;
			return;
		}
		sky.planePosition(bodies[pivot.index], simTime, plane);
		pivot.x = plane.x;
		pivot.y = plane.y;
		pivot.radius = bodies[pivot.index].radiusRadii * view.radius;
	}

	// Choose a visual local body by normalized distance and hysteresis, not by
	// gravity: the catalog has no masses yet. Body-centred modes always follow
	// the rocket's current local body, even when another mode left a manual seat;
	// only a seat made automatic by this reach test gets the wider departure band.
	//
	// Returns the index to seat, or -2 to leave the pivot where it is.
	sky.approachIndex = function(game) {
		var best = -2;
		var bestGap = 0;
		var body;
		var radius;
		var gap;
		var dx;
		var dy;
		var i;

		if (hand.active || R.camera.transition.active) {
			return -2;
		}
		sky.shipPlane(game, shipPlane);
		for (i = 0; i < bodies.length; i += 1) {
			body = bodies[i];
			radius = Math.max(1e-9, body.radiusRadii * view.radius);
			sky.planePosition(body, simTime, plane);
			dx = shipPlane.x - plane.x;
			dy = shipPlane.y - plane.y;
			gap = Math.sqrt(dx * dx + dy * dy) / radius -
				(pivot.approach && i === pivot.index ? settings.departRadii : settings.approachRadii);
			if (gap >= 0 || (best > -2 && gap >= bestGap)) {
				continue;
			}
			best = i;
			bestGap = gap;
		}
		if (best > -2) {
			if (best === pivot.index) {
				if (sky.mode.bodyCentred) {
					pivot.approach = true;
				}
				return -2;
			}
			return best;
		}
		if (sky.mode.bodyCentred) {
			return outerVisualReachIndex();
		}
		return pivot.approach && pivot.index >= 0 ? -1 : -2;
	};

	function starIndex() {
		var i;

		for (i = 0; i < bodies.length; i += 1) {
			if (bodies[i].kind === 'star') {
				return i;
			}
		}
		return -1;
	}

	// With no nearby catalog body, keep the chart on the world until the hull
	// passes its outer visual band, then hand it to the star. This is a readable
	// chart transition, not a physical influence or encounter calculation.
	function outerVisualReachIndex() {
		var star = starIndex();
		var held = pivot.index === star;
		var reach = held ? settings.worldApproachRadii : settings.worldDepartRadii;
		var beyond = Math.sqrt(shipPlane.x * shipPlane.x + shipPlane.y * shipPlane.y) >
			reach * view.radius;
		var want = beyond ? star : -1;

		if (want === pivot.index) {
			pivot.approach = true;
			return -2;
		}
		return want;
	}

	// Fly the chart onto the body the ship is standing over, when there is one.
	function approachSeat(game) {
		var index = sky.approachIndex(game);

		if (index === -2) {
			return;
		}
		sky.seatPivot(index, game, sky.mode.bodyCentred || index >= 0);
	}

	// The camera's target and the log pole, both on the ray from the pivot's
	// centre to the ship:
	//
	//   on the ground   pole = the centre,               target = the surface
	//   above the air   pole = the hull's ground point,  target = the hull
	//
	// The pole is what the ladder starts at and what every bearing is read from,
	// so above the air the chart is read from the ship's own place: the hull
	// holds the origin line, the ground sinks below it by exactly the climb, the
	// body's surface curves away from the hull instead of lying flat under it,
	// and a body is charted at its own bearing and distance from the hull rather
	// than riding a level ring around the world.
	//
	// The pole stops on the surface instead of going out to the hull because the
	// chart's height is distance from the pole: from a pole on the hull every
	// bearing at the same range is at the same height, and the world it left
	// would be drawn above it.
	//
	// The ship's own depth is `ladder(altitude)` at every point of the travel —
	// the pole and the ladder's start move together — so what the climb moves is
	// the origin line, from the ground up to the hull, and nothing jumps.
	//
	// A seat is an explicit "look at this body": the chart stands on it, its
	// surface is the flat ground and the ship is a marker above it, so the pole
	// stays at that body's centre.
	function solveTarget(game) {
		var shipDistance;
		var poleDistance;
		var targetRadius;
		var altitude;
		var above;
		var goal;
		var directionLock = sky.mode.directionLock;
		var dx;
		var dy;

		sky.shipPlane(game, shipPlane);
		dx = shipPlane.x - pivot.x;
		dy = shipPlane.y - pivot.y;
		shipDistance = Math.max(pivot.radius, Math.sqrt(dx * dx + dy * dy));
		altitude = shipDistance - pivot.radius;
		above = R.util.clamp((altitude - view.switchAltitude) /
			Math.max(1, view.switchAltitude), 0, 1);
		// The local-body chart holds the surface as ground. Direction-lock views
		// keep that body pole but target the rocket itself and open the chart.
		if (sky.mode.bodyCentred && !directionLock) {
			above = 0;
		}
		goal = directionLock ? 1 : (pivot.index < 0 ? above : 1);
		view.fly = ease(view.fly, goal, sky.step, goal > view.fly ?
			viewSettings.followOpenTau : viewSettings.followCloseTau);
		// The pole's own travel, which completes a body diameter out rather than
		// at the ceiling: the far side of the sphere is charted at ladder(2R), so
		// until the hull is above that the ground would be drawn over it.
		goal = pivot.index < 0 && !sky.mode.bodyCentred ?
			R.util.clamp((altitude - view.switchAltitude) /
				Math.max(1, 2 * pivot.radius - view.switchAltitude), 0, 1) : 0;
		view.orbit = ease(view.orbit, goal, sky.step, goal > view.orbit ?
			viewSettings.followOpenTau : viewSettings.followCloseTau);
		poleDistance = pivot.radius * view.orbit;
		targetRadius = directionLock ? shipDistance : (pivot.index < 0 ?
			pivot.radius * Math.pow(shipDistance / Math.max(1e-9, pivot.radius), view.fly) :
			pivot.radius);
		pose.ladderRef = pivot.radius - poleDistance;
		if (shipDistance > 1e-9) {
			pose.poleX = pivot.x + dx / shipDistance * poleDistance;
			pose.poleY = pivot.y + dy / shipDistance * poleDistance;
			pose.targetX = pivot.x + dx / shipDistance * targetRadius;
			pose.targetY = pivot.y + dy / shipDistance * targetRadius;
		} else {
			pose.poleX = pivot.x;
			pose.poleY = pivot.y;
			pose.targetX = pivot.x;
			pose.targetY = pivot.y + targetRadius;
		}
		// The target's own depth holds the surface on the default line or the
		// rocket near the bottom in a direction-locked view.
		pose.targetDistance = Math.max(1e-9, targetRadius - poleDistance);
		pose.originLine = directionLock ? R.camera.height * viewSettings.directionLock.objectY :
			(pivot.index < 0 ? R.camera.baseGroundY +
				(R.camera.height * viewSettings.followHeight - R.camera.baseGroundY) * view.fly :
				R.camera.baseGroundY);
		pose.fly = view.fly;
		return shipDistance;
	}

	function solveFollow(game) {
		var shipDistance = solveTarget(game);
		var range;

		pose.pivotX = pivot.x;
		pose.pivotY = pivot.y;
		pose.pivotRadius = pivot.radius;
		pose.knee = view.knee;
		pose.far = view.ladderFar;
		pose.hold = false;
		range = dampedRange(fitRange(pose, game), sky.step);
		pose.range = range;
		pose.extent = fit.extent;
		pose.fitScale = (pose.originLine - R.camera.topY()) / Math.max(range, settings.minFitRange);
		return shipDistance;
	}

	// Keep the rocket at one lower-centre anchor, then roll the rendered chart
	// until either its velocity or its nose points screen-up. The map remains
	// the same log-polar projection; only its screen frame follows the axis.
	function lockDirection(game, axis) {
		var camera = R.camera;
		var rocket = game && game.rocket;
		var anchorX = camera.width * viewSettings.directionLock.centreX;
		var anchorY = camera.height * viewSettings.directionLock.objectY;
		var dx;
		var dy;
		var distance;
		var speed;
		var positionAngle;
		var directionAngle;

		if (!rocket) {
			camera.clearDirectionLock();
			return;
		}
		sky.shipPlane(game, shipPlane);
		dx = shipPlane.x - camera.poleX;
		dy = shipPlane.y - camera.poleY;
		distance = Math.max(1e-9, Math.sqrt(dx * dx + dy * dy));
		positionAngle = Math.atan2(dx, dy);
		directionAngle = rocket.heading;
		if (axis === 'prograde') {
			speed = Math.hypot(rocket.vx || 0, rocket.vy || 0);
			if (speed > R.aerodynamics.speedEpsilon) {
				directionAngle = Math.atan2(rocket.vx, rocket.vy);
			}
		}
		camera.directionLock = true;
		camera.screenRotation = -directionAngle;
		camera.screenOriginX = anchorX;
		camera.screenOriginY = anchorY;
		camera.baseOx = camera.ox = anchorX - camera.angularScale * positionAngle;
		camera.baseOy = camera.oy = anchorY + camera.scale * camera.depth(distance);
		camera.targetDistance = distance;
		camera.targetX = shipPlane.x;
		camera.targetY = shipPlane.y;
		camera.originLine = anchorY;
		camera.syncLines();
		camera.extent = R.coords.distanceAt(camera.depth(distance) + camera.range, camera);
	}

	// The ground state of a plane point: the pole it drags to, the ladder that
	// goes with it, the point held under the pointer and the line it ends on.
	sky.anchorGround = function(ax, ay) {
		var planet = R.world.planet;
		var best = -2;
		var bestGap = Infinity;
		var bestX = 0;
		var bestY = 0;
		var bestRadius = 1;
		var radius;
		var dx;
		var dy;
		var d;
		var gap;
		var i;

		anchor.bodyIndex = -2;
		for (i = -1; i < bodies.length; i += 1) {
			sky.bodyCentre(i, plane);
			radius = sky.bodyRadius(sky.bodyOf(i));
			dx = ax - plane.x;
			dy = ay - plane.y;
			d = Math.sqrt(dx * dx + dy * dy);
			if (d < radius) {
				// Inside a body: the pole goes to its centre and the surface
				// point nearest the grab is what the pointer holds, so a drag
				// ends at exactly the view a click on that body gives.
				anchor.bodyIndex = i;
				anchor.poleX = plane.x;
				anchor.poleY = plane.y;
				anchor.ladderRef = radius;
				anchor.knee = i < 0 ? planet.logAltitudeScale : radius;
				anchor.far = i < 0 ? viewSettings.ladderFar : 1;
				anchor.groundX = plane.x;
				anchor.groundY = plane.y;
				anchor.groundRadius = radius;
				if (d > 1e-9) {
					anchor.referenceX = plane.x + dx / d * radius;
					anchor.referenceY = plane.y + dy / d * radius;
				} else {
					anchor.referenceX = plane.x;
					anchor.referenceY = plane.y + radius;
				}
				anchor.reference = radius;
				anchor.line = R.camera.baseGroundY;
				return anchor;
			}
			gap = d - radius;
			if (gap < bestGap) {
				bestGap = gap;
				best = i;
				bestX = plane.x;
				bestY = plane.y;
				bestRadius = radius;
			}
		}
		// Free space: the pole lands on the nearest surface point — the ground
		// below the grab — and the grab itself is what the pointer holds. The
		// ladder starts at the pole, so depth below the line is dark space.
		dx = ax - bestX;
		dy = ay - bestY;
		d = Math.max(1e-9, Math.sqrt(dx * dx + dy * dy));
		anchor.bodyIndex = best;
		anchor.poleX = bestX + bestRadius * dx / d;
		anchor.poleY = bestY + bestRadius * dy / d;
		anchor.ladderRef = 0;
		anchor.knee = best < 0 ? planet.logAltitudeScale : bestRadius;
		anchor.far = best < 0 ? viewSettings.ladderFar : 1;
		anchor.groundX = bestX;
		anchor.groundY = bestY;
		anchor.groundRadius = bestRadius;
		anchor.referenceX = ax;
		anchor.referenceY = ay;
		anchor.reference = Math.max(bestGap, 1e-4);
		anchor.line = R.camera.height * viewSettings.freeGroundFraction;
		return anchor;
	};

	sky.handBegin = function(sx, sy, game) {
		sky.ensure();
		if (sky.mode.flat || sky.mode.directionLock) {
			return false;
		}
		R.camera.unprojectPlane(sx, sy, plane);
		sky.anchorGround(plane.x, plane.y);
		R.camera.endTransition();
		hand.active = true;
		hand.pointerX = sx;
		hand.pointerY = sy;
		hand.startX = sx;
		hand.startY = sy;
		hand.k = 0;
		hand.line = anchor.line;
		hand.seatIndex = anchor.bodyIndex;
		hand.referenceX = anchor.referenceX;
		hand.referenceY = anchor.referenceY;
		hand.fromPoleX = R.camera.poleX;
		hand.fromPoleY = R.camera.poleY;
		hand.fromLadderRef = R.camera.ladderRef;
		hand.fromKnee = R.camera.logScale;
		hand.fromFar = R.camera.ladderFar;
		hand.fromScale = R.camera.fitScale;
		hand.fromOriginLine = R.camera.originLine;
		hand.fromFly = R.camera.fly;
		hand.fromGroundX = R.camera.pivotX;
		hand.fromGroundY = R.camera.pivotY;
		hand.fromGroundRadius = R.camera.pivotRadius;
		hand.fromDistance = Math.max(1e-9, Math.hypot(hand.referenceX - R.camera.poleX,
			hand.referenceY - R.camera.poleY));
		hand.fromBearing = Math.atan2(R.camera.poleX - hand.referenceX, R.camera.poleY - hand.referenceY);
		hand.bearingDelta = wrapPi(Math.atan2(anchor.poleX - hand.referenceX,
			anchor.poleY - hand.referenceY) - hand.fromBearing);
		solveHand(game);
		return true;
	};

	sky.handMove = function(sx, sy) {
		hand.pointerX = sx;
		hand.pointerY = sy;
	};

	sky.handEnd = function() {
		var seat = hand.active && hand.k >= settings.handSeatFraction ? hand.seatIndex : -2;

		// The follow pose eases its ladder from the one on screen, not from the
		// one the drag started with, so a release cannot pull the curve back.
		view.knee = R.camera.logScale;
		view.ladderFar = R.camera.ladderFar;
		view.logScale = view.knee;
		hand.active = false;
		return seat;
	};

	// Downward progress toward the anchor's line drives the pole, the ladder and
	// the zoom to that anchor's ground state. The zoom density (1/scale) lerps
	// rather than the scale, so the visible log ring widens steadily onto the
	// system mid-drag instead of leaving it in the gap below the screen.
	function solveHand(game) {
		var camera = R.camera;
		var k = R.util.clamp((hand.pointerY - hand.startY) /
			Math.max(80, hand.line - hand.startY), 0, 1);
		var far;
		var knee;
		var distance;
		var bearing;
		var endRange;
		var endScale;

		hand.k = k;
		knee = hand.fromKnee * Math.pow(Math.max(1e-3, anchor.knee) / Math.max(1e-3, hand.fromKnee), k);
		far = hand.fromFar + (anchor.far - hand.fromFar) * k;
		distance = hand.fromDistance * Math.pow(Math.max(1e-9, anchor.reference) / hand.fromDistance, k);
		bearing = hand.fromBearing + hand.bearingDelta * k;
		pose.poleX = hand.referenceX + distance * Math.sin(bearing);
		pose.poleY = hand.referenceY + distance * Math.cos(bearing);
		pose.ladderRef = hand.fromLadderRef + (anchor.ladderRef - hand.fromLadderRef) * k;
		pose.pivotRadius = hand.fromGroundRadius + (anchor.groundRadius - hand.fromGroundRadius) * k;
		pose.pivotX = hand.fromGroundX + (anchor.groundX - hand.fromGroundX) * k;
		pose.pivotY = hand.fromGroundY + (anchor.groundY - hand.fromGroundY) * k;
		pose.originLine = hand.fromOriginLine + (anchor.line - hand.fromOriginLine) * k;
		pose.fly = hand.fromFly + (1 - hand.fromFly) * k;
		pose.knee = knee;
		pose.far = far;
		pose.targetDistance = Math.max(1e-9, distance);
		pose.targetX = hand.referenceX;
		pose.targetY = hand.referenceY;
		// The end scale is the anchor's own ground state: its pole, its ladder and
		// its line. The live span is what the chart is drawing right now.
		endRange = fitRangeOf(anchor.poleX, anchor.poleY, anchor.ladderRef, anchor.knee,
			Math.log1p(camera.ladderSwitch / Math.max(1e-3, anchor.knee)), anchor.far,
			anchor.reference, game);
		endScale = (anchor.line - camera.topY()) / Math.max(endRange, settings.minFitRange);
		pose.range = fitRange(pose, game);
		pose.extent = fit.extent;
		pose.fitScale = 1 / Math.max(1e-9,
			(1 - k) / Math.max(1e-9, hand.fromScale) + k / Math.max(1e-9, endScale));
		pose.hold = true;
		pose.holdX = hand.referenceX;
		pose.holdY = hand.referenceY;
		pose.holdSx = hand.pointerX;
		pose.holdSy = hand.pointerY;
	};

	// ------------------------------------------------------------- flat views

	// The body whose surface is nearest a plane point, and that surface point.
	function nearestSurface(px, py) {
		var best = -1;
		var bestGap = Infinity;
		var radius;
		var dx;
		var dy;
		var d;
		var i;

		for (i = -1; i < bodies.length; i += 1) {
			sky.bodyCentre(i, plane);
			radius = sky.bodyRadius(sky.bodyOf(i));
			dx = px - plane.x;
			dy = py - plane.y;
			d = Math.sqrt(dx * dx + dy * dy);
			if (d - radius >= bestGap) {
				continue;
			}
			bestGap = d - radius;
			best = i;
			surface.x = d > 1e-9 ? plane.x + dx / d * radius : plane.x;
			surface.y = d > 1e-9 ? plane.y + dy / d * radius : plane.y + radius;
		}
		flat.gap = Math.max(0, bestGap);
		return best;
	}

	// Real scale: the hull at the centre, the world's own up at the top, and a
	// fit that keeps the nearest ground a fixed drop below the hull — the
	// picture a camera hanging beside the rocket would take.
	//
	// The log variant reads the same picture from the nearest surface point:
	// bearings from it are kept and only distance is compressed, so the
	// ground curls away below the pole and the whole system fits above it.
	// When another body becomes the nearest the pole travels to it rather
	// than cutting.
	function solveFlat(game) {
		var camera = R.camera;
		var options = viewSettings.flat;
		var rocket = game && game.rocket;
		var nearest;
		var goal;
		var k;

		sky.shipPlane(game, shipPlane);
		nearest = nearestSurface(shipPlane.x, shipPlane.y);
		goal = camera.height * options.groundDrop / Math.max(options.minAltitude, flat.gap);
		if (!flat.ready) {
			flat.ready = true;
			flat.nearest = nearest;
			flat.swap = 1;
			flat.scale = goal;
		}
		if (nearest !== flat.nearest) {
			flat.nearest = nearest;
			flat.swap = 0;
			flat.fromX = flat.poleX;
			flat.fromY = flat.poleY;
		}
		flat.swap = Math.min(1, flat.swap + sky.step / options.swapSeconds);
		k = smoothstep(flat.swap);
		flat.poleX = flat.fromX + (surface.x - flat.fromX) * k;
		flat.poleY = flat.fromY + (surface.y - flat.fromY) * k;
		flat.scale *= Math.pow(goal / flat.scale, 1 - Math.exp(-sky.step / options.fitTau));

		flatPose.log = sky.mode.log;
		flatPose.pivotX = pivot.x;
		flatPose.pivotY = pivot.y;
		flatPose.pivotRadius = pivot.radius;
		flatPose.targetX = shipPlane.x;
		flatPose.targetY = shipPlane.y;
		flatPose.up = rocket ? (rocket.wx || 0) / camera.worldRadius : 0;
		flatPose.knee = R.world.planet.logAltitudeScale;
		flatPose.centreX = camera.width * options.centreX;
		if (!sky.mode.log) {
			flatPose.poleX = shipPlane.x;
			flatPose.poleY = shipPlane.y;
			flatPose.centreY = camera.height * options.shipY;
			flatPose.fitScale = flat.scale;
			flatPose.extent = camera.height / flat.scale;
			return;
		}
		flatPose.poleX = flat.poleX;
		flatPose.poleY = flat.poleY;
		flatPose.centreY = camera.height * options.poleY;
		flatPose.extent = maxExtentFrom(flat.poleX, flat.poleY, game);
		fit.extent = flatPose.extent;
		flatPose.fitScale = Math.min(flatPose.centreY - camera.topY(), camera.width * 0.5) /
			dampedRange(Math.log1p(flatPose.extent / flatPose.knee), sky.step);
	}

	sky.step = 0;

	sky.update = function(game, dt) {
		var planet = R.world.planet;
		var step = R.util.clamp(dt, 0, 0.25);
		var blend;

		sky.ensure();
		if (!sky.mode.directionLock && R.camera.directionLock) {
			R.camera.clearDirectionLock();
		}
		sky.step = step;
		simTime = simTimeOf(game);
		if (view.planetId !== planet.id) {
			view.from.gravity = view.gravity;
			view.from.radius = view.radius;
			view.planetId = planet.id;
			view.logScale = planet.logAltitudeScale;
			view.morph = 0;
			view.fly = 0;
			view.orbit = 0;
			fit.ready = false;
			R.camera.endTransition();
		}
		view.morph = Math.min(1, view.morph + step / viewSettings.transformSeconds);
		blend = smoothstep(view.morph);
		if (!sky.mode.flat) {
			approachSeat(game);
		}
		placePivot();

		// A landed chart compresses the top so distant bodies sit low over the
		// surface; the system view is a plain log, where every body is at its own
		// distance ratio from the pole and the orbits spread instead of stacking.
		// The knee follows the pole: the planet's metre ladder on its own
		// surface, the pivot body's radius once the chart stands on it.
		view.ladderFar = ease(view.ladderFar, pivot.index < 0 ? viewSettings.ladderFar : 1,
			step, settings.pivotSeconds * 0.5);
		view.knee = ease(view.knee, pivot.index < 0 ? planet.logAltitudeScale : pivot.radius,
			step, settings.pivotSeconds * 0.5);
		view.logScale = view.knee;
		view.ceiling = planet.maxAltitude;
		// Air belongs to the active world; a chart seated elsewhere has none.
		view.atmosphereTop = ease(view.atmosphereTop,
			pivot.index < 0 ? R.physics.atmosphereTop() : 0, step, settings.easeTau);
		// The altitude the pole leaves the pivot's centre at: the world's ceiling
		// while the chart stands on the world, a fraction of a catalog body's own
		// radius once it stands on that.
		view.switchAltitude = Math.max(view.atmosphereTop, pivot.radius * 0.5);
		view.gravity = view.from.gravity + (planet.surfaceGravity - view.from.gravity) * blend;
		view.radius = view.from.radius + (planet.radius - view.from.radius) * blend;

		R.camera.ladderSwitch = planet.ladderSwitch;
		// The zoom eases here, not beside the solve: the scale this frame solves
		// the pose with is the same one the zoom just moved, so a wheel notch
		// cannot move the ground and the lenses a frame apart.
		R.camera.easeZoom(step);
		if (sky.mode.flat) {
			solveFlat(game);
			R.camera.setFlat(flatPose);
			return view;
		}
		R.camera.stepTransition(step);
		if (hand.active) {
			solveHand(game);
		} else {
			solveFollow(game);
		}
		R.camera.setPose(pose);
		if (sky.mode.directionLock) {
			lockDirection(game, sky.mode.directionLock);
		}
		if (pivot.reseating && !R.camera.transition.active) {
			pivot.previousIndex = -1;
			pivot.reseating = false;
		}
		return view;
	};

	// A circle of the plane through a flat view's map, as `half * 2 + 1` screen
	// points. The samples start at the point of the circle nearest the pole and
	// step away from it geometrically on both sides, sized by how close that
	// point is, so the horizon under a landed hull is as smooth as a moon a
	// thousand radii out — in either flat map, since both are finest at the
	// pole.
	function sampleCircle(cx, cy, rho, half, xs, ys) {
		var camera = R.camera;
		var dx = camera.poleX - cx;
		var dy = camera.poleY - cy;
		var toPole = Math.atan2(dx, dy);
		var pixel = (camera.flatLog ? camera.logScale : 1) / camera.scale;
		var spread = R.util.clamp(Math.log(Math.PI * rho /
			Math.max(pixel, Math.abs(Math.sqrt(dx * dx + dy * dy) - rho))), 0.01, 30);
		var full = Math.expm1(spread);
		var angle;
		var j;

		for (j = -half; j <= half; j += 1) {
			angle = toPole + (j < 0 ? -Math.PI : Math.PI) *
				Math.expm1(spread * Math.abs(j) / half) / full;
			R.coords.flatToScreen(cx + rho * Math.sin(angle), cy + rho * Math.cos(angle), camera, plane);
			xs[j + half] = plane.x;
			ys[j + half] = plane.y;
		}
	}

	function ringOf(cx, cy, rho, game) {
		var camera = R.camera;
		var dx = camera.poleX - cx;
		var dy = camera.poleY - cy;
		var minX = Infinity;
		var maxX = -Infinity;
		var minY = Infinity;
		var maxY = -Infinity;
		var away;
		var j;

		sampleCircle(cx, cy, rho, RING, shape.ringXs, shape.ringYs);
		for (j = 0; j <= RING * 2; j += 1) {
			minX = Math.min(minX, shape.ringXs[j]);
			maxX = Math.max(maxX, shape.ringXs[j]);
			minY = Math.min(minY, shape.ringYs[j]);
			maxY = Math.max(maxY, shape.ringYs[j]);
		}
		shape.ring = true;
		shape.visible = true;
		shape.distance = Math.sqrt(dx * dx + dy * dy);
		shape.halfWidth = (maxX - minX) * 0.5;
		shape.centerX = (maxX + minX) * 0.5;
		shape.centerY = (maxY + minY) * 0.5;
		shape.nearY = maxY;
		shape.farY = minY;
		R.coords.flatToScreen(cx, cy, camera, plane);
		shape.bodyX = plane.x;
		shape.bodyY = plane.y;
		if (bodies.length > 0) {
			sky.planePosition(bodies[0], simTimeOf(game), starPlane);
			away = Math.atan2(cx - starPlane.x, cy - starPlane.y);
			R.coords.flatToScreen(cx + rho * Math.sin(away), cy + rho * Math.cos(away), camera, plane);
			shape.nightAngle = Math.atan2(plane.y - shape.bodyY, plane.x - shape.bodyX);
		}
		return shape;
	}

	// The air shell of the active world as a flat view's ring.
	sky.airRing = function(game) {
		shape.alpha = 1;
		shape.index = -1;
		return ringOf(0, 0, view.radius + view.atmosphereTop, game);
	};

	// A body's lens in screen space. With `alpha` its angular radius from the
	// pole and `psi` the offset inside that angle, the near and far limbs are
	// the two intersections of the ray with the sphere:
	//
	//     half = sqrt(rho² − D² sin²psi)
	//     near = D cosψ − half        far = D cosψ + half
	//
	// and the chart's own map puts them on screen. Nothing here is an ellipse:
	// the two limbs genuinely differ, which is what gives a close body its
	// cutaway and a distant one its lens. A body that contains the pole has no
	// lens — it is the ground.
	sky.outline = function(index, game) {
		var body = sky.bodyOf(index);
		var camera = R.camera;
		var rho = sky.bodyRadius(body);
		var dx;
		var dy;
		var distance;
		var centreAngle;
		var alpha;
		var psi;
		var cosPsi;
		var half;
		var j;

		shape.visible = false;
		shape.alpha = 1;
		shape.index = index;
		shape.ring = false;
		if (index < 0) {
			plane.x = 0;
			plane.y = 0;
		} else {
			sky.planePosition(body, simTimeOf(game), plane);
		}
		if (camera.flat) {
			return ringOf(plane.x, plane.y, rho, game);
		}
		dx = plane.x - camera.poleX;
		dy = plane.y - camera.poleY;
		distance = Math.sqrt(dx * dx + dy * dy);
		if (distance <= rho) {
			return shape;
		}
		alpha = Math.asin(R.util.clamp(rho / distance, 0, 1));
		centreAngle = Math.atan2(dx, dy);
		shape.visible = true;
		shape.distance = distance;
		shape.angularRadius = alpha;
		shape.halfWidth = alpha * camera.angularScale;
		shape.centerX = camera.ox + camera.angularScale * centreAngle;
		// The near limb is the part of the sphere closest to the pole, and the
		// pole's own depth is below it on screen, so the near limb is the *lower*
		// edge of the lens: `nearY` is greater than `farY`.
		shape.nearY = sky.depthY(distance - rho);
		shape.farY = sky.depthY(distance + rho);
		for (j = 0; j <= SAMPLES; j += 1) {
			psi = -alpha + 2 * alpha * j / SAMPLES;
			cosPsi = Math.cos(psi);
			half = Math.sqrt(Math.max(0, rho * rho - distance * distance * Math.sin(psi) * Math.sin(psi)));
			shape.xs[j] = camera.ox + camera.angularScale * (centreAngle + psi);
			shape.nearYs[j] = sky.depthY(Math.max(1e-9, distance * cosPsi - half));
			shape.farYs[j] = sky.depthY(Math.max(1e-9, distance * cosPsi + half));
		}
		shape.centerY = (shape.nearY + shape.farY) * 0.5;
		if (bodies.length > 0) {
			sky.planePosition(bodies[0], simTimeOf(game), starPlane);
			shape.shade = R.util.clamp(0.55 + 0.45 * Math.cos(centreAngle -
				Math.atan2(starPlane.x - camera.poleX, starPlane.y - camera.poleY)), 0, 1);
		}
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
	// renderer draws (including the minimum-height stretch, so a distant body is
	// clickable). Returns the body index (-1 for the world), or -2 for empty
	// space. The body under the pole is the ground, never a pick.
	sky.pick = function(mx, my, game) {
		var camera = R.camera;
		var best = -2;
		var bestDistance = Infinity;
		var halfHeight;
		var dx;
		var dy;
		var distance;
		var i;
		var lens;

		if (camera.directionLock) {
			camera.unrotateScreen(mx, my, pickScreen);
			mx = pickScreen.x;
			my = pickScreen.y;
		}
		for (i = -1; i < bodies.length; i += 1) {
			lens = sky.outline(i, game);
			if (!lens.visible) {
				continue;
			}
			halfHeight = Math.max(sky.iconRadius(i), (lens.nearY - lens.farY) * 0.5);
			// The chart is a cylinder: a body is clickable in whichever lap of it
			// the pointer is nearest.
			dx = R.coords.wrapScreenX(lens.centerX, mx, camera.period) - mx;
			dy = lens.centerY - my;
			distance = Math.sqrt(dx * dx + dy * dy);
			if (distance >= Math.max(10, Math.max(lens.halfWidth, sky.iconRadius(i)) + halfHeight)) {
				continue;
			}
			if (distance >= bestDistance) {
				continue;
			}
			// Ellipse test in the lens's own axes, so the rim is the rim.
			if ((dx * dx) / Math.max(1, lens.halfWidth * lens.halfWidth) +
				(dy * dy) / Math.max(1, halfHeight * halfHeight) > 1.2) {
				continue;
			}
			best = i;
			bestDistance = distance;
		}
		return best;
	};

	// A catalog body's orbit around the active world, sampled through the same
	// map that draws its lens: the circle is charted, not drawn as an ellipse.
	// Samples the pole cannot place are dropped — an orbit that runs through the
	// log pole is singular, its bearing sweeping a full turn while its distance
	// goes to zero, and no sampling can fix that.
	sky.orbit = function(index) {
		var camera = R.camera;
		var distance;
		var singular;
		var body;
		var i;
		var angle;
		var px;
		var py;
		var dx;
		var dy;
		var d;

		orbit.valid = false;
		orbit.count = 0;
		orbit.period = camera.period;
		if (index < 0) {
			return orbit;
		}
		body = bodies[index];
		distance = body.distanceRadii * view.radius;
		if (!(distance > 0)) {
			return orbit;
		}
		// The body the chart stands on does not draw its own orbit: its centre is
		// the pole, and the image of a circle through the pole whips a whole
		// period along the ground line.
		singular = camera.flat ? 0 : Math.max(1, camera.pivotRadius) * settings.orbitPoleGuard;
		if (Math.abs(distance - Math.sqrt(camera.poleX * camera.poleX +
			camera.poleY * camera.poleY)) < singular) {
			return orbit;
		}
		orbit.valid = true;
		orbit.radius = distance;
		if (camera.flat) {
			sampleCircle(0, 0, distance, ORBIT_N >> 1, orbit.xs, orbit.ys);
			orbit.count = ORBIT_N + 1;
			return orbit;
		}
		for (i = 0; i <= ORBIT_N; i += 1) {
			angle = TWO_PI * i / ORBIT_N;
			px = distance * Math.sin(angle);
			py = distance * Math.cos(angle);
			dx = px - camera.poleX;
			dy = py - camera.poleY;
			d = Math.sqrt(dx * dx + dy * dy);
			if (d < singular) {
				orbit.xs[i] = NaN;
				orbit.ys[i] = NaN;
				continue;
			}
			R.coords.planeToScreen(px, py, camera, plane);
			orbit.xs[i] = plane.x;
			orbit.ys[i] = plane.y;
			orbit.count += 1;
		}
		return orbit;
	};

	// Screen y of the sphere of `radius` around the ground body's centre on the
	// column whose ray leaves the pole at `angle`. The pole is inside that
	// sphere, so the column exits it at the forward root — one sqrt per column,
	// no silhouette sampling and no seam. Returns -1 when the pole is outside.
	sky.enclosingDistance = function(radius, angle) {
		var camera = R.camera;
		var dx = camera.pivotX - camera.poleX;
		var dy = camera.pivotY - camera.poleY;
		var d2 = dx * dx + dy * dy;
		var dot;

		if (d2 > radius * radius * GROUND_SLACK) {
			return -1;
		}
		dot = dx * Math.sin(angle) + dy * Math.cos(angle);
		// A ray that leaves the pole grazing the sphere exits at the pole itself.
		// The root rounds a hair below zero there, and a negative distance is the
		// sentinel's territory, not a place on the chart.
		return Math.max(0, dot + Math.sqrt(Math.max(0, dot * dot + radius * radius - d2)));
	};

	sky.enclosingY = function(radius, angle) {
		var distance = sky.enclosingDistance(radius, angle);

		return distance < 0 ? NaN : sky.depthY(distance);
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = sky;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
