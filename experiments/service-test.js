'use strict';

// Service and wear: engines are rated in seconds at throttle and block a launch
// with NEEDS OVERHAUL until the leg buys the overhaul; tanks are rated in legs
// flown and are replaced by the turnaround that follows their last one. Wear
// lives on the fleet instance, so a stage the turnaround replaces comes back
// new. The repair bill 0.5.1 charges is the damage a stack carries: charged on
// the leg that flies it, and quoted by the debrief the leg that earned it.

var assert = require('node:assert/strict');
var R = require('../js/namespaces.js');
require('../js/parts.js');

require('../js/util.js');
require('../js/constants.js');
require('../js/planets.js');
require('../js/coords.js');
require('../js/camera.js');
require('../js/world.js');
require('../js/rocket.js');
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
require('../js/controls.js');
require('../js/input.js');

// Damage and failures are measured by experiments/failure.js; every other
// suite flies the 0.4 model, so a leg here is never at the mercy of a roll.
R.damage.enabled = false;

R.world.initialize('verdant');
R.camera.resize(1280, 720);

var pads = R.world.pads;
var home = pads[0];
var east = pads[1];
var parts = R.parts;
var catalog = R.constants.parts;
var frameDt = 1 / 120;
var game;
var i;

function createRun(cash) {
	var run = {
		currentPadId: home.id,
		targetPadId: east.id,
		rocket: R.rocket.create(home),
		phase: 'deck',
		cash: cash === undefined ? 1e6 : cash,
		ledger: [],
		flight: null,
		mission: null,
		lastReport: null,
		selection: { sourcePadId: home.id, targetPadId: east.id, mode: 'oneway', visible: true },
		simTime: 0,
		physicsAccumulator: 0,
		timeScaleIndex: R.constants.time.defaultIndex,
		timeScale: 4
	};

	game = run;
	R.game = run;
	R.operations.initialize();
	R.autopilot.setEnabled(false);
	return run;
}

function send(spec) {
	var filled = {
		source: home.id,
		destination: east.id,
		mode: 'oneway',
		fuelPolicy: 'refuel',
		outboundPayload: R.world.planet.defaultPayload,
		returnPayload: 0,
		typeId: R.operations.state.types[0].id,
		rocketId: null,
		profileId: 'balanced'
	};
	var key;

	for (key in spec) {
		filled[key] = spec[key];
	}
	return R.operations.dispatch(filled);
}

// Real flight, frame loop order, at the run's time scale. Returns the log entry
// the leg wrote: `game.flight` is released on touchdown.
function fly() {
	var frames = 0;

	while (game.phase === 'flying' && frames < 40000) {
		R.controls.update(game, frameDt * game.timeScale);
		R.physics.advance(game, frameDt);
		frames += 1;
	}
	assert.notEqual(game.phase, 'flying', 'the flight reaches an outcome');
	return R.flightLog.entries[0];
}

function instance() {
	return R.operations.state.fleet[0];
}

function addType(stages, name) {
	return R.operations.addType({
		name: name || 'service type',
		stageCount: stages.length,
		stages: stages,
		nominalPayload: R.world.planet.defaultPayload,
		defaultProfileId: 'balanced'
	});
}

// ------------------------------------------------------------- catalog shape

catalog.engines.forEach(function(engine) {
	assert.ok(engine.maxThrottleSeconds > 0 && Number.isFinite(engine.maxThrottleSeconds),
		engine.id + ' is rated in finite seconds at throttle');
	assert.ok(typeof engine.repairPerKg === 'number', engine.id + ' carries a repair rate');
	assert.ok(engine.repairPerKg > 0 && engine.repairPerKg < 1,
		engine.id + ' can be repaired for less than it costs to replace');
});
catalog.tanks.forEach(function(tank) {
	assert.ok(tank.maxFlights > 0, tank.id + ' is rated in legs flown');
	assert.ok(tank.repairPerKg > 0 && tank.repairPerKg < 1,
		tank.id + ' can be repaired for less than it costs to replace');
});
assert.ok(catalog.overhaulFactor > 0 && catalog.overhaulFactor < 1, 'an overhaul is cheaper than a new engine');

