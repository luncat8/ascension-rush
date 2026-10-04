'use strict';

// Pad markets and the contract board: seeded prices, bounded drift, the quote
// a leg is paid, and the life of a contract (posted, assigned, delivered,
// released, expired). Legs that need only an outcome are adjudicated by
// putting the rocket down where the test says it landed.

var assert = require('node:assert/strict');
var R = require('../js/namespaces.js');

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
require('../js/mission.js');
require('../js/aerodynamics.js');
require('../js/physics.js');
require('../js/trajectory.js');
require('../js/autopilot.js');
require('../js/operations.js');
require('../js/controls.js');
require('../js/input.js');

R.world.initialize('verdant');
R.camera.resize(1280, 720);

var settings = R.constants.market;
var planet = R.world.planet;
var pads = R.world.pads;
var home = pads[0];
var east = pads[1];
var far = pads[2];
var frameDt = 1 / 120;

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

	R.game = run;
	R.operations.initialize();
	return run;
}

function send(spec) {
	var filled = {
		source: home.id,
		destination: east.id,
		mode: 'oneway',
		fuelPolicy: 'refuel',
		outboundPayload: planet.defaultPayload,
		returnPayload: 0,
		typeId: R.operations.state.types[0].id,
		rocketId: null,
		profileId: 'balanced',
		contractId: null
	};
	var key;

	for (key in spec) {
		filled[key] = spec[key];
	}
	return R.operations.dispatch(filled);
}

function land(game, pad, verticalSpeed) {
	game.rocket.wx = pad.wx;
	game.rocket.wy = 0;
	game.rocket.vx = 0;
	game.rocket.vy = verticalSpeed === undefined ? -2 : verticalSpeed;
	return R.mission.touchdown(game);
}

function fly(game) {
	var frames = 0;

	while (game.phase === 'flying' && frames < 40000) {
		R.controls.update(game, frameDt * game.timeScale);
		R.physics.advance(game, frameDt);
		frames += 1;
	}
	assert.notEqual(game.phase, 'flying', 'the flight reaches an outcome');
}

function contractAt(padId, predicate) {
	var contracts = R.market.contractsAt(padId);
	var i;

	for (i = 0; i < contracts.length; i += 1) {
		if (contracts[i].status === 'open' && (!predicate || predicate(contracts[i]))) {
			return contracts[i];
		}
	}
	return null;
}

// ------------------------------------------------------------ seeded prices

var game = createRun();
var firstState = JSON.stringify(R.market.state);

assert.equal(R.market.state.planetId, 'verdant');
assert.equal(R.market.turn(), 0);
assert.equal(R.market.state.pads.length, pads.length, 'every pad has its own price table');
assert.equal(R.market.state.contracts.length, pads.length * settings.contractSlots,
	'every pad opens with a full board');

// The same world reproduces the same market; a different seed does not.
createRun();
assert.equal(JSON.stringify(R.market.state), firstState, 'a run reproduces its seeded market');
var changed = false;
var probe = 0;

R.market.initialize(1);
assert.notEqual(JSON.stringify(R.market.state), firstState, 'another seed is another market');
assert.equal(R.market.seedFor('verdant') !== R.market.seedFor('cinder'), true, 'each world has its own seed');
assert.equal(R.market.seedFor('verdant'), R.market.seedFor('verdant'));
game = createRun();

// Prices start near the planet's list price and stay inside the pad spread.
assert.notEqual(R.market.state.pads.length, 0);
for (probe = 0; probe < 200; probe += 1) {
	R.market.advance();
}
var padIndex;
var field;

for (padIndex = 0; padIndex < pads.length; padIndex += 1) {
	['fuel', 'steel', 'delivery'].forEach(function(name) {
		var price = R.market.price(pads[padIndex].id, name);
		var base = planet.prices[name];

		assert.ok(price >= base * (1 - settings.padSpread) - 1e-9 && price <= base * (1 + settings.padSpread) + 1e-9,
			padIndex + ' ' + name + ' stays inside the pad spread after 200 turns');
	});
}

// Mean reversion pulls a price that was pushed to a bound back toward the list
// price instead of leaving it there.
var pushed = R.market.state.pads[0];
pushed.delivery = planet.prices.delivery * (1 - settings.padSpread);
R.market.advance();
assert.ok(R.market.price(home.id, 'delivery') > planet.prices.delivery * (1 - settings.padSpread),
	'a price at the lower bound recovers toward the list price');

