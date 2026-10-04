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
require('../js/mission.js');
require('../js/aerodynamics.js');
require('../js/physics.js');
require('../js/trajectory.js');
require('../js/autopilot.js');
require('../js/operations.js');

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

console.log('Parts catalog tests passed.');