var standardEngine = parts.engine(catalog.defaultEngineId);
var lightTank = parts.tank('t-light');
assert.ok(lightTank.maxFlights < parts.tank(catalog.defaultTankId).maxFlights, 'a light tank wears out sooner');
assert.ok(parts.tank('t-heavy').maxFlights > parts.tank(catalog.defaultTankId).maxFlights, 'a reinforced one lasts longer');

// ------------------------------------------------------- wear on a real leg

createRun();
var reference = R.operations.state.types[0];
var rocket = instance();
assert.equal(rocket.stageState[0].engineBurnTimeUsed, 0, 'a new instance has no seconds on its engines');
assert.equal(rocket.stageState[0].lifeFlights, 0, 'and no legs on its tanks');
assert.equal(rocket.stageState[0].stress, 0, 'and no stress until 0.5 measures a touchdown');

assert.equal(send({}).ok, true, 'the reference leg is dispatched');
var flown = fly();
rocket = instance();
assert.ok(rocket.stageState[0].engineBurnTimeUsed > 0, 'the stage that burned has seconds on its engine');
assert.ok(rocket.stageState[0].engineBurnTimeUsed <= flown.elapsed + R.constants.rocket.fixedStep,
	'and never counts more seconds than the leg flew');
for (i = 0; i < rocket.stageCount; i += 1) {
	assert.equal(rocket.stageState[i].lifeFlights, rocket.stageState[i].engineBurnTimeUsed > 0 ? 1 : 0,
		'a leg counts against the tank of a stage that burned on it, not one that rode along cold or was left in the air');
}
assert.equal(rocket.stageState[0].lifeFlights, 1, 'the booster burned, so the leg is on its tank');
assert.equal(rocket.stageState[1].alive, true, 'the stages behind it came back attached');
assert.equal(rocket.stageState[1].lifeFlights, 0, 'and a hop that never lit them is no cycle on their tanks');

// The seconds land on the instance, so the next leg starts from them.
var flownSeconds = rocket.stageState[0].engineBurnTimeUsed;
assert.equal(game.rocket.stages[0].engineBurnTimeUsed, flownSeconds, 'the flight state and the instance agree');

// ------------------------------------------------ the turnaround replaces wear

// The booster is spent and the turnaround replaces it; the stages that landed
// keep the seconds and the legs they have on them.
rocket.stageState[0].alive = false;
rocket.stageState[0].fuelMass = 0;
rocket.stageState[1].engineBurnTimeUsed = flownSeconds;
rocket.stageState[1].lifeFlights = 1;
// The leg landed at Eastport, so the turnaround happens there.
assert.equal(send({ source: east.id, destination: home.id }).ok, true, 'the refuel leg is dispatched');
assert.equal(game.rocket.stages[0].engineBurnTimeUsed, 0, 'a rebuilt stage has a new engine');
assert.equal(game.rocket.stages[0].lifeFlights, 0, 'and a new tank');
assert.equal(game.rocket.stages[1].engineBurnTimeUsed, flownSeconds, 'a stage that only refuelled keeps its seconds');
assert.equal(game.rocket.stages[1].lifeFlights, 1, 'and its legs');
var turnaroundCharged = game.flight.turnaroundCost;
assert.ok(turnaroundCharged > 0, 'the leg paid for the stage it replaced');
assert.equal(fly().turnaroundCost, turnaroundCharged, 'and the log carries the turnaround');

// --------------------------------------------------------- tank life limits

// A tank past its rating is replaced by the next turnaround: the stage is still
// attached, but it is priced and it comes back new.
createRun();
var lightType = addType([
	parts.sanitizeStage({ fuelMass: 400, strength: 0.9, tankId: 't-light' }),
	parts.sanitizeStage({ fuelMass: 200, strength: 0.9 })
], 'light tank type');
R.operations.state.fleet.length = 0;
R.operations.createRocket(lightType, home);
rocket = instance();
rocket.stageState[0].lifeFlights = lightTank.maxFlights;
assert.equal(parts.wornOut(lightType.stages[0], rocket.stageState[0]), true, 'a tank at its rating is flown out');
assert.equal(parts.wornOut(lightType.stages[1], rocket.stageState[1]), false, 'a fresh tank is not');
assert.equal(parts.flightsLeft(lightType.stages[1], rocket.stageState[1]), parts.tank(catalog.defaultTankId).maxFlights,
	'flights left counts down from the rating');

