(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var camera = R.camera || (R.camera = {});
	var world = R.constants.world;

	camera.leftWx = 0;
	camera.width = 1;
	camera.height = 1;
	camera.groundY = 1;
	camera.usableHeight = 1;
	camera.pixelsPerMeterX = 1 / world.circumference;
	camera.altitudeLogRange = Math.log1p(world.maxAltitude / world.logAltitudeScale);

	camera.resize = function(width, height) {
		camera.width = Math.max(1, width);
		camera.height = Math.max(1, height);
		camera.pixelsPerMeterX = camera.width / world.circumference;
		camera.groundY = camera.height * (1 - world.groundFraction);
		camera.usableHeight = camera.groundY;
		camera.altitudeLogRange = Math.log1p(world.maxAltitude / world.logAltitudeScale);
	};

	camera.follow = function(wx) {
		camera.leftWx = wx - world.circumference * world.cameraAnchorFraction;
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
