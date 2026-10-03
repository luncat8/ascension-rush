(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var constants = R.constants || (R.constants = {});

	constants.world = {
		name: 'Verdant',
		circumference: 1000000,
		surfaceGravity: 9.81,
		radius: 1000000 / (2 * Math.PI),
		seaLevelDensity: 1.225,
		atmosphereScaleHeight: 8500,
		dragCoefficient: 0.04,
		maxAltitude: 1000000,
		logAltitudeScale: 100,
		groundFraction: 0.1,
		cameraAnchorFraction: 1 / 3
	};

	constants.render = {
		backgroundTop: '#071322',
		backgroundBottom: '#142a3a',
		ground: '#343c36',
		groundDetail: 'rgba(221, 207, 158, 0.13)',
		text: '#e7eff6',
		mutedText: '#96aabd',
		accent: '#f4c76a',
		target: '#64d5c2',
		panel: 'rgba(7, 16, 27, 0.76)'
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = constants;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