var plan = R.operations.preparePlan(lightType, rocket, true);
assert.ok(plan.structureValue > 0, 'the flown-out tank is replaced even though its stage landed');
assert.equal(plan.structureValue, parts.stageStructureValue(lightType.stages[0]),
	'and only that stage is replaced');
assert.equal(plan.fuelMass, lightType.stages[0].fuelMass, 'a new tank is filled from empty');

var wornEvaluation = R.operations.evaluateLeg(lightType.id, home.id, R.world.planet.defaultPayload, true, null, false);
assert.equal(wornEvaluation.structureValue, parts.stageStructureValue(lightType.stages[0]),
	'the dispatch card quotes the replacement');
assert.equal(send({ typeId: lightType.id }).ok, true, 'and the leg flies');
assert.equal(game.rocket.stages[0].lifeFlights, 0, 'the replaced tank starts over');
assert.ok(game.flight.turnaroundCost > 0, 'and the leg paid for it');
fly();

// A no-refuel leg replaces nothing, worn tank or not: it flies on what landed.
rocket = instance();
rocket.stageState[0].lifeFlights = lightTank.maxFlights;
var noRefuelPlan = R.operations.preparePlan(lightType, rocket, false);
assert.equal(noRefuelPlan.structureValue, 0, 'a leg that buys nothing replaces nothing');
assert.equal(parts.wornOut(lightType.stages[0], rocket.stageState[0]), true, 'and the tank is still flown out');

// ------------------------------------------------------------ engine overhaul

createRun();
reference = R.operations.state.types[0];
rocket = instance();
rocket.stageState[0].engineBurnTimeUsed = standardEngine.maxThrottleSeconds;
assert.equal(parts.engineOverdue(reference.stages[0], rocket.stageState[0]), true, 'an engine at its rating is overdue');
assert.equal(parts.burnTimeLeft(reference.stages[0], rocket.stageState[0]), 0, 'with no seconds left');

var overdueValue = parts.overhaulValue(reference, rocket.stageState);
assert.equal(overdueValue, parts.stageOverhaulValue(reference.stages[0]), 'one overdue engine is one overhaul');
assert.equal(overdueValue, parts.stageBreakdown(reference.stages[0]).engineMass * standardEngine.costPerMass *
	catalog.overhaulFactor, 'priced as a fraction of a new engine');
// A stage that is already gone is not serviced.
rocket.stageState[0].alive = false;
assert.equal(parts.overhaulValue(reference, rocket.stageState), 0, 'a stage being rebuilt is not overhauled');
rocket.stageState[0].alive = true;

var blocked = R.operations.evaluateLeg(reference.id, home.id, R.world.planet.defaultPayload, true, null, false);
assert.equal(blocked.ready, false, 'a worn engine holds the launch');
assert.equal(blocked.reason, R.operations.reasons.NEEDS_OVERHAUL, 'with the overhaul reason');
assert.equal(blocked.cost, 0, 'and quotes nothing until it is authorized');
assert.ok(blocked.overhaulValue > 0, 'while saying what is worn');
assert.equal(send({}).reason, R.operations.reasons.NEEDS_OVERHAUL, 'so the dispatch is refused too');

var steel = R.economy.priceSteel(home.id);
var authorized = R.operations.evaluateLeg(reference.id, home.id, R.world.planet.defaultPayload, true, null, true);
assert.equal(authorized.ready, true, 'an authorized leg can fly');
assert.equal(authorized.overhaulCost, overdueValue * steel, 'and quotes the overhaul at the pad steel price');
assert.equal(authorized.cost, authorized.fuelMass * R.economy.priceFuel(home.id) +
	authorized.structureValue * steel + authorized.overhaulCost, 'the leg price is fuel, structure and service');

