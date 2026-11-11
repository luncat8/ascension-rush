(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var coords = R.coords || (R.coords = {});

	// Log-radial cylinder: wrap-X is a longitude, log-Y is altitude above the
	// surface. Both directions read the camera's live scale, so an eased zoom
	// stays invertible at every frame.
	coords.worldToScreen = function(wx, wy, camera, out) {
		var altitude = R.util.clamp(wy, 0, camera.ceiling);
		var altitudeFraction = Math.log1p(altitude / camera.logScale) / camera.altitudeLogRange;

		out.x = (wx - camera.leftWx) * camera.pixelsPerMeterX;
		out.y = camera.groundY - camera.usableHeight * altitudeFraction;
		return out;
	};

	coords.screenToWorld = function(sx, sy, camera, out) {
		var altitudeExponent = (camera.groundY - sy) * camera.altitudeLogRange / camera.usableHeight;

		out.x = camera.leftWx + sx / camera.pixelsPerMeterX;
		out.y = camera.logScale * Math.expm1(altitudeExponent);
		out.y = R.util.clamp(out.y, 0, camera.ceiling);
		return out;
	};

	// Wrap a longitude into the viewport starting at leftWx.
	coords.nearestPeriodicX = function(wx, leftWx, circumference) {
		return leftWx + R.util.mod(wx - leftWx, circumference);
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = coords;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
