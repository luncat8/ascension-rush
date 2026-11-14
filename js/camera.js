(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var camera = R.camera || (R.camera = {});
	var TWO_PI = Math.PI * 2;
	var scratch = { x: 0, y: 0 };

	// The chart's projection state, and the only place a pan, a zoom, a follow
	// or a hand-over can move the view. sky.js solves one pose per frame and
	// hands it over; coords.js reads it; the renderer and the picker read the
	// same numbers the projection writes, so nothing can disagree.
	//
	// A pose is the pole the log is measured from, the body that pole stands on,
	// the ladder, the camera target's distance (what the origin line holds), the
	// origin line itself, and the fitted scale with the log span it was fitted
	// over. Everything else here is derived.

	camera.width = 1;
	camera.height = 1;
	camera.baseGroundY = 1;

	// Live pose. `oy` is the ground line by construction: the ladder starts at
	// depth zero, so the body under the pole — or the pole itself in free space
	// — sits exactly on it.
	camera.poleX = 0;
	camera.poleY = 0;
	camera.pivotX = 0;
	camera.pivotY = 0;
	camera.ladderRef = 1;
	camera.pivotRadius = 1;
	camera.worldRadius = 1;
	camera.targetDistance = 1;
	camera.targetX = 0;
	camera.targetY = 1;
	camera.scale = 1;
	camera.fitScale = 1;
	camera.angularScale = 1;
	camera.stretch = 1;
	camera.period = 1;
	camera.range = 1;
	camera.extent = 1;
	camera.originLine = 1;
	camera.ox = 0;
	camera.oy = 0;
	camera.baseOx = 0;
	camera.baseOy = 0;
	// Screen lines: the ground is depth zero so it is `oy` itself, and the
	// origin line is the camera target's own depth above it.
	camera.groundY = 1;
	camera.originY = 1;
	camera.logScale = 1;
	camera.ladderSwitch = 1;
	camera.ladderQ0 = 0;
	camera.ladderFar = 1;
	camera.planetId = '';

	// Wheel zoom: 1 is the fitted view, above 1 is closer. A drag is not a pan
	// offset: it holds a point of the plane under the pointer, so looking around
	// without moving the pole is the horizontal part of the same gesture.
	camera.zoom = 1;
	camera.zoomTarget = 1;
	// How much of the chart is the system view rather than the deck. Zero keeps
	// one circumference per viewport on the tangential axis — the deck has to
	// show a whole world, and the fitted radial scale is far too small for that
	// — and one makes both axes share the fitted scale, so a body is round
	// instead of stretched. sky.js eases it as the target leaves the ground, so
	// the two regimes are one continuous map rather than a switch.
	camera.fly = 0;
	// The flat views: the plane drawn as it is around `pole`, which sits at
	// `ox / oy`, with the unit vector (upSin, upCos) at the top of the screen.
	// `scale` is pixels per metre, or per log unit of `logScale` with `flatLog`.
	camera.flat = false;
	camera.flatLog = false;
	camera.upSin = 0;
	camera.upCos = 1;
	camera.zoomMin = R.constants.view.zoomMin;
	camera.zoomMax = R.constants.view.zoomMax;

	function newPose() {
		return {
			poleX: 0, poleY: 0, pivotX: 0, pivotY: 0,
			ladderRef: 1, pivotRadius: 1, knee: 1, far: 1,
			targetDistance: 1, targetX: 0, targetY: 1,
			originLine: 1, fitScale: 1, range: 1, extent: 1, fly: 0,
			hold: false, holdX: 0, holdY: 0, holdSx: 0, holdSy: 0
		};
	}

	// The pose sky.js solved this frame, the pose a hand-over started from, and
	// the blend of the two. A hand-over interpolates from `from` to `want`; with
	// no hand-over the live pose is `want`.
	camera.want = newPose();
	camera.from = newPose();
	camera.pose = newPose();

	// A hand-over holds one plane point still while the pole, the ladder and the
	// scale travel to their new values. The anchor's screen place eases to the
	// rest place the destination pose gives it, so the end of the transition is
	// the destination pose and nothing snaps.
	// `sx / sy` is where the held point is on screen this frame: the eased place
	// the offsets were solved for. A test reads it to check the hand-over, and a
	// debug overlay can draw the point the chart is travelling under.
	camera.transition = {
		active: false,
		t: 1,
		k: 1,
		seconds: 1,
		anchorX: 0,
		anchorY: 0,
		fromSx: 0,
		fromSy: 0,
		sx: 0,
		sy: 0
	};

	// The ladder's three numbers. The knee sets how much of the chart the
	// atmosphere gets; the switch and the far slope decide how hard the layers
	// above it are compressed.
	camera.setLadder = function(knee, switchAltitude, far) {
		camera.logScale = Math.max(1e-3, knee);
		camera.ladderSwitch = Math.max(camera.logScale, switchAltitude);
		camera.ladderFar = R.util.clamp(far, 0.02, 1);
		camera.ladderQ0 = Math.log1p(camera.ladderSwitch / camera.logScale);
	};

	camera.topY = function() {
		return camera.height * R.constants.view.chartTopFraction;
	};

	camera.depth = function(distance) {
		return R.coords.depthOf(distance, camera);
	};

	// The screen lines the coords and the renderer read: the pose is complete once
	// its offsets are solved, so these two are derived and nothing else is.
	camera.syncLines = function() {
		camera.ox = camera.baseOx;
		camera.oy = camera.baseOy;
		// The ground is depth zero, so the ground line is `oy` itself; the origin
		// line is the camera target's own depth above it. Landed, the two are the
		// same line; above the air the target is the ship and the ground has sunk
		// below it by exactly the climb.
		camera.groundY = camera.oy;
		camera.originY = camera.oy - camera.scale * camera.depth(camera.targetDistance);
	};

	function applyPose(next) {
		var targetAngle;
		var deckStretch;
		var holdAngle;
		var holdDepth;

		camera.flat = false;
		camera.poleX = next.poleX;
		camera.poleY = next.poleY;
		camera.pivotX = next.pivotX;
		camera.pivotY = next.pivotY;
		camera.ladderRef = Math.max(0, next.ladderRef);
		camera.pivotRadius = Math.max(1e-6, next.pivotRadius);
		camera.targetDistance = Math.max(1e-9, next.targetDistance);
		camera.targetX = next.targetX;
		camera.targetY = next.targetY;
		camera.fly = R.util.clamp(next.fly, 0, 1);
		camera.range = Math.max(1e-3, next.range);
		camera.originLine = next.originLine;
		camera.setLadder(next.knee, camera.ladderSwitch, next.far);
		camera.fitScale = Math.max(1e-6, next.fitScale);
		camera.scale = camera.fitScale * camera.zoom;
		// One circumference per viewport on the deck, one shared scale in the
		// system view, and every blend in between.
		deckStretch = camera.width / (TWO_PI * camera.fitScale);
		camera.stretch = deckStretch + (1 - deckStretch) * camera.fly;
		camera.angularScale = camera.scale * camera.stretch;
		camera.period = TWO_PI * camera.angularScale;
		if (next.hold) {
			// A drag holds its own point under the pointer instead of the target
			// on its line: same solve, different anchor.
			holdAngle = Math.atan2(next.holdX - camera.poleX, next.holdY - camera.poleY);
			holdDepth = camera.depth(Math.max(1e-9, Math.hypot(next.holdX - camera.poleX,
				next.holdY - camera.poleY)));
			camera.baseOx = next.holdSx - camera.angularScale * holdAngle;
			camera.baseOy = next.holdSy + camera.scale * holdDepth;
		} else {
			targetAngle = Math.atan2(next.targetX - camera.poleX, next.targetY - camera.poleY);
			camera.baseOx = camera.width * R.constants.view.cameraAnchorFraction -
				camera.angularScale * targetAngle;
			camera.baseOy = next.originLine + camera.scale * camera.depth(camera.targetDistance);
		}
		camera.extent = R.coords.distanceAt(camera.depth(camera.targetDistance) + camera.range, camera);
		camera.syncLines();
	}

	function copyPose(from, to) {
		to.poleX = from.poleX;
		to.poleY = from.poleY;
		to.pivotX = from.pivotX;
		to.pivotY = from.pivotY;
		to.ladderRef = from.ladderRef;
		to.pivotRadius = from.pivotRadius;
		to.knee = from.knee;
		to.far = from.far;
		to.targetDistance = from.targetDistance;
		to.targetX = from.targetX;
		to.targetY = from.targetY;
		to.originLine = from.originLine;
		to.fitScale = from.fitScale;
		to.range = from.range;
		to.extent = from.extent;
		to.fly = from.fly;
		to.hold = from.hold;
		to.holdX = from.holdX;
		to.holdY = from.holdY;
		to.holdSx = from.holdSx;
		to.holdSy = from.holdSy;
		return to;
	}

	// Distances, scales and the ladder's knee blend geometrically: on a log
	// chart a linear lerp of any of them crawls through the middle of a
	// hand-over and then rushes the end.
	function blendPose(from, to, k, out) {
		out.poleX = from.poleX + (to.poleX - from.poleX) * k;
		out.poleY = from.poleY + (to.poleY - from.poleY) * k;
		out.pivotX = from.pivotX + (to.pivotX - from.pivotX) * k;
		out.pivotY = from.pivotY + (to.pivotY - from.pivotY) * k;
		out.ladderRef = from.ladderRef + (to.ladderRef - from.ladderRef) * k;
		out.pivotRadius = from.pivotRadius + (to.pivotRadius - from.pivotRadius) * k;
		out.targetX = from.targetX + (to.targetX - from.targetX) * k;
		out.targetY = from.targetY + (to.targetY - from.targetY) * k;
		out.originLine = from.originLine + (to.originLine - from.originLine) * k;
		out.range = from.range + (to.range - from.range) * k;
		out.extent = from.extent + (to.extent - from.extent) * k;
		out.fly = from.fly + (to.fly - from.fly) * k;
		out.far = from.far + (to.far - from.far) * k;
		out.knee = from.knee * Math.pow(Math.max(1e-3, to.knee) / Math.max(1e-3, from.knee), k);
		out.targetDistance = from.targetDistance *
			Math.pow(Math.max(1e-9, to.targetDistance) / Math.max(1e-9, from.targetDistance), k);
		out.fitScale = from.fitScale *
			Math.pow(Math.max(1e-9, to.fitScale) / Math.max(1e-9, from.fitScale), k);
		return out;
	}

	// Solve the pose sky.js handed over. With no hand-over this is the whole
	// frame's camera; during one the anchor's screen place runs from where the
	// gesture started to where the destination pose puts it, and the offsets are
	// solved from that place — so the chart travels under a point the player can
	// watch, and the last frame needs no correction at all.
	//
	// The destination place is read from the destination pose itself rather than
	// from the blend: the blend's own projection of the anchor swings by
	// thousands of pixels mid-transition (halfway between two poles and two
	// ladders is nowhere in particular), which would sweep the anchor across the
	// screen instead of holding it.
	camera.setPose = function(next) {
		var transition = camera.transition;
		var restX;
		var restY;
		var k;

		copyPose(next, camera.want);
		if (!transition.active) {
			copyPose(camera.want, camera.from);
			applyPose(camera.want);
			return;
		}
		k = transition.k;
		applyPose(camera.want);
		R.coords.planeToScreen(transition.anchorX, transition.anchorY, camera, scratch);
		// In the lap the anchor started in, so a period of wrap — the chart's own
		// period, which travels during the hand-over — is never read as a jump.
		restX = R.coords.wrapScreenX(scratch.x, transition.fromSx, camera.period);
		restY = scratch.y;
		blendPose(camera.from, camera.want, k, camera.pose);
		applyPose(camera.pose);
		R.coords.planeToScreen(transition.anchorX, transition.anchorY, camera, scratch);
		transition.sx = transition.fromSx + (restX - transition.fromSx) * k;
		transition.sy = transition.fromSy + (restY - transition.fromSy) * k;
		camera.baseOx += transition.sx - scratch.x;
		camera.baseOy += transition.sy - scratch.y;
		camera.syncLines();
	};

	// A flat view has no pose to blend: sky.js eases what moves in it, so the
	// camera only takes the numbers. The ground line stays where the deck has
	// it, which is what the HUD panels stand on.
	camera.setFlat = function(next) {
		camera.endTransition();
		camera.flat = true;
		camera.flatLog = next.log;
		camera.poleX = next.poleX;
		camera.poleY = next.poleY;
		camera.pivotX = next.pivotX;
		camera.pivotY = next.pivotY;
		camera.pivotRadius = Math.max(1e-6, next.pivotRadius);
		camera.targetX = next.targetX;
		camera.targetY = next.targetY;
		camera.upSin = Math.sin(next.up);
		camera.upCos = Math.cos(next.up);
		camera.logScale = Math.max(1e-3, next.knee);
		camera.fitScale = Math.max(1e-12, next.fitScale);
		camera.scale = camera.fitScale * camera.zoom;
		camera.extent = next.extent;
		camera.fly = 1;
		camera.period = 0;
		camera.ox = camera.baseOx = next.centreX;
		camera.oy = camera.baseOy = next.centreY;
		camera.groundY = camera.baseGroundY;
		camera.originY = next.centreY;
	};

	// The wheel's band belongs to the view: a flat view has to reach from one
	// hull to the whole system, a chart only trims its fit.
	camera.setZoomBand = function(min, max) {
		camera.zoomMin = min;
		camera.zoomMax = max;
		camera.zoomTarget = R.util.clamp(camera.zoomTarget, min, max);
	};

	// Start a hand-over from the pose on screen. `anchorX / anchorY` is the plane
	// point that must not move; its screen place is read from the live pose, so
	// the first frame of the transition reproduces the last frame before it.
	camera.beginTransition = function(anchorX, anchorY, seconds) {
		var transition = camera.transition;

		// `from` is the pose actually on screen, which during a previous
		// transition is the live one, not that transition's destination.
		camera.from.poleX = camera.poleX;
		camera.from.poleY = camera.poleY;
		camera.from.pivotX = camera.pivotX;
		camera.from.pivotY = camera.pivotY;
		camera.from.ladderRef = camera.ladderRef;
		camera.from.pivotRadius = camera.pivotRadius;
		camera.from.knee = camera.logScale;
		camera.from.far = camera.ladderFar;
		camera.from.targetDistance = camera.targetDistance;
		camera.from.targetX = camera.targetX;
		camera.from.targetY = camera.targetY;
		camera.from.originLine = camera.originLine;
		camera.from.fitScale = camera.fitScale;
		camera.from.range = camera.range;
		camera.from.extent = camera.extent;
		camera.from.fly = camera.fly;
		transition.anchorX = anchorX;
		transition.anchorY = anchorY;
		transition.seconds = Math.max(0.05, seconds);
		transition.t = 0;
		transition.k = 0;
		R.coords.planeToScreen(anchorX, anchorY, camera, scratch);
		transition.fromSx = scratch.x;
		transition.fromSy = scratch.y;
		transition.active = true;
		return transition;
	};

	camera.stepTransition = function(dt) {
		var transition = camera.transition;
		var t;

		if (!transition.active) {
			return false;
		}
		t = Math.min(1, transition.t + dt / transition.seconds);
		transition.t = t;
		transition.k = t * t * (3 - 2 * t);
		if (t >= 1) {
			transition.active = false;
		}
		return transition.active;
	};

	// Snap a hand-over to its destination: a resize, a restart or a world switch
	// has no business animating.
	camera.endTransition = function() {
		camera.transition.active = false;
		camera.transition.t = 1;
		camera.transition.k = 1;
	};

	// Derived values from the active planet and the viewport. A planet change
	// resets the ladder and the zoom to that world's defaults; a resize keeps the
	// zoom, so the view does not jump when the window changes.
	camera.configure = function() {
		var planet = R.world.planet;

		camera.baseGroundY = camera.height * (1 - R.constants.view.groundFraction);
		camera.worldRadius = planet.radius;
		camera.ladderSwitch = planet.ladderSwitch;
		if (camera.planetId === planet.id) {
			return;
		}
		camera.planetId = planet.id;
		camera.zoom = 1;
		camera.zoomTarget = 1;
		camera.setLadder(planet.logAltitudeScale, planet.ladderSwitch, R.constants.view.ladderFar);
	};

	camera.resize = function(width, height) {
		camera.width = Math.max(1, width);
		camera.height = Math.max(1, height);
		camera.configure();
	};

	camera.resetZoom = function() {
		camera.zoom = 1;
		camera.zoomTarget = 1;
		camera.syncLines();
	};

	// Wheel zoom. The target is clamped so a hard flick cannot leave the chart;
	// sky.js eases it into `zoom` on the same frame it solves the scale, so a
	// notch cannot move the ground and the lenses a frame apart. The zoom is about
	// the camera target, which the origin line holds, so it never moves the
	// ground line while the ground is the target.
	camera.zoomBy = function(factor) {
		camera.zoomTarget = R.util.clamp(camera.zoomTarget * factor, camera.zoomMin, camera.zoomMax);
	};

	camera.easeZoom = function(dt) {
		var target = camera.zoomTarget;

		if (dt <= 0) {
			camera.zoom = target;
			return;
		}
		// Geometric, so a notch is the same gesture at every zoom of a band
		// six decades wide.
		if (camera.zoom !== target) {
			camera.zoom *= Math.pow(target / camera.zoom,
				1 - Math.exp(-dt / R.constants.view.zoomTau));
		}
	};

	camera.project = function(wx, wy, out) {
		return R.coords.worldToScreen(wx, wy, camera, out);
	};

	camera.unproject = function(sx, sy, out) {
		return R.coords.screenToWorld(sx, sy, camera, out);
	};

	camera.projectPlane = function(px, py, out) {
		return R.coords.planeToScreen(px, py, camera, out);
	};

	camera.unprojectPlane = function(sx, sy, out) {
		return R.coords.screenToPlane(sx, sy, camera, out);
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = camera;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
