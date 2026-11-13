(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var camera = R.camera || (R.camera = {});

	// The deck's rectilinear chart. It is not a separate projection: it is the
	// log-polar chart with the pivot on the active world, written in closed
	// form so the common case costs no trigonometry.
	camera.flat = true;
	camera.leftWx = 0;
	camera.width = 1;
	camera.height = 1;
	camera.groundY = 1;
	camera.usableHeight = 1;
	camera.pixelsPerMeterX = 1;
	camera.circumference = 1;
	camera.logScale = 0;
	camera.ceiling = 0;
	camera.altitudeLogRange = 1;
	camera.planetId = '';

	// Log-polar state, used while the chart is seated on another body.
	camera.pivotX = 0;
	camera.pivotY = 0;
	camera.pivotRadius = 1;
	// Radius of the active world: a world state is a radius from that centre.
	camera.worldRadius = 1;
	camera.ox = 0;
	camera.oy = 0;
	camera.scalePx = 1;

	camera.applyRange = function() {
		camera.altitudeLogRange = Math.log1p(camera.ceiling / camera.logScale);
	};

	// The only writer of the altitude transform. sky.js eases these values;
	// coords.js reads them for both the forward and the inverse projection.
	camera.setRange = function(logScale, ceiling) {
		camera.logScale = Math.max(1e-3, logScale);
		camera.ceiling = Math.max(camera.logScale, ceiling);
		camera.applyRange();
	};

	camera.setCircumference = function(circumference) {
		camera.circumference = Math.max(1, circumference);
		camera.pixelsPerMeterX = camera.width / camera.circumference;
	};

	// Seat the chart on a body. `pivotX / pivotY` is that body's centre in the
	// plane, `pivotRadius` its radius. The anchor is the surface point nearest
	// the ship, and `groundY` is where that surface must sit on screen.
	//
	// The shared scale follows from putting the farthest charted extent at the
	// top of the viewport, so the whole system shares one scale — the property
	// that makes distant bodies round instead of squashed.
	camera.setPolar = function(pivotX, pivotY, pivotRadius, extent) {
		var line = camera.groundY;
		var top = camera.height * R.constants.view.chartTopFraction;
		var range = Math.log(Math.max(1.0001, extent / Math.max(1, pivotRadius)));

		camera.pivotX = pivotX;
		camera.pivotY = pivotY;
		camera.pivotRadius = Math.max(1, pivotRadius);
		camera.scalePx = (line - top) / Math.max(range, 0.2);
		camera.ox = camera.width * 0.5;
		camera.oy = line + camera.scalePx * Math.log(camera.pivotRadius);
	};

	// Recompute derived values from the active planet and viewport. A planet
	// change resets the range and the chart to that world's defaults; a resize
	// keeps the eased range so the view does not jump when the window changes.
	camera.configure = function() {
		var planet = R.world.planet;
		var view = R.constants.view;

		camera.setCircumference(planet.circumference);
		camera.groundY = camera.height * (1 - view.groundFraction);
		camera.usableHeight = camera.groundY;
		if (camera.planetId !== planet.id) {
			camera.planetId = planet.id;
			camera.setRange(planet.logAltitudeScale, planet.maxAltitude);
			return;
		}
		camera.applyRange();
	};

	camera.resize = function(width, height) {
		camera.width = Math.max(1, width);
		camera.height = Math.max(1, height);
		camera.configure();
	};

	camera.follow = function(wx) {
		camera.leftWx = wx - camera.circumference * R.constants.view.cameraAnchorFraction;
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
