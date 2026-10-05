'use strict';

// Parts catalog: the catalog is well formed and the default engine and tank
// reproduce the 0.3 mass/thrust model exactly, so a reference build flies
// identically (the envelope tables prove it). Also covers fairing mass, the
// stage/type cost helpers, and sanitizeStage.

var assert = require('node:assert/strict');
var R = require('../js/namespaces.js');

require('../js/util.js');
require('../js/constants.js');
require('../js/planets.js');
require('../js/coords.js');
require('../js/camera.js');
require('../js/world.js');
require('../js/rocket.js');
require('../js/parts.js');
require('../js/market.js');
require('../js/economy.js');
require('../js/flight-log.js');
require('../js/damage.js');
require('../js/mission.js');
require('../js/aerodynamics.js');
require('../js/physics.js');
require('../js/trajectory.js');
require('../js/autopilot.js');
require('../js/operations.js');

// Damage and failures are measured by experiments/failure.js; every other
// suite flies the 0.4 model, so a leg here is never at the mercy of a roll.
R.damage.enabled = false;

R.world.initialize('verdant');
R.camera.resize(1280, 720);
R.operations.initialize();

var parts = R.parts;
var settings = R.constants.parts;
var rc = R.constants.rocket;

// ----------------------------------------------------------- catalog shape

var engineIds = {};
var tankIds = {};
var i;

settings.engines.forEach(function(engine) {
	assert.ok(engine.id && engine.label, 'every engine has id and label');
	assert.ok(typeof engine.thrustPerFuelMass === 'number' && engine.thrustPerFuelMass > 0, 'engine thrust per fuel');
	assert.ok(typeof engine.ispSea === 'number' && typeof engine.ispVac === 'number', 'engine isp');
	assert.ok(typeof engine.baseMass === 'number', 'engine base mass');
	assert.ok(typeof engine.thrustToMass === 'number' && engine.thrustToMass > 0, 'engine thrust-to-mass');
	assert.ok(engineIds[engine.id] === undefined, 'engine ids are unique');
	engineIds[engine.id] = true;
});
settings.tanks.forEach(function(tank) {
	assert.ok(tank.id && tank.label, 'every tank has id and label');
	assert.ok(typeof tank.massPerFuelMass === 'number' && tank.massPerFuelMass > 0, 'tank mass per fuel');
	assert.ok(tankIds[tank.id] === undefined, 'tank ids are unique');
	tankIds[tank.id] = true;
});
settings.fairings.forEach(function(fairing) {
	assert.ok(fairing.id && typeof fairing.mass === 'number', 'every fairing has id and mass');
	assert.ok(typeof fairing.dragFraction === 'number' && fairing.dragFraction > 0 && fairing.dragFraction <= 1, 'fairing drag fraction in range');
});

// Default ids resolve and the defaults are the first catalog entries.
assert.equal(parts.engine(settings.defaultEngineId).id, settings.engines[0].id, 'default engine is the first entry');
assert.equal(parts.tank(settings.defaultTankId).id, settings.tanks[0].id, 'default tank is the first entry');
assert.equal(parts.engine(null).id, settings.engines[0].id, 'a missing engine id resolves to default');
assert.equal(parts.tank(null).id, settings.tanks[0].id, 'a missing tank id resolves to default');
assert.equal(parts.fairing(null), null, 'a missing fairing id resolves to none');
assert.equal(parts.fairing(settings.fairings[0].id).id, settings.fairings[0].id, 'a fairing id resolves');

// ------------------------------------------------------- continuity of mass

// The 0.3 formula, written out, is what the default parts must reproduce.
function oldStageDryMass(fuel, strength) {
	var structureFactor = 0.65 + 0.35 * R.util.clamp(strength, 0.5, 1);
	var tankMass = fuel * settings.tanks[0].massPerFuelMass * structureFactor;
	var engineMass = settings.engines[0].baseMass + (fuel * settings.engines[0].thrustPerFuelMass) / settings.engines[0].thrustToMass;
	return tankMass + engineMass;
}

[0.5, 0.85, 1].forEach(function(strength) {
	[100, 420, 1500].forEach(function(fuel) {
		var stage = { fuelMass: fuel, strength: strength, engineId: settings.defaultEngineId, tankId: settings.defaultTankId, fairingId: null };
		assert.equal(parts.stageBreakdown(stage).dryMass, oldStageDryMass(fuel, strength),
			'default parts reproduce the 0.3 dry mass (fuel ' + fuel + ', strength ' + strength + ')');
		assert.equal(parts.stageBreakdown(stage).thrust, fuel * settings.engines[0].thrustPerFuelMass, 'default thrust per fuel');
	});
});

