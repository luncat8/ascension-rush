(function(root) {
	'use strict';

	var R = root.R || {};

	R.constants = R.constants || {};
	R.util = R.util || {};
	R.planets = R.planets || {};
	R.coords = R.coords || {};
	R.world = R.world || {};
	R.camera = R.camera || {};
	R.rocket = R.rocket || {};
	R.aerodynamics = R.aerodynamics || {};
	R.physics = R.physics || {};
	R.trajectory = R.trajectory || {};
	R.economy = R.economy || {};
	R.mission = R.mission || {};
	R.flightLog = R.flightLog || {};
	R.operations = R.operations || {};
	R.autopilot = R.autopilot || {};
	R.menu = R.menu || {};
	R.builder = R.builder || {};
	R.deck = R.deck || {};
	R.controls = R.controls || {};
	R.input = R.input || {};
	R.render = R.render || {};
	R.game = R.game || null;

	root.R = R;

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = R;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