// Without a market (a cold render) the planet's list price is the answer.
assert.equal(R.market.price('nowhere', 'fuel'), planet.prices.fuel);

// A cheap pad really is cheaper to fuel at: the same load costs different money.
var cheap = pads[0];
var dear = pads[0];
var i;
var fuelPrices = [];

for (i = 0; i < pads.length; i += 1) {
	fuelPrices.push(R.market.price(pads[i].id, 'fuel'));
	if (R.market.price(pads[i].id, 'fuel') < R.market.price(cheap.id, 'fuel')) {
		cheap = pads[i];
	}
	if (R.market.price(pads[i].id, 'fuel') > R.market.price(dear.id, 'fuel')) {
		dear = pads[i];
	}
}
assert.ok(fuelPrices.some(function(value) { return value !== fuelPrices[0]; }),
	'pads do not all quote the same fuel price');
assert.ok(R.economy.priceFuel(cheap.id) < R.economy.priceFuel(dear.id), 'the spread is real money');

// ------------------------------------------------------------- the board

game = createRun();
var board = R.market.contractsAt(home.id);

assert.equal(board.length, settings.contractSlots, 'the home pad posts a full board');
assert.notEqual(contractAt(home.id), null, 'and at least one contract is open');
board.forEach(function(contract) {
	assert.notEqual(contract.toPadId, contract.fromPadId, 'a contract goes somewhere else');
	assert.ok(contract.payloadMass >= 10 && contract.payloadMass <= R.constants.rocket.maxPayloadMass,
		'payload is inside the rocket catalog bounds');
	assert.equal(contract.payloadMass % 10, 0, 'and rounds to ten kilos');
	assert.ok(contract.turnsLeft >= settings.minContractTurns && contract.turnsLeft <= settings.maxContractTurns);
	assert.ok(contract.perKg > R.market.price(contract.toPadId, 'delivery'),
		'a contract pays a premium over the destination standing price');
	assert.equal(contract.status, 'open');
});

// --------------------------------------------------------------- the quote

var payload = 80;
var standing = R.market.quote(home.id, far.id, payload, null);
var standingReward = standing.reward;
var standingPerKg = standing.pricePerKg;

assert.ok(Math.abs(standingPerKg - R.market.price(far.id, 'delivery') *
	(1 + settings.distanceBonus * R.operations.legDistance(home.id, far.id) / planet.circumference)) < 1e-9,
	'a standing service pays the destination price plus a distance factor');
var shortHop = R.market.quote(home.id, east.id, payload, null).pricePerKg;
assert.ok(standingPerKg > shortHop, 'a longer leg pays more per kilo');

// The quote is frozen at dispatch: a turn of drift while the rocket flies does
// not change the log's reward.
var frozenRun = createRun();
assert.equal(send({ destination: far.id, outboundPayload: payload }).ok, true);
var frozenQuote = frozenRun.flight.rewardQuote;
R.market.advance();
R.market.advance();
var frozenReport = land(frozenRun, far);
assert.equal(frozenReport.status, 'delivered');
assert.equal(R.flightLog.entries[0].revenue, frozenQuote, 'the payout is the one quoted at dispatch');
assert.equal(frozenReport.reward, frozenQuote);

// ------------------------------------------------------- contract lifecycle

game = createRun();
var contract = contractAt(home.id);
var contractId = contract.id;
var contractPayload = contract.payloadMass;
var contractReward = contract.payloadMass * contract.perKg;
var contractsBefore = R.market.state.contracts.length;

assert.equal(send({ destination: contract.toPadId, outboundPayload: contract.payloadMass, contractId: contractId }).ok, true,
	'the contract dispatches on its own pads and payload');
assert.equal(R.market.find(contractId).status, 'assigned', 'taking it takes it off the board');
assert.equal(R.market.contractsAt(home.id).length, settings.contractSlots,
	'the pad posts a replacement so the board stays full');
assert.equal(contractAt(home.id, function(row) { return row.id === contractId; }), null, 'the taken contract is not offered again');

assert.equal(R.market.assign(contractId), false, 'an assigned contract cannot be taken twice');

