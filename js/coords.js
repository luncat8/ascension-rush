(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var coords = R.coords || (R.coords = {});

	coords.worldToScreen = function(wx, wy, camera, out) {
		var world = R.constants.world;
		var altitude = R.util.clamp(wy, 0, world.maxAltitude);
		var altitudeFraction = Math.log1p(altitude / world.logAltitudeScale) / camera.altitudeLogRange;

		out.x = (wx - camera.leftWx) * camera.pixelsPerMeterX;
		out.y = camera.groundY - camera.usableHeight * altitudeFraction;
		return out;
	};

	coords.screenToWorld = function(sx, sy, camera, out) {
		var world = R.constants.world;
		var altitudeExponent = (camera.groundY - sy) * camera.altitudeLogRange / camera.usableHeight;

		out.x = camera.leftWx + sx / camera.pixelsPerMeterX;
		out.y = world.logAltitudeScale * Math.expm1(altitudeExponent);
		out.y = R.util.clamp(out.y, 0, world.maxAltitude);
		return out;
	};

	coords.nearestPeriodicX = function(wx, leftWx, circumference) {
		return leftWx + R.util.mod(wx - leftWx, circumference);
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = coords;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
