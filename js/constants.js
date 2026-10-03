(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var constants = R.constants || (R.constants = {});

	// Viewport layout shared by every planet.
	constants.view = {
		groundFraction: 0.1,
		cameraAnchorFraction: 1 / 3
	};

	constants.rocket = {
		tankMassPerFuelMass: 0.075,
		engineBaseMass: 60,
		engineThrustToMass: 150,
		thrustPerFuelMass: 72,
		ispSeaLevel: 265,
		ispVacuum: 330,
		// Exhaust velocity is Isp times standard gravity, never local gravity.
		standardGravity: 9.81,
		referenceArea: 1.6,
		maxAcceleration: 200,
		fixedStep: 1 / 120,
		maxFrameStep: 1 / 30,
		maxSubsteps: 32,
		throttleRate: 1.8,
		turnRate: 2.4,
		minimumLaunchTwr: 1.15,
		maxPayloadMass: 600,
		minFuelMass: 100,
		maxFuelMass: 1500,
		defaultPayloadMass: 80,
		defaultStageFuel: [420, 260, 200],
		defaultStageStrength: [0.85, 0.9, 0.9]
	};

	constants.economy = {
		startingCash: 30000
	};

	constants.time = {
		scales: [0.5, 0.75, 1, 1.5, 2, 3, 4],
		defaultIndex: 4
	};

	// Guidance tuning for the autopilot. A planet preset may override any of
	// these through its `flight` block.
	constants.autopilot = {
		liftAltitude: 60,
		climbVelocity: 45,
		cruiseAltitudeFraction: 0.08,
		cruiseAltitudeMin: 120,
		cruiseAltitudeMax: 1200,
		glideSlope: 0.3,
		arrivalDistance: 150,
		arrivalAltitude: 150,
		arrivalGain: 0.35,
		climbMargin: 0.7,
		descentMargin: 0.85,
		terminalAltitude: 40,
		touchdownVelocity: 6,
		minimumDescent: 1.8,
		verticalThrustShare: 0.35,
		commitVelocity: 12,
		velocityGain: 1.15,
		thrustReserve: 0.92,
		brakeMargin: 1.15,
		speedCap: 700
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
