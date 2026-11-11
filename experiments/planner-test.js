'use strict';

// The ranking layer the deck renders: delta-v against payload through the real
// build evaluation, standing and contract economics through the real quote,
// the profit order the opportunity lists are sorted by, and the leg-time
// estimate that prefers the flight log over the distance heuristic.

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
require('../js/planner.js');

// Damage and failures are measured by experiments/failure.js; the planner is
// about ranking prices, so nothing here rolls a failure.
R.damage.enabled = false;

R.world.initialize('verdant');
R.camera.resize(1280, 720);

var planet = R.world.planet;
var home = R.world.pads[0];
var east = R.world.pads[1];

R.game = {
	currentPadId: home.id,
	targetPadId: east.id,
	rocket: R.rocket.create(home),
	phase: 'deck',
	cash: R.constants.economy.startingCash,
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
R.operations.initialize();

var reference = R.operations.state.types[0];
var hopper = R.operations.addType({
	name: 'Hopper',
	stageCount: 1,
	stages: [{ fuelMass: 40, strength: 0.9 }],
	nominalPayload: 40,
	defaultProfileId: 'balanced'
});
var hauler = R.operations.addType({
	name: 'Hauler',
	stageCount: 1,
	stages: [{ fuelMass: 100, strength: 0.9 }],
	nominalPayload: 300,
	defaultProfileId: 'balanced'
});

// Payload limits are TWR-shaped and capped by the catalog, so the three types
// must be checked in the order the numbers actually land in.
assert.ok(R.planner.payloadLimit(hopper) < R.planner.payloadLimit(hauler),
	'the hauler lifts more than the hopper');
assert.ok(R.planner.payloadLimit(hauler) < R.planner.payloadLimit(reference),
	'the reference lifts more than the hauler');

// The build evaluation the workshop and the dispatch card run, rebuilt here by
// hand from the type so the planner is checked against the rules, not against
// its own scratch copy of them.
function buildConfig(type, payloadMass) {
	return {
		stageCount: type.stageCount,
		payloadMass: payloadMass,
		stages: type.stages.map(function(stage) {
			return {
				fuelMass: stage.fuelMass,
				strength: stage.strength,
				engineId: stage.engineId,
				tankId: stage.tankId,
				fairingId: stage.fairingId
			};
		})
	};
}

// ------------------------------------------------------- delta-v vs payload

var curve = R.planner.deltaVCurve(reference, 12);
var stats = R.rocket.evaluateBuild(buildConfig(reference, 0));
var limit = R.planner.payloadLimit(reference);
var i;

assert.ok(Math.abs(limit - stats.payloadLimit) < 1e-9, 'the payload limit is evaluateBuild\'s limit');
assert.ok(curve.length >= 2 && curve.length <= 24, 'the curve is sampled inside its bound');
assert.equal(curve[0].payload, 0, 'the curve starts at an empty bay');
assert.ok(Math.abs(curve[curve.length - 1].payload - limit) < 1e-9, 'and ends at the bay limit');
for (i = 0; i < curve.length; i += 1) {
	stats = R.rocket.evaluateBuild(buildConfig(reference, curve[i].payload));
	assert.ok(Math.abs(curve[i].deltaV - stats.deltaV) < 1e-9,
		'curve delta-v at ' + Math.round(curve[i].payload) + ' kg matches evaluateBuild');
	assert.ok(Math.abs(curve[i].twr - stats.twr) < 1e-9, 'and so does its TWR');
	if (i > 0) {
		assert.ok(curve[i].deltaV <= curve[i - 1].deltaV, 'delta-v falls as payload grows');
	}
}
stats = R.rocket.evaluateBuild(buildConfig(reference, limit / 2));
assert.ok(Math.abs(R.planner.deltaVAt(reference, limit / 2) - stats.deltaV) < 1e-9,
	'a single payload lookup is the same evaluation');

// ------------------------------------------------- one leg's rank economics

var payload = Math.min(limit, R.market.demand(east.id));
var estimate = R.planner.legEstimate(reference, home.id, east.id, payload, null, false);
var quote = R.market.quote(home.id, east.id, payload, null);
var expectedFee = quote.reward * R.autopilot.feeFraction;
var expectedFuel = R.parts.typeFuelMass(reference) * R.economy.priceFuel(home.id);

assert.equal(estimate.reward, quote.reward, 'the standing quote is the market\'s quote');
assert.equal(estimate.pricePerKg, quote.pricePerKg, 'at the destination\'s live price');
assert.ok(Math.abs(estimate.fee - expectedFee) < 1e-9, 'the autopilot fee is its share of the reward');
assert.ok(Math.abs(estimate.fuelCost - expectedFuel) < 1e-9, 'fuel is a full load at the departure pad');
assert.ok(Math.abs(estimate.profit - (estimate.reward - estimate.fee - estimate.fuelCost)) < 1e-9,
	'profit is the reward less the fee and the fuel');
assert.ok(Math.abs(estimate.profitPerMinute - estimate.profit / estimate.seconds * 60) < 1e-9,
	'profit per minute is that profit over the predicted leg time');
assert.ok(Math.abs(estimate.margin - estimate.profit / estimate.reward) < 1e-9,
	'the margin is the profit share of the reward');
assert.equal(estimate.fits, true, 'a payload inside the bay and the demand fits');

var manualEstimate = R.planner.legEstimate(reference, home.id, east.id, payload, null, true);

assert.equal(manualEstimate.fee, 0, 'a manual flight pays no autopilot fee');
assert.ok(Math.abs(manualEstimate.profit - (manualEstimate.reward - manualEstimate.fuelCost)) < 1e-9,
	'so its profit is the reward less the fuel alone');
assert.equal(manualEstimate.seconds, estimate.seconds, 'both modes predict the same leg time');

var overBay = R.planner.legEstimate(hopper, home.id, east.id, 300, null, false);

assert.equal(overBay.fits, false, 'a contract-size load past the small type\'s bay does not fit');

// ------------------------------------------------- standing ranking by profit

var standing = R.planner.opportunities(reference, false);
var pads = R.world.pads;
var seen = {};
var row;
var expected;

assert.equal(standing.length, pads.length * (pads.length - 1), 'every ordered pad pair is ranked');
for (i = 0; i < standing.length; i += 1) {
	row = standing[i];
	assert.equal(row.kind, 'standing', 'standing rows are marked as standing');
	assert.ok(row.fromPadId !== row.toPadId, 'a row never pairs a pad with itself');
	seen[row.fromPadId + '>' + row.toPadId] = true;
	assert.equal(row.payloadMass, Math.min(R.planner.payloadLimit(reference), R.market.demand(row.toPadId)),
		'each row carries the most the bay and the destination will take');
	expected = R.planner.legEstimate(reference, row.fromPadId, row.toPadId, row.payloadMass, null, false);
	assert.ok(Math.abs(row.profit - expected.profit) < 1e-9, 'the row is priced by legEstimate');
	if (i > 0) {
		assert.ok(standing[i - 1].profit >= row.profit, 'rows are ranked by profit');
		if (standing[i - 1].profit === row.profit) {
			assert.ok(standing[i - 1].profitPerMinute >= row.profitPerMinute,
				'profit per minute breaks profit ties');
		}
	}
}
assert.equal(Object.keys(seen).length, pads.length * (pads.length - 1), 'no pair is listed twice');

// ------------------------------------------------------ contracts and fitting

function fakeContract(id, fromPadId, toPadId, payloadMass) {
	return {
		id: id,
		fromPadId: fromPadId,
		toPadId: toPadId,
		payloadMass: payloadMass,
		perKg: 12,
		turnsLeft: 4,
		fragile: false,
		status: 'open',
		assignedTo: null,
		postedTurn: 0
	};
}

var heavy = fakeContract(901, home.id, east.id, 300);
var light = fakeContract(902, east.id, home.id, 20);
var closed = fakeContract(903, home.id, east.id, 20);

closed.status = 'assigned';
R.market.state.contracts.length = 0;
R.market.state.contracts.push(heavy, light, closed);

// Ranked for the hopper, whose bay cannot take the heavy contract: the row is
// kept and flagged with the smallest type that can fly it.
var contracts = R.planner.contractOpportunities(hopper, false);

assert.equal(contracts.length, 2, 'only open contracts are ranked');
assert.equal(contracts[0].contract.id, light.id, 'a contract the bay can take is listed first');
assert.equal(contracts[0].fitsType, true, 'and marked as fitting');
assert.equal(contracts[0].fittingType, null, 'with no other type named');
assert.equal(contracts[1].contract.id, heavy.id, 'the contract past the bay is kept');
assert.equal(contracts[1].fitsType, false, 'marked as not fitting');
assert.equal(contracts[1].fittingType.id, hauler.id, 'and naming the smallest type that does');
assert.ok(Math.abs(contracts[1].fee - contracts[1].reward * R.autopilot.feeFraction) < 1e-9,
	'contracts rank on the same fee rule');

var manualContracts = R.planner.contractOpportunities(hopper, true);

assert.equal(manualContracts[1].fee, 0, 'manual ranking drops the fee from contracts too');

assert.equal(R.planner.smallestFittingType(light.payloadMass).id, hopper.id,
	'the smallest bay that lifts the light contract is the hopper');
assert.equal(R.planner.smallestFittingType(heavy.payloadMass).id, hauler.id,
	'the heavy contract points at the hauler');
assert.equal(R.planner.smallestFittingType(R.planner.payloadLimit(reference) + 1000), null,
	'nothing fits a payload past every bay');

R.market.state.contracts.length = 0;

// ---------------------------------------------------------- leg time estimate

var heuristic = Math.max(20, Math.min(120, 27 + R.operations.legDistance(home.id, east.id) * 0.0036));

assert.ok(Math.abs(R.planner.timeEstimate(home.id, east.id) - heuristic) < 1e-9,
	'with an empty log the estimate is the calibrated distance heuristic');

R.flightLog.append({ id: 1, routeId: null, departedPadId: home.id, targetPadId: east.id, elapsed: 40, cashDelta: 0 });
R.flightLog.append({ id: 2, routeId: null, departedPadId: east.id, targetPadId: home.id, elapsed: 60, cashDelta: 0 });
R.flightLog.append({ id: 3, routeId: null, departedPadId: home.id, targetPadId: east.id, elapsed: 0, cashDelta: 0 });

assert.equal(R.planner.timeEstimate(home.id, east.id), 50,
	'a measured average across both directions outranks the heuristic');
assert.equal(R.planner.timeEstimate(east.id, home.id), 50, 'and reads the pair either way round');

var route = { id: 'route-1', name: 'Test route' };

assert.equal(R.planner.measuredRoute(route), null, 'a route that has not flown has no measurement');
R.flightLog.append({ id: 4, routeId: route.id, departedPadId: home.id, targetPadId: east.id, elapsed: 40, cashDelta: 900 });
R.flightLog.append({ id: 5, routeId: route.id, departedPadId: home.id, targetPadId: east.id, elapsed: 60, cashDelta: 1100 });

var measured = R.planner.measuredRoute(route);

assert.equal(measured.legs, 2, 'the measurement counts the route\'s finished legs');
assert.equal(measured.cashPerLeg, 1000, 'and averages their cash');
assert.equal(measured.secondsPerLeg, 50, 'and their time');

console.log('Planner tests passed.');