// A contract is flown on its own pads with its own payload: anything else is
// refused before cash or fleet are touched.
game = createRun();
contract = contractAt(home.id);
assert.equal(send({ destination: contract.toPadId, outboundPayload: contract.payloadMass + 10, contractId: contract.id }).reason,
	R.operations.reasons.CONTRACT_MISMATCH, 'a contract cannot fly another payload');
var otherPad = pads.filter(function(pad) {
	return pad.id !== contract.fromPadId && pad.id !== contract.toPadId;
})[0];
assert.equal(send({ source: otherPad.id, destination: contract.toPadId, outboundPayload: contract.payloadMass, contractId: contract.id }).reason,
	R.operations.reasons.CONTRACT_MISMATCH, 'nor from another pad');
assert.equal(send({ destination: contract.toPadId, outboundPayload: contract.payloadMass, contractId: 999999 }).reason,
	R.operations.reasons.CONTRACT_GONE, 'nor can a contract that is not on the board fly');
assert.equal(R.operations.state.mission, null, 'and a refused contract leaves nothing in the air');

// ------------------------------------------------------- contract lifecycle

game = createRun();
contract = contractAt(home.id);
contractId = contract.id;
contractPayload = contract.payloadMass;
assert.equal(send({ destination: contract.toPadId, outboundPayload: contract.payloadMass, contractId: contract.id }).ok, true,
	'the contract dispatches on its own pads and payload');
assert.equal(R.market.find(contractId).status, 'assigned', 'taking it takes it off the board');
assert.equal(contractAt(home.id, function(row) { return row.id === contractId; }), null, 'the taken contract is not offered again');
game = createRun();
contract = contractAt(home.id);
var freshId = contract.id;
var servedBefore = R.market.servedAt(contract.toPadId);
var deliveryBefore = R.market.price(contract.toPadId, 'delivery');
assert.equal(send({ destination: contract.toPadId, outboundPayload: contract.payloadMass, contractId: freshId }).ok, true);
var contractReport = land(game, R.world.findPadById(contract.toPadId));

assert.equal(contractReport.status, 'delivered');
assert.equal(contractReport.rewardPerKg, contract.perKg, 'the delivered rate is the posted one');
assert.equal(R.market.find(freshId), null, 'a delivered contract is done');
assert.equal(R.market.servedAt(contract.toPadId), servedBefore + 1, 'and the destination has been served');
assert.ok(R.market.price(contract.toPadId, 'delivery') < deliveryBefore,
	'serving a pad pushes its delivery price down a step');
assert.ok(R.market.state.contracts.length >= contractsBefore, 'the board refills');
var entry = R.flightLog.entries[0];
assert.equal(entry.contractId, freshId, 'the log keeps the contract it flew');
assert.equal(entry.rewardPerKg, contract.perKg, 'and the rate');
assert.equal(entry.revenue, contract.payloadMass * contract.perKg, 'and pays the contract, not the standing price');
assert.equal(entry.cargoLost, false);
assert.match(contractReport.detail, /Contract delivered: \d+ kg at \$\d+\.\d\d\/kg\./);

// A failed leg puts the contract back on the board with its turns left.
game = createRun();
contract = contractAt(home.id);
var turnsLeft = contract.turnsLeft;
assert.equal(send({ destination: contract.toPadId, outboundPayload: contract.payloadMass, contractId: contract.id }).ok, true);
var failedReport = land(game, far, -2);

assert.equal(failedReport.status, 'landed', 'a safe landing on the wrong pad is not a delivery');
assert.equal(R.market.find(contract.id).status, 'open', 'the contract is back on the board');
assert.ok(R.market.find(contract.id).turnsLeft >= 1, 'with turns left to try again');
assert.equal(R.flightLog.entries[0].contractId, contract.id, 'and the log remembers which contract it was');

// A crash loses the rocket and releases the contract too.
game = createRun();
contract = contractAt(home.id);
assert.equal(send({ destination: contract.toPadId, outboundPayload: contract.payloadMass, contractId: contract.id }).ok, true);
var crashReport = land(game, far, -40);
assert.equal(crashReport.status, 'crashed');
assert.equal(R.market.find(contract.id).status, 'open', 'a crash does not eat the contract');