var cashBefore = game.cash;
assert.equal(send({ overhaul: true }).ok, true, 'the authorized leg is dispatched');
var overhaulEntry = game.ledger.filter(function(entry) {
	return entry.type === 'overhaul';
})[0];
assert.ok(overhaulEntry, 'the overhaul went through the ledger');
assert.equal(-overhaulEntry.amount, overdueValue * steel, 'for exactly the quoted amount');
assert.equal(game.flight.overhaulCost, -overhaulEntry.amount, 'and the flight records it');
assert.equal(game.cash, cashBefore - game.flight.fuelCost - game.flight.turnaroundCost - game.flight.overhaulCost,
	'the cash paid is what the leg itemizes');
assert.equal(rocket.stageState[0].engineBurnTimeUsed, 0, 'the overhaul bought the seconds back');
assert.equal(game.rocket.stages[0].engineBurnTimeUsed, 0, 'so the stack launches with a clean engine');
var overhaulCharged = game.flight.overhaulCost;
var entry = fly();
assert.equal(entry.overhaulCost, overhaulCharged, 'the log keeps the overhaul on the leg that paid it');
assert.equal(entry.repairCost, 0, 'and quotes the repair bill 0.5 will fill');

// An overdue engine is overhauled; one that is not due keeps its clock, because
// the price only covered the engine that was past its rating.
createRun();
reference = R.operations.state.types[0];
rocket = instance();
rocket.stageState[0].engineBurnTimeUsed = standardEngine.maxThrottleSeconds;
rocket.stageState[1].engineBurnTimeUsed = standardEngine.maxThrottleSeconds - 60;
assert.equal(send({ overhaul: true }).ok, true, 'the authorized leg is dispatched');
assert.equal(rocket.stageState[0].engineBurnTimeUsed, 0, 'the overdue engine is overhauled');
assert.equal(rocket.stageState[1].engineBurnTimeUsed, standardEngine.maxThrottleSeconds - 60,
	'and an engine that was not due keeps the seconds it has');
fly();

// A stage the turnaround is rebuilding is not serviced twice: its tank is flown
// out, the leg refuels, so the stage comes back with a fresh engine and the
// overhaul gate does not fire for it. A no-refuel leg keeps flying that stage,
// so its engine is the one that is overdue.
createRun();
var wornOverhaulType = addType([parts.sanitizeStage({ fuelMass: 400, strength: 0.9 })], 'worn stage type');
R.operations.state.fleet.length = 0;
R.operations.createRocket(wornOverhaulType, home);
rocket = instance();
rocket.stageState[0].lifeFlights = parts.tank(catalog.defaultTankId).maxFlights;
rocket.stageState[0].engineBurnTimeUsed = standardEngine.maxThrottleSeconds;
assert.equal(parts.overhaulValue(wornOverhaulType, rocket.stageState, true), 0,
	'a stage the turnaround replaces is not overhauled');
assert.equal(parts.overhaulValue(wornOverhaulType, rocket.stageState, false),
	parts.stageOverhaulValue(wornOverhaulType.stages[0]),
	'but a no-refuel leg still flies the worn stage and services its engine');
var wornOverhaulLeg = R.operations.evaluateLeg(wornOverhaulType.id, home.id,
	R.world.planet.defaultPayload, true, null, false);
assert.equal(wornOverhaulLeg.ready, true, 'so the refuel leg is not held by the overhaul gate');
assert.equal(wornOverhaulLeg.overhaulValue, 0, 'and quotes no service for a stage it is replacing');

// A leg that needs no service pays none, on the same rocket.
createRun();
reference = R.operations.state.types[0];
assert.equal(send({}).ok, true, 'a fresh rocket needs nothing');
assert.equal(game.flight.overhaulCost, 0, 'and pays no overhaul');
fly();
assert.equal(R.flightLog.entries[0].overhaulCost, 0, 'so the log records none');

// --------------------------------------------- a scheduled route stays serviced

createRun();
reference = R.operations.state.types[0];
rocket = instance();
rocket.stageState[0].engineBurnTimeUsed = standardEngine.maxThrottleSeconds + 1;
var route = R.operations.createRoute({
	name: 'serviced route',
	source: home.id,
	destination: east.id,
	mode: 'oneway',
	fuelPolicy: 'refuel',
	outboundPayload: R.world.planet.defaultPayload,
	returnPayload: 0,
	typeId: reference.id,
	profileId: 'balanced',
	enabled: true
});
var readiness = R.operations.routeReadiness(route);
assert.equal(readiness.ready, true, 'a standing service budgets its own maintenance');
assert.equal(readiness.reason, '', 'so a worn engine does not stall the route');
assert.equal(R.operations.dispatchRoute(route.id).ok, true, 'and it launches');
assert.ok(game.flight.overhaulCost > 0, 'paying for the overhaul on the leg');
fly();

