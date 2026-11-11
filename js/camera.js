(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var camera = R.camera || (R.camera = {});

	camera.leftWx = 0;
	camera.width = 1;
	camera.height = 1;
	camera.groundY = 1;
	camera.usableHeight = 1;
	camera.pixelsPerMeterX = 1;
	camera.logScale = 0;
	camera.ceiling = 0;
	camera.altitudeLogRange = 1;
	camera.planetId = '';

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

	// Recompute derived values from the active planet and viewport. A planet
	// change resets the range to that world's defaults; a resize keeps the
	// eased range so the view does not jump when the window changes.
	camera.configure = function() {
		var planet = R.world.planet;
		var view = R.constants.view;

		camera.pixelsPerMeterX = camera.width / planet.circumference;
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
		camera.leftWx = wx - R.world.planet.circumference * R.constants.view.cameraAnchorFraction;
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
