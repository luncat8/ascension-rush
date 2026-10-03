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
		cameraAnchorFraction: 1 / 3,
		landingRadius: 8000,
		landingVerticalSpeed: 12,
		landingHorizontalSpeed: 25
	};

	constants.rocket = {
		tankMassPerFuelMass: 0.085,
		engineBaseMass: 170,
		engineThrustToMass: 125,
		thrustPerFuelMass: 72,
		ispSeaLevel: 265,
		ispVacuum: 330,
		referenceArea: 2.2,
		maxAcceleration: 200,
		fixedStep: 1 / 120,
		maxFrameStep: 1 / 30,
		throttleRate: 1.8,
		turnRate: Math.PI,
		minimumLaunchTwr: 1.15,
		maxPayloadMass: 2000,
		minFuelMass: 300,
		maxFuelMass: 6000,
		defaultPayloadMass: 120,
		defaultStageFuel: [1800, 900, 1000],
		defaultStageStrength: [0.85, 0.9, 0.9]
	};

	constants.economy = {
		startingCash: 30000,
		priceFuelPerKg: 1.4,
		priceSteelPerKg: 2.5,
		priceDeliveryPerKg: 180
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
