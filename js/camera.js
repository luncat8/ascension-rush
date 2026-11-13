(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var camera = R.camera || (R.camera = {});

	// The chart's projection state. Both of its spellings — the deck's closed
	// rectilinear form and the general log-polar form away from the world —
	// read these fields, so there is exactly one place a pan, a zoom or a
	// follow can move the view.
	camera.flat = true;
	camera.leftWx = 0;
	camera.baseLeftWx = 0;
	camera.width = 1;
	camera.height = 1;
	camera.groundY = 1;
	camera.baseGroundY = 1;
	camera.usableHeight = 1;
	camera.pixelsPerMeterX = 1;
	camera.circumference = 1;
	// The altitude ladder: planet knee, the switch altitude (as its log) and
	// the slope beyond it. sky.js and coords.js read all three.
	camera.logScale = 1;
	camera.ladderSwitch = 1;
	camera.ladderQ0 = 0;
	camera.ladderFar = 1;
	// The charted extent: the top edge of the deck, and the clamp on any
	// altitude the chart is asked to place.
	camera.ceiling = 1;
	camera.altitudeLogRange = 1;
	camera.planetId = '';

	// Drag pan, in screen pixels, on top of the followed pose: the follow owns
	// the base, the pointer owns the pan, and neither overwrites the other. A
	// seat never clears it, so a hand-over starts where the user left the view.
	camera.panX = 0;
	camera.panY = 0;
	// Vertical follow, in screen pixels: zero while the ship is under its
	// planet's air, then it slides the chart so the hull sits at the follow
	// height. The pointer's pan is added on top of it.
	camera.trackY = 0;
	// The air column the follow ignores, from sky.js.
	camera.airTop = 0;
	// Wheel zoom: 1 is the fitted view, above 1 is closer.
	camera.zoom = 1;
	camera.zoomTarget = 1;

	// Log-polar state, used while the chart is seated away from the world.
	camera.pivotX = 0;
	camera.pivotY = 0;
	camera.pivotRadius = 1;
	// Radius of the active world: a world state is a radius from that centre.
	camera.worldRadius = 1;
	camera.ox = 0;
	camera.oy = 0;
	camera.baseOx = 0;
	camera.baseOy = 0;
	camera.scalePx = 1;

	// The ladder's three numbers, from a planet record. The knee sets how much
	// of the chart the atmosphere gets; the switch and the far slope decide how
	// much the top layers are compressed.
	camera.setLadder = function(knee, switchAltitude, far) {
		camera.logScale = Math.max(1e-3, knee);
		camera.ladderSwitch = Math.max(camera.logScale, switchAltitude);
		camera.ladderFar = R.util.clamp(far, 0.02, 1);
		camera.ladderQ0 = Math.log1p(camera.ladderSwitch / camera.logScale);
	};

	// The charted extent: everything the chart must place. It is the deck's top
	// edge and the clamp on any altitude read from the chart.
	camera.setExtent = function(extent) {
		camera.ceiling = Math.max(camera.logScale, extent);
		camera.altitudeLogRange = Math.max(1e-3,
			R.coords.ladder(camera.ceiling, camera));
	};

	// The same in the ladder's own units. sky.js hands over the damped range it
	// is actually drawing, so the deck's closed form and the system view's
	// general form are the same scale to the last bit — not two fits that nearly
	// agree.
	camera.setRangeUnits = function(units) {
		camera.altitudeLogRange = Math.max(1e-3, units);
		camera.ceiling = Math.max(camera.logScale,
			R.coords.unladder(camera.altitudeLogRange, camera.logScale, camera.ladderQ0, camera.ladderFar));
	};

	camera.setCircumference = function(circumference) {
		camera.circumference = Math.max(1, circumference);
		camera.pixelsPerMeterX = camera.width / camera.circumference * camera.zoom;
	};

	// Seat the chart on a body. `pivotX / pivotY` is that body's centre in the
	// plane, `pivotRadius` its radius, `extent` the farthest charted distance
	// from that centre. The shared scale follows from putting the extent at the
	// top of the viewport, so the whole system shares one scale — the property
	// that makes distant bodies round instead of squashed.
	camera.setPolar = function(pivotX, pivotY, pivotRadius, extent) {
		camera.pivotX = pivotX;
		camera.pivotY = pivotY;
		camera.pivotRadius = Math.max(1, pivotRadius);
		camera.setExtent(extent);
		camera.scalePx = (camera.baseGroundY - camera.topY()) /
			Math.max(camera.altitudeLogRange, 0.2) * camera.zoom;
		camera.baseOx = camera.width * R.constants.view.cameraAnchorFraction;
		camera.baseOy = camera.baseGroundY;
		camera.syncPan();
	};

	camera.topY = function() {
		return camera.height * R.constants.view.chartTopFraction;
	};

	// Derived values from the active planet and viewport. A planet change
	// resets the ladder, pan and zoom to that world's defaults; a resize keeps
	// pan and zoom, so the view does not jump when the window changes.
	camera.configure = function() {
		var planet = R.world.planet;
		var view = R.constants.view;

		camera.setCircumference(planet.circumference);
		camera.baseGroundY = camera.height * (1 - view.groundFraction);
		if (camera.planetId !== planet.id) {
			camera.planetId = planet.id;
			camera.panX = 0;
			camera.panY = 0;
			camera.zoom = 1;
			camera.zoomTarget = 1;
			camera.setLadder(planet.logAltitudeScale, planet.ladderSwitch, view.ladderFar);
			// Before the sky has charted anything, the deck fits the planet's
			// own altitude band.
			camera.setExtent(planet.maxAltitude);
			camera.syncPan();
			return;
		}
		camera.setExtent(camera.ceiling);
		camera.syncPan();
	};

	camera.resize = function(width, height) {
		camera.width = Math.max(1, width);
		camera.height = Math.max(1, height);
		camera.configure();
	};

	// Effective pose = followed base + pointer pan + wheel zoom. Coords and the
	// renderer read only these fields.
	camera.syncPan = function() {
		var anchorWidth = camera.width * R.constants.view.cameraAnchorFraction;

		if (camera.flat) {
			// The deck zooms about the ship, which the follow keeps at the
			// anchor fraction, and pans 1:1 with the pointer.
			camera.pixelsPerMeterX = camera.width / camera.circumference * camera.zoom;
			camera.leftWx = camera.baseLeftWx + camera.circumference * R.constants.view.cameraAnchorFraction -
				(anchorWidth + camera.panX) / Math.max(1e-9, camera.pixelsPerMeterX);
		} else {
			camera.leftWx = camera.baseLeftWx + camera.panX / Math.max(1e-9, camera.pixelsPerMeterX);
		}
		camera.groundY = camera.baseGroundY + camera.trackY + camera.panY;
		camera.usableHeight = (camera.baseGroundY - camera.topY()) * camera.zoom;
		camera.ox = camera.baseOx + camera.panX;
		// The follow's vertical track moves the whole chart, the lenses
		// included: a body must stay at the altitude the deck puts it at.
		camera.oy = camera.baseOy + camera.trackY + camera.panY;
	};

	camera.panBy = function(dx, dy) {
		camera.panX += dx;
		camera.panY += dy;
		camera.syncPan();
	};

	camera.resetPan = function() {
		camera.panX = 0;
		camera.panY = 0;
		camera.zoom = 1;
		camera.zoomTarget = 1;
		camera.syncPan();
	};

	// Wheel zoom. The target is clamped so a hard flick of the wheel cannot
	// leave the chart; camera.follow eases it in.
	camera.zoomBy = function(factor) {
		var view = R.constants.view;

		camera.zoomTarget = R.util.clamp(camera.zoomTarget * factor, view.zoomMin, view.zoomMax);
	};

	// Follow the ship: the base longitude keeps it at the anchor fraction, so
	// the deck pans under it and a hand-over has an anchor to solve against.
	//
	// The altitude is not a separate follow: the chart's extent includes the
	// ship (sky.js), so a rocket above the atmosphere widens the ladder and the
	// whole chart — ground, air, bodies — stays in one scale. Zoom is eased,
	// and clamped so the hull cannot leave the top of the deck. `dt` of 0 snaps
	// (resize, restart).
	camera.follow = function(wx, wy, dt) {
		var view = R.constants.view;
		var step = dt === undefined ? 0.016 : Math.max(0, dt);
		var target = camera.zoomTarget;
		var altitude = Math.max(0, wy || 0);
		var above = camera.airTop > 0 ? R.util.clamp((altitude - camera.airTop) / camera.airTop, 0, 1) : 0;
		var shipY;
		var track;

		camera.baseLeftWx = wx - camera.circumference * view.cameraAnchorFraction;
		if (camera.flat && altitude > 0) {
			// The ship must stay under the top edge however far the wheel is
			// turned in: the view pulls back rather than losing the hull.
			target = Math.min(target, camera.altitudeLogRange * (1 - view.followMargin) /
				Math.max(1e-6, R.coords.ladder(altitude, camera)));
		}
		if (step <= 0) {
			camera.zoom = target;
		} else if (camera.zoom !== target) {
			camera.zoom += (target - camera.zoom) * (1 - Math.exp(-step / view.zoomTau));
		}
		// Vertical follow. Under the air the ground line is the camera's target
		// and nothing moves. Above it the target becomes the ship: the chart
		// slides so the hull holds the follow height, which takes the ground off
		// the bottom exactly as far as the climb.
		// The ship's height on the untracked chart: the track is solved from it,
		// so the hull ends up exactly on the follow height instead of chasing it.
		shipY = camera.baseGroundY - (camera.baseGroundY - camera.topY()) * camera.zoom *
			R.util.clamp(R.coords.ladder(altitude, camera) / camera.altitudeLogRange, 0, 1);
		track = above > 0 && camera.flat ?
			above * (camera.height * view.followHeight - shipY) : 0;
		if (step <= 0) {
			camera.trackY = track;
		} else if (camera.trackY !== track) {
			camera.trackY += (track - camera.trackY) *
				(1 - Math.exp(-step / (track > camera.trackY ? view.zoomTau : view.followCloseTau)));
		}
		camera.syncPan();
	};

	camera.project = function(wx, wy, out) {
		return R.coords.worldToScreen(wx, wy, camera, out);
	};

	camera.unproject = function(sx, sy, out) {
		return R.coords.screenToWorld(sx, sy, camera, out);
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = camera;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
