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
	camera.altitudeLogRange = 1;

	// Recompute every derived value from the active planet and viewport.
	// Called again after a planet switch, when the circumference changes.
	camera.configure = function() {
		var planet = R.world.planet;
		var view = R.constants.view;

		camera.pixelsPerMeterX = camera.width / planet.circumference;
		camera.groundY = camera.height * (1 - view.groundFraction);
		camera.usableHeight = camera.groundY;
		camera.altitudeLogRange = Math.log1p(planet.maxAltitude / planet.logAltitudeScale);
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
