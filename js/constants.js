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
			{ id: 'e-standard', label: 'Standard engine', thrustPerFuelMass: 72, ispSea: 265, ispVac: 330, baseMass: 60, thrustToMass: 150, costPerMass: 1, maxThrottleSeconds: 900, reliability: 1, repairPerKg: 0.6 },
			{ id: 'e-boost', label: 'Booster engine', thrustPerFuelMass: 88, ispSea: 255, ispVac: 310, baseMass: 80, thrustToMass: 145, costPerMass: 1.2, maxThrottleSeconds: 600, reliability: 1, repairPerKg: 0.7 },
			{ id: 'e-vac', label: 'Vacuum engine', thrustPerFuelMass: 58, ispSea: 235, ispVac: 355, baseMass: 52, thrustToMass: 165, costPerMass: 1.4, maxThrottleSeconds: 1200, reliability: 1, repairPerKg: 0.5 }
		],
		tanks: [
			{ id: 't-standard', label: 'Standard tank', massPerFuelMass: 0.075, costPerMass: 1, maxFlights: 12, repairPerKg: 0.5 },
			{ id: 't-light', label: 'Light tank', massPerFuelMass: 0.06, costPerMass: 1.1, maxFlights: 6, repairPerKg: 0.6 },
			{ id: 't-heavy', label: 'Reinforced tank', massPerFuelMass: 0.09, costPerMass: 0.9, maxFlights: 24, repairPerKg: 0.4 }
		],
		fairings: [
			{ id: 'f-standard', label: 'Standard fairing', mass: 40, costPerMass: 1, dragFraction: 0.6, repairPerKg: 0.4 }
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
		// A pad absorbs this many reference loads per leg: the destination's
		// appetite, not the rocket's bay, is what caps a leg's cargo. Without it
		// a light load and a full one burn almost the same fuel, so the margin
		// would climb without bound as the cargo grew.
		demandFactor: 1.5,
		// The board's rungs are fractions of the destination's appetite, so a
		// posted contract is always a cargo the pad will take.
		payloadLadder: [0.5, 0.75, 1],
		urgencyBonus: 1,
		fragileBonus: 0.5,
		fragileChance: 0.25,
		fragileSpeedFactor: 0.6,
		maxContractTurns: 4,
		minContractTurns: 2,
		distanceBonus: 1.7
	};

	// Damage and failures (0.5.1). A stage is rated against the world's own
	// certified flight envelope — the limits the autopilot flies — times a
	// margin for how strongly it was built. Inside them a flight costs
	// nothing; the excess is what damages the stack, and damage is what
	// fails. `experiments/failure.js` is the Monte Carlo these were tuned on.
	constants.damage = {
		// The seed `experiments/failure.js` starts its buckets from; a flight
		// is seeded from the mission id, so this is only a measurement tool.
		seed: 20261005,
		// How far past the certified envelope a well-built stage is rated.
		structureMargin: 1.35,
		// Stress per second: the excess over a stage's rating is squared, so
		// a small overload is nearly free and a large one is not, and a load
		// inside the rating still costs a little fatigue every second. Stress
		// is a fraction, and 1 is beyond repair.
		stressRate: 0.06,
		fatigueWeight: 0.02,
		// Failure rate per second: on the square of the stress a stage
		// carries, plus the square of how far an engine is past its useful
		// burn time. Sampling is `1 - exp(-rate * dt)`, so the odds do not
		// depend on the step. Overload is not itself a failure — it is what
		// adds to the stress that fails later.
		failureRate: 0.10,
		failureExponent: 2,
		wearRate: 0.004,
		maxFailureRate: 3,
		// A stage this damaged is beyond economical repair: the turnaround
		// replaces it whole. A tank this damaged with fuel aboard ruptures.
		scrapStress: 0.75,
		ruptureStress: 1,
		// Separating a stage shakes the stack a little.
		separationStress: 0.01,
		// Touchdown. The 0.3.3 reference band (2.7-3.8 m/s down) is the zero
		// point and the planet's crash limits are the far end; the soft
		// threshold sits between them.
		softLandingFraction: 0.5,
		landingStress: 0.06,
		payloadLandingDamage: 0.05,
		// Sustained load the cargo takes, in g. Fragile cargo is rated
		// lower, and its damage is the fraction of the payout that is lost.
		payloadGLoad: 5,
		fragileGLoad: 4,
		payloadStressRate: 0.04,
		// Once a fairing is lost in the airstream, the cargo takes the air.
		payloadPressure: 20000,
		// An engine near its rated burn time is the likeliest thing to fail
		// on a stack that has been flying for a while: the risk starts here,
		// as a fraction of the rating, and is at its worst when the overhaul
		// gate is about to stop the leg.
		wearStart: 0.8,
		// What a failure does. A partial failure keeps half the thrust and
		// most of the efficiency; a leak starts small and accelerates.
		enginePartialHealth: 0.5,
		engineIspLoss: 0.12,
		leakRate: 0.8,
		leakGrowth: 0.2,
		// How long a failure stays on the HUD after it happens.
		alarmSeconds: 5
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