// rocket.stageDryMass delegates to the parts, so it matches too.
assert.equal(R.rocket.stageDryMass({ fuelMass: 420, strength: 0.85 }), oldStageDryMass(420, 0.85),
	'rocket.stageDryMass matches the 0.3 model when only { fuelMass, strength } is given');

// A stage missing every part id still builds and flies via sanitize defaults.
var sanitized = parts.sanitizeStage({ fuelMass: 420, strength: 0.9 });
assert.equal(sanitized.engineId, settings.defaultEngineId, 'sanitize fills the engine id');
assert.equal(sanitized.tankId, settings.defaultTankId, 'sanitize fills the tank id');
assert.equal(sanitized.fairingId, null, 'sanitize fills a null fairing');
var explicit = parts.sanitizeStage({ fuelMass: 200, strength: 1, engineId: 'e-boost', tankId: 't-light', fairingId: null });
assert.equal(explicit.engineId, 'e-boost', 'sanitize keeps an explicit engine');
assert.equal(explicit.tankId, 't-light', 'sanitize keeps an explicit tank');

// ------------------------------------------------------------- fairing mass

var fairing = settings.fairings[0];
var withFairing = parts.stageBreakdown({ fuelMass: 420, strength: 0.85, engineId: settings.defaultEngineId, tankId: settings.defaultTankId, fairingId: fairing.id });
var withoutFairing = parts.stageBreakdown({ fuelMass: 420, strength: 0.85, engineId: settings.defaultEngineId, tankId: settings.defaultTankId, fairingId: null });
assert.equal(withFairing.dryMass, withoutFairing.dryMass + fairing.mass, 'a fairing adds exactly its mass to the stage');
assert.equal(withFairing.fairingMass, fairing.mass, 'the fairing mass is reported separately');

// --------------------------------------------------- a real alternative part

var boost = parts.engine('e-boost');
var standard = parts.engine('e-standard');
assert.ok(boost.thrustPerFuelMass > standard.thrustPerFuelMass, 'the booster makes more thrust per fuel');
assert.equal(parts.stageBreakdown({ fuelMass: 420, strength: 0.85, engineId: 'e-boost' }).thrust,
	420 * boost.thrustPerFuelMass, 'the booster changes thrust');
assert.equal(parts.stageBreakdown({ fuelMass: 420, strength: 0.85, tankId: 't-light' }).dryMass < withoutFairing.dryMass,
	true, 'a light tank is lighter');

// -------------------------------------- turnaround pricing from the parts

var type = R.operations.addType({
	name: 'Parts test type',
	stageCount: 2,
	stages: [
		{ fuelMass: 600, strength: 0.9 },
		{ fuelMass: 300, strength: 0.9 }
	],
	nominalPayload: 80,
	defaultProfileId: 'balanced'
});
// One stage lost: the turnaround replaces exactly that structure, priced at steel.
var stageState = [
	{ alive: false, fuelMass: 0 },
	{ alive: true, fuelMass: 300 }
];
var steel = R.economy.priceSteel(R.world.pads[0].id);
var costFromParts = parts.typeStructureCost(type, stageState, R.world.pads[0].id);
var expectedDead = parts.stageBreakdown(type.stages[0]).dryMass * steel;
assert.ok(costFromParts > 0, 'a turnaround with a lost stage costs something');
assert.equal(costFromParts, expectedDead, 'the turnaround is priced from the parts it replaces');

// No stage lost: nothing to rebuild.
var allAlive = [
	{ alive: true, fuelMass: 600 },
	{ alive: true, fuelMass: 300 }
];
assert.equal(parts.typeStructureCost(type, allAlive, R.world.pads[0].id), 0, 'a turnaround with no loss costs nothing');

// typeBuildCost is the full structure at steel plus a full fuel load.
var fullStructure = parts.stageBreakdown(type.stages[0]).dryMass + parts.stageBreakdown(type.stages[1]).dryMass;
var fullFuel = type.stages[0].fuelMass + type.stages[1].fuelMass;
var fuelPrice = R.economy.priceFuel(R.world.pads[0].id);
assert.equal(parts.typeBuildCost(type, R.world.pads[0].id),
	fullStructure * steel + fullFuel * fuelPrice, 'typeBuildCost is full structure plus full fuel');

// ------------------------------------------------------ the parts' own price

// costPerMass is what makes an alternative cost more or less than its weight.
// The default parts are 1, so their structure value is exactly their mass and
// the money a reference build moves is unchanged.
assert.equal(parts.stageStructureValue(type.stages[0]), parts.stageBreakdown(type.stages[0]).dryMass,
	'the default parts price at their mass');
assert.equal(parts.typeStructureValue(type), fullStructure, 'a default type prices at its dry mass');

