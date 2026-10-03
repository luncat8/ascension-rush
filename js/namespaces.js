(function(root) {
	'use strict';

	var R = root.R || {};

	R.constants = R.constants || {};
	R.util = R.util || {};
	R.coords = R.coords || {};
	R.world = R.world || {};
	R.camera = R.camera || {};
	R.rocket = R.rocket || {};
	R.physics = R.physics || {};
	R.economy = R.economy || {};
	R.mission = R.mission || {};
	R.builder = R.builder || {};
	R.controls = R.controls || {};
	R.input = R.input || {};
	R.render = R.render || {};
	R.game = R.game || null;

	root.R = R;

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = R;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
