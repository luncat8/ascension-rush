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

	// Parts catalog: the 0.3 mass/thrust model is the first entry in each list, so
	// a reference build with the default engine and tank reproduces the old numbers
	// exactly (the envelope tables are the proof). Alternatives are data only.
	constants.parts = {
		// A fairing is jettisoned above this altitude; until then it shrinks the
		// whole rocket's drag reference area.
		fairingAltitude: 400,
		// Dry mass = fuel * massPerFuelMass * (structureLow + structureHigh * strength).
		structureLow: 0.65,
		structureHigh: 0.35,
		// Service: an engine is rated in seconds at throttle and an overhaul costs
		// this fraction of a new one; a tank is rated in legs flown and is simply
		// replaced by the turnaround that follows its last one.
		overhaulFactor: 0.35,
		defaultEngineId: 'e-standard',
		defaultTankId: 't-standard',
		engines: [
			{ id: 'e-standard', label: 'Standard engine', thrustPerFuelMass: 72, ispSea: 265, ispVac: 330, baseMass: 60, thrustToMass: 150, costPerMass: 1, maxThrottleSeconds: 900, reliability: 1, repairPerKg: 0 },
			{ id: 'e-boost', label: 'Booster engine', thrustPerFuelMass: 88, ispSea: 255, ispVac: 310, baseMass: 80, thrustToMass: 145, costPerMass: 1.2, maxThrottleSeconds: 600, reliability: 1, repairPerKg: 0 },
			{ id: 'e-vac', label: 'Vacuum engine', thrustPerFuelMass: 58, ispSea: 235, ispVac: 355, baseMass: 52, thrustToMass: 165, costPerMass: 1.4, maxThrottleSeconds: 1200, reliability: 1, repairPerKg: 0 }
		],
		tanks: [
			{ id: 't-standard', label: 'Standard tank', massPerFuelMass: 0.075, costPerMass: 1, maxFlights: 12, repairPerKg: 0 },
			{ id: 't-light', label: 'Light tank', massPerFuelMass: 0.06, costPerMass: 1.1, maxFlights: 6, repairPerKg: 0 },
			{ id: 't-heavy', label: 'Reinforced tank', massPerFuelMass: 0.09, costPerMass: 0.9, maxFlights: 24, repairPerKg: 0 }
		],
		fairings: [
			{ id: 'f-standard', label: 'Standard fairing', mass: 40, costPerMass: 1, dragFraction: 0.6, repairPerKg: 0 }
		]
	};

	constants.economy = {
		startingCash: 40000
	};

	// Pad markets: prices live on each pad and drift one step per finished leg.
	// The board pays a premium over the destination's standing price for urgency
	// and for cargo that will not survive a hard touchdown.
	constants.market = {
		seed: 20261003,
		contractSlots: 3,
		padSpread: 0.18,
		driftPerTurn: 0.03,
		meanReversion: 0.1,
		// Delivery volume nudges a pad's price down a little per delivery.
		servedPressure: 0.01,
		urgencyBonus: 1,
		fragileBonus: 0.5,
		fragileChance: 0.25,
		fragileSpeedFactor: 0.6,
		maxContractTurns: 4,
		minContractTurns: 2,
		payloadLadder: [0.5, 1, 1.5],
		distanceBonus: 1.7
	};

	// Operations deck: bounded in-session history and the visible window an
	// auto-launch can be cancelled in.
	constants.operations = {
		flightLogLimit: 200,
		autoLaunchSeconds: 5
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
		speedCap: 700,
		// Flight-envelope limits; a limit that is null or not positive is off.
		// A planet's `flight` block sets them per world and a profile scales
		// them. Pressure in pascals, acceleration in m/s², angle in degrees.
		maxDynamicPressure: null,
		qFadeStartFraction: 0.75,
		maxThrustAcceleration: null,
		maxAngleOfAttackDeg: null,
		// Floors that keep a profile from starving the landing: an acceleration
		// cap never drops below this multiple of surface gravity (the descent
		// must brake sideways and hold altitude at once), and an angle-of-attack
		// limit never leaves less than this multiple of the thrust that holds
		// the rocket's weight when flying sideways.
	minThrustToWeight: 1.7,
	weightSupportMargin: 1.3,
	// Staging on authority: separate a stage that cannot hold the rocket up
	// for the whole burn it has left when a later stage can, instead of
	// flying it dry and landing with an engine that cannot stop the fall.
	stageOnAuthority: true
};

	// Autopilot profiles are named global multipliers on a planet's envelope
	// limits. The first entry is the default.
	constants.autopilotProfiles = [
		{
			id: 'balanced',
			label: 'Balanced',
			description: 'The recommended limits for this world.',
			dynamicPressure: 1,
			thrustAcceleration: 1,
			angleOfAttack: 1
		},
		{
			id: 'gentle',
			label: 'Gentle',
			description: 'Lower pressure and acceleration limits for a softer ride; flights run longer.',
			dynamicPressure: 0.7,
			thrustAcceleration: 0.8,
			angleOfAttack: 0.7
		}
	];

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