var light = parts.tank('t-light');
var lightStage = parts.sanitizeStage({ fuelMass: 600, strength: 0.9, tankId: 't-light' });
var lightBreakdown = parts.stageBreakdown(lightStage);
assert.equal(parts.stageStructureValue(lightStage),
	lightBreakdown.engineMass + lightBreakdown.tankMass * light.costPerMass,
	'each part prices its own mass at its costPerMass');
assert.ok(parts.stageStructureValue(lightStage) > lightBreakdown.dryMass, 'a premium part costs more than its weight');

var boostStage = parts.sanitizeStage({ fuelMass: 600, strength: 0.9, engineId: 'e-boost' });
var boostBreakdown = parts.stageBreakdown(boostStage);
assert.equal(parts.stageStructureValue(boostStage),
	boostBreakdown.engineMass * boost.costPerMass + boostBreakdown.tankMass, 'a booster prices its own mass');
assert.ok(parts.stageStructureValue(boostStage) > boostBreakdown.dryMass, 'and costs more than its weight');
var heavy = parts.tank('t-heavy');
var heavyStage = parts.sanitizeStage({ fuelMass: 600, strength: 0.9, tankId: 't-heavy' });
assert.ok(parts.stageStructureValue(heavyStage) < parts.stageBreakdown(heavyStage).dryMass,
	'a cheaper-per-kg part costs less than its weight');
assert.ok(heavy.costPerMass < 1, 'the reinforced tank is the cheap-per-kg one');

// --------------------------------------------- a build is measured as built

// typeStats is what the deck, the capacity gate and the build price all read,
// so it has to measure the engine and tank the type actually carries.
function makeType(engineId, tankId, fairingId) {
	return R.operations.addType({
		name: 'measured ' + engineId + ' ' + tankId,
		stageCount: 2,
		stages: [
			parts.sanitizeStage({ fuelMass: 600, strength: 0.9, engineId: engineId, tankId: tankId, fairingId: null }),
			parts.sanitizeStage({ fuelMass: 300, strength: 0.9, engineId: engineId, tankId: tankId, fairingId: fairingId })
		],
		nominalPayload: 80,
		defaultProfileId: 'balanced'
	});
}

var boostType = makeType('e-boost', 't-light', fairing.id);
// typeStats fills a shared record, so read the numbers out before the next call.
var boostMeasured = R.operations.typeStats(boostType);
var boostMeasuredDry = boostMeasured.dryMass;
var boostMeasuredThrust = boostMeasured.thrustMax;
var boostThrust = 600 * boost.thrustPerFuelMass;
var boostDryMass = parts.stageBreakdown(boostType.stages[0]).dryMass + parts.stageBreakdown(boostType.stages[1]).dryMass;
assert.equal(boostMeasuredThrust, boostThrust, 'a build is measured with the engine it carries');
assert.equal(boostMeasuredDry, boostDryMass, 'and with the tank and fairing it carries');
assert.ok(boostMeasuredThrust > 600 * standard.thrustPerFuelMass, 'the booster really is a bigger engine');
// A default type measured after an alternative one is not contaminated by it.
var plainMeasured = R.operations.typeStats(type);
assert.equal(plainMeasured.dryMass, fullStructure, 'the scratch measurement does not keep the last build parts');
assert.equal(plainMeasured.thrustMax, 600 * standard.thrustPerFuelMass, 'nor its engine');

// A fairing is mass the type carries, so it lowers what the type can lift.
// Measured on a small single stage: a big one is already at the payload cap.
function makeSingleStage(withFairing) {
	return R.operations.addType({
		name: withFairing ? 'fairing capacity' : 'bare capacity',
		stageCount: 1,
		stages: [parts.sanitizeStage({ fuelMass: 100, strength: 0.9, fairingId: withFairing ? fairing.id : null })],
		nominalPayload: 80,
		defaultProfileId: 'balanced'
	});
}

var fairingCapacity = R.operations.typeStats(makeSingleStage(true)).payloadLimit;
var plainCapacity = R.operations.typeStats(makeSingleStage(false)).payloadLimit;
assert.ok(plainCapacity < rc.maxPayloadMass, 'the capacity being compared is not at the cap');
assert.equal(fairingCapacity, plainCapacity - fairing.mass, 'a fairing lowers the payload capacity by its mass');

// ------------------------------------------------- the price reaches the money

var pad = R.world.pads[0];
var buildCost = parts.typeBuildCost(boostType, pad.id);
assert.ok(buildCost > boostDryMass * steel + fullFuel * fuelPrice,
	'a premium build costs more than its weight in steel');