// A hand-sent leg asks first: the same rocket is refused without the flag.
createRun();
reference = R.operations.state.types[0];
instance().stageState[0].engineBurnTimeUsed = standardEngine.maxThrottleSeconds + 1;
assert.equal(R.operations.evaluateLeg(reference.id, home.id, R.world.planet.defaultPayload, true, null).reason,
	R.operations.reasons.NEEDS_OVERHAUL, 'an unevaluated authorization is no authorization');

// ------------------------------------------------------------- repair is 0.5

// The bill is the damage the stack carries, priced through the parts: a stage
// that is merely stressed is repaired, one that is too far gone is replaced by
// the turnaround instead, and an engine that burned out is rebought whole.
createRun();
reference = R.operations.state.types[0];
rocket = instance();
var repairBreakdown = parts.stageBreakdown(reference.stages[0]);
var repairableQuote = repairBreakdown.engineMass * standardEngine.repairPerKg +
	repairBreakdown.tankMass * parts.tank(catalog.defaultTankId).repairPerKg;
rocket.stageState[0].stress = 0.3;
assert.ok(Math.abs(parts.stageRepairValue(reference.stages[0], rocket.stageState[0]) -
	0.3 * repairableQuote) < 1e-9, 'a stressed stage is billed by how damaged it is');
assert.equal(parts.scrapped(reference.stages[0], rocket.stageState[0]), false,
	'and a stage that is only damaged is still worth repairing');

rocket.stageState[0].stress = R.constants.damage.scrapStress;
assert.equal(parts.scrapped(reference.stages[0], rocket.stageState[0]), true,
	'a stage past the scrap threshold is beyond repair');
assert.equal(parts.repairValue(reference, rocket.stageState, true), 0,
	'and a refuelling turnaround replaces it rather than billing the repair');

rocket.stageState[0].stress = 0;
rocket.stageState[0].engineOut = true;
assert.ok(Math.abs(parts.stageRepairValue(reference.stages[0], rocket.stageState[0]) -
	repairBreakdown.engineMass * standardEngine.costPerMass) < 1e-9,
	'an engine that failed outright is rebought, not repaired');

// The leg that flies the stack pays the bill: the repair is part of what the
// dispatch has to buy, and the stack launches with the damage put right.
rocket.stageState[0].engineOut = false;
rocket.stageState[0].stress = 0.4;
var repairQuote = parts.repairValue(reference, rocket.stageState, true);
var repairMoney = repairQuote * R.economy.priceSteel(home.id);
var repairEvaluation = R.operations.evaluateLeg(reference.id, home.id, R.world.planet.defaultPayload,
	true, rocket.id, false, east.id);
assert.ok(repairQuote > 0, 'a damaged stack has a bill');
assert.equal(repairEvaluation.repairCost, repairMoney, 'the dispatch quotes it in money');
assert.ok(repairEvaluation.cost >= repairMoney, 'and counts it in what the leg has to buy');
var repairCashBefore = game.cash;
assert.equal(send({}).ok, true, 'and the leg still flies');
assert.equal(game.flight.repairCost, repairMoney, 'the flight record carries the repair');
assert.equal(game.cash, repairCashBefore - game.flight.fuelCost - game.flight.turnaroundCost -
	game.flight.overhaulCost - repairMoney, 'the leg pays it, through the ledger');
assert.equal(R.economy.priceSteel(home.id) > 0 && game.ledger.some(function(entry) {
	return entry.type === 'repair' && -entry.amount === repairMoney;
}), true, 'the repair went through the ledger');
assert.equal(game.rocket.stages[0].stress, 0, 'the stack launched with the damage put right');
assert.equal(rocket.stageState[0].stress, 0, 'and the instance carries no damage into the flight');
assert.equal(fly().repairCost, repairMoney, 'the log row keeps the repair on the leg that paid it');

console.log('Service and wear tests passed.');
