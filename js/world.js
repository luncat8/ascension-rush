(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var world = R.world || (R.world = {});

	// Live planet record. Fields are copied from a preset by initialize();
	// gameplay code reads world.planet instead of a constants table so a
	// planet switch never has to touch module-level state.
	world.planet = {};
	world.pads = [];
	world.currentPadId = '';
	world.targetPadId = '';

	world.buildPads = function() {
		var planet = world.planet;
		var colors = R.planets.padColors;
		var pads = world.pads;
		var i;

		pads.length = 0;
		for (i = 0; i < planet.pads.length; i += 1) {
			pads.push({
				id: 'pad' + i,
				name: planet.pads[i].name,
				wx: planet.pads[i].frac * planet.circumference,
				color: colors[i % colors.length]
			});
		}
		world.currentPadId = pads[0].id;
		world.targetPadId = pads[1].id;
	};

	world.initialize = function(presetId) {
		var preset = R.planets.findById(presetId || world.planet.id) || R.planets.findById(R.planets.defaultId);

		R.planets.copyInto(preset, world.planet);
		world.buildPads();
		R.camera.resize(R.camera.width, R.camera.height);
		return world.planet;
	};

	world.findPadById = function(id) {
		var i;

		for (i = 0; i < world.pads.length; i += 1) {
			if (world.pads[i].id === id) {
				return world.pads[i];
			}
		}

		return null;
	};

	world.padIndex = function(padId) {
		var i;

		for (i = 0; i < world.pads.length; i += 1) {
			if (world.pads[i].id === padId) {
				return i;
			}
		}
		return -1;
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = world;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
