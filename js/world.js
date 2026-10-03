(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var world = R.world || (R.world = {});
	var circumference = R.constants.world.circumference;

	world.pads = [];
	world.currentPadId = 'homeport';
	world.targetPadId = 'eastport';

	world.initialize = function() {
		world.pads.length = 0;
		world.pads.push({ id: 'homeport', name: 'Homeport', wx: 0, color: '#f4c76a' });
		world.pads.push({ id: 'eastport', name: 'Eastport', wx: circumference * 0.25, color: '#64d5c2' });
		world.pads.push({ id: 'farport', name: 'Farport', wx: circumference * 0.5, color: '#a78bfa' });
		world.pads.push({ id: 'westport', name: 'Westport', wx: circumference * 0.75, color: '#f28b82' });
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

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = world;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