R.game = {
	currentPadId: pad.id,
	targetPadId: R.world.pads[1].id,
	rocket: R.rocket.create(pad),
	phase: 'deck',
	cash: 100000,
	ledger: [],
	flight: null,
	mission: null,
	lastReport: null,
	selection: { sourcePadId: pad.id, targetPadId: R.world.pads[1].id, mode: 'oneway', visible: true },
	simTime: 0,
	physicsAccumulator: 0,
	timeScaleIndex: R.constants.time.defaultIndex,
	timeScale: 1
};
var built = R.operations.buildRocket(boostType.id, pad.id);
assert.equal(built.ok, true, 'a premium build can be bought');
assert.equal(built.cost, buildCost, 'the build charges exactly what the workshop quotes');
assert.equal(R.economy.priceSteel(pad.id) * parts.typeStructureValue(boostType) +
	parts.typeFuelMass(boostType) * fuelPrice, buildCost, 'structure at the parts price plus fuel');

// A turnaround is charged through the parts the rebuilt stages carry, and a
// no-refuel leg still buys nothing.
var instance = R.operations.findRocket(built.rocketId);
instance.stageState[0].alive = false;
var preparation = R.operations.preparePlan(boostType, instance, true);
assert.equal(preparation.structureValue, parts.restoreStructureValue(boostType, instance.stageState),
	'the plan prices the structure it replaces');
assert.ok(preparation.structureValue > preparation.dryMass, 'at the parts price, not plain steel');
assert.equal(R.operations.planCost(preparation, pad.id),
	preparation.fuelMass * fuelPrice + preparation.structureValue * steel, 'the plan cost is fuel plus structure');
var noRefuel = R.operations.preparePlan(boostType, instance, false);
assert.equal(noRefuel.structureValue, 0, 'a no-refuel leg rebuilds nothing');
assert.equal(R.operations.planCost(noRefuel, pad.id), 0, 'and pays nothing');

// ------------------------------------------------------------ fairing in flight

// A minimal flying game: physics.step is what sheds a fairing, and the flight
// record it writes into is not what is under test here.
function createFlightGame(state) {
	return {
		phase: 'flying',
		rocket: state,
		timeScale: 1,
		physicsAccumulator: 0,
		flight: {
			elapsed: 0,
			fuelUsed: 0,
			currentDynamicPressure: 0,
			currentAngleOfAttack: 0,
			peakDynamicPressure: 0,
			peakDynamicPressureAltitude: 0,
			peakDynamicPressureAngleOfAttack: 0,
			peakAngleOfAttack: 0,
			peakAngleOfAttackDynamicPressure: 0,
			peakThrustAcceleration: 0,
			peakAppliedThrustAcceleration: 0
		}
	};
}

function launchWith(fairingId) {
	var launched = makeType(settings.defaultEngineId, settings.defaultTankId, fairingId);
	var state = R.rocket.create(pad);
	var full = [
		{ alive: true, fuelMass: 600 },
		{ alive: true, fuelMass: 300 }
	];

	R.rocket.applyFleetState(state, launched, full, 80, pad);
	state.wy = 100;
	// Coast, so the only mass change under test is the fairing's.
	state.throttle = 0;
	return { type: launched, state: state };
}

var flight = launchWith(fairing.id);
var topStage = flight.state.stages[flight.state.stageCount - 1];
assert.equal(flight.state.fairingAttached, true, 'a type with a fairing launches with it attached');
assert.equal(flight.state.fairingMass, fairing.mass, 'and carries its mass');
var massWithFairing = R.rocket.totalMass(flight.state);

flight.state.wy = settings.fairingAltitude + 1;
R.physics.step(createFlightGame(flight.state), R.constants.rocket.fixedStep);
assert.equal(flight.state.fairingAttached, false, 'the fairing is jettisoned above the jettison altitude');
assert.equal(flight.state.fairingMass, 0, 'its mass is off the books');
assert.equal(topStage.dryMass, parts.stageBreakdown(flight.type.stages[1]).dryMass - fairing.mass,
	'the fairing mass leaves the top stage');
assert.equal(R.rocket.totalMass(flight.state), massWithFairing - fairing.mass, 'and the stack is lighter by it');

// Separating the top stage below the jettison altitude takes the fairing with
// it: it must stop shrinking drag as soon as the stage carrying it is gone.
var separated = launchWith(fairing.id);
separated.state.currentStage = separated.state.stageCount - 1;
R.rocket.separateStage(separated.state);
assert.equal(separated.state.fairingAttached, true, 'the fairing is still on the books right after staging');
R.physics.step(createFlightGame(separated.state), R.constants.rocket.fixedStep);
assert.equal(separated.state.fairingAttached, false, 'a fairing goes with the stage that carried it');
assert.equal(separated.state.fairingMass, 0, 'and is not counted twice');

// A type without a fairing never attaches one.
var bareFlight = launchWith(null);
assert.equal(bareFlight.state.fairingAttached, false, 'a build without a fairing carries none');
assert.equal(bareFlight.state.fairingDragFraction, 1, 'and its drag is unscaled');

console.log('Parts catalog tests passed.');