// An open contract ages one turn per finished leg and expires; a boarded one
// is not aged while it is in the air.
game = createRun();
contract = contractAt(home.id);
var expiryId = contract.id;
var expiryTurns = contract.turnsLeft;
for (i = 0; i < expiryTurns; i += 1) {
	R.market.advance();
}
assert.equal(R.market.find(expiryId), null, 'a contract past its turns is gone');
assert.equal(R.market.contractsAt(home.id).length, settings.contractSlots, 'and the board is full again');

game = createRun();
contract = contractAt(home.id);
assert.equal(send({ destination: contract.toPadId, outboundPayload: contract.payloadMass, contractId: contract.id }).ok, true);
for (i = 0; i < settings.maxContractTurns + 2; i += 1) {
	R.market.advance();
}
assert.notEqual(R.market.find(contract.id), null, 'a contract being flown keeps its clock');
assert.equal(R.market.find(contract.id).turnsLeft, contract.turnsLeft);

// --------------------------------------------------------------- fragile

// Scan seeds for a fragile contract at home: the test does not care which one,
// only that the rule is exercised.
var fragileSeed = 0;
var fragileContract = null;

for (fragileSeed = 1; fragileSeed < 500 && !fragileContract; fragileSeed += 1) {
	R.market.initialize(fragileSeed);
	fragileContract = contractAt(home.id, function(item) { return item.fragile; });
}
assert.notEqual(fragileContract, null, 'some seeds post fragile cargo');
game = createRun();
R.market.initialize(fragileSeed - 1);
fragileContract = contractAt(home.id, function(item) { return item.fragile; });
assert.notEqual(fragileContract, null, 'and the same seed posts it again');
var fragileSpeed = planet.landingVerticalSpeed * settings.fragileSpeedFactor;
assert.equal(send({ destination: fragileContract.toPadId, outboundPayload: fragileContract.payloadMass, contractId: fragileContract.id }).ok, true);
assert.equal(Math.abs(game.flight.fragileSpeed - fragileSpeed) < 1e-9, true, 'the flight carries the cargo limit');

// Hard but safe for the rocket, too hard for the cargo.
var lostReport = land(game, R.world.findPadById(fragileContract.toPadId), -(fragileSpeed + 1));
assert.equal(lostReport.status, 'landed');
assert.equal(lostReport.cargoLost, true, 'fragile cargo does not survive the hard touchdown');
assert.equal(lostReport.title, 'CARGO DESTROYED');
assert.equal(R.flightLog.entries[0].revenue, 0, 'and nobody pays for a broken crate');
assert.equal(R.flightLog.entries[0].cargoLost, true);
assert.equal(R.market.find(fragileContract.id).status, 'open', 'the contract is back on the board');
assert.match(lostReport.detail, /fragile cargo was destroyed/);

// The same contract landed softly pays.
game = createRun();
R.market.initialize(fragileSeed - 1);
fragileContract = contractAt(home.id, function(item) { return item.fragile; });
assert.equal(send({ destination: fragileContract.toPadId, outboundPayload: fragileContract.payloadMass, contractId: fragileContract.id }).ok, true);
var softReport = land(game, R.world.findPadById(fragileContract.toPadId), -2);
assert.equal(softReport.status, 'delivered', 'a soft touchdown delivers fragile cargo');
assert.equal(softReport.cargoLost, false);
assert.equal(R.flightLog.entries[0].revenue, fragileContract.payloadMass * fragileContract.perKg);

// ------------------------------------------------------- real flight, real payout

game = createRun();
contract = contractAt(home.id);
assert.equal(send({ destination: contract.toPadId, outboundPayload: contract.payloadMass, contractId: contract.id }).ok, true);
var realQuote = game.flight.rewardQuote;
fly(game);
assert.equal(game.lastReport.status, 'delivered', 'the autopilot flies a contracted leg');
assert.equal(R.flightLog.entries[0].revenue, realQuote, 'and the contract pays the quoted reward');
assert.equal(R.market.find(contract.id), null, 'the real flight fulfils it');
assert.ok(game.cash > 0);

// ---------------------------------------------------------------- worlds

R.world.initialize('cinder');
game = createRun();
assert.equal(R.market.state.planetId, 'cinder', 'a planet switch is a new market');
assert.equal(R.market.state.pads.length, R.world.pads.length);
assert.equal(R.market.price(home.id, 'fuel') > 0, true);
R.world.initialize('verdant');

console.log('Market, contract and quote tests passed.');
