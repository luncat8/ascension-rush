(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var flightPath = R.flightPath || (R.flightPath = {});
	var settings = R.constants.sky;

	// A fixed-capacity ring of sampled world positions for the leg being
	// flown. The renderer walks oldest to newest; nothing here allocates.
	flightPath.capacity = settings.trailCapacity;
	flightPath.points = new Float32Array(flightPath.capacity * 2);
	flightPath.count = 0;
	flightPath.head = 0;
	flightPath.interval = settings.trailInterval;
	flightPath.lastSampleTime = -Infinity;
	flightPath.lastFlight = null;
	flightPath.planetId = '';

	flightPath.reset = function() {
		flightPath.count = 0;
		flightPath.head = 0;
		flightPath.lastSampleTime = -Infinity;
		flightPath.lastFlight = null;
		flightPath.planetId = R.world.planet.id;
	};

	// A new flight record or a world switch starts a new trail. Sampling is on
	// the simulation clock, so a time-scale change does not change its shape.
	flightPath.sample = function(game) {
		var time;
		var index;

		if (flightPath.planetId !== R.world.planet.id) {
			flightPath.reset();
		}
		if (game.phase !== 'flying' || !game.flight) {
			flightPath.lastFlight = null;
			return;
		}
		if (game.flight !== flightPath.lastFlight) {
			flightPath.reset();
			flightPath.lastFlight = game.flight;
		}
		time = game.simTime || 0;
		if (time - flightPath.lastSampleTime < flightPath.interval) {
			return;
		}
		flightPath.lastSampleTime = time;
		index = flightPath.head * 2;
		flightPath.points[index] = game.rocket.wx;
		flightPath.points[index + 1] = Math.max(0, game.rocket.wy);
		flightPath.head = (flightPath.head + 1) % flightPath.capacity;
		if (flightPath.count < flightPath.capacity) {
			flightPath.count += 1;
		}
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = flightPath;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
