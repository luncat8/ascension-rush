'use strict';

var assert = require('node:assert/strict');
var harness = require('./harness.js');
var R = harness.R;
require('../js/competitor.js');

R.world.initialize('verdant');
R.damage.enabled = true;
R.camera.resize(1280, 720);

function createRun() {
	var home = R.world.pads[0];
	var game = harness.createGame(home, R.world.pads[1].id, 1, R.constants.economy.startingCash);

	R.game = game;
	R.operations.initialize();
	return game;
}

function land(game, pad) {
	game.rocket.wx = pad.wx;
	game.rocket.wy = 0;
	game.rocket.vx = 0;
	game.rocket.vy = -2;
	return R.mission.touchdown(game);
}

// Cash position, margin and experience keep the rival inside its tuning band.
var baseChance = R.competitor.bidChance(40000, 40000, 0.25, 0.25);
var leadingChance = R.competitor.bidChance(80000, 40000, 0.25, 0.25);
var trailingChance = R.competitor.bidChance(0, 40000, 0.25, 0.25);

assert.ok(baseChance >= 0.3 && baseChance <= 0.4, 'a fresh rival bids on roughly a third of profitable opportunities');
assert.ok(leadingChance >= 0.55 && leadingChance <= R.constants.competitor.maxBidChance,
	'a rival pushes harder when the player has a large cash lead');
assert.equal(trailingChance, R.constants.competitor.minBidChance,
	'a rival with the cash lead falls back to its floor');

// A player delivery advances the market once, then the rival takes a real
// autopilot/physics turn in an isolated operations context.
var game = createRun();
R.market.initialize(4);
R.competitor.initialize(4);
var playerOperations = R.operations.state;
var rival = R.competitor.state;
var rivalCash = rival.cash;
var playerType = R.operations.state.types[0];
var playerRocket = R.operations.state.fleet[0];
var result = R.operations.dispatch({
	source: R.world.pads[0].id,
	destination: R.world.pads[1].id,
	mode: 'oneway',
	fuelPolicy: 'refuel',
	outboundPayload: 80,
	returnPayload: 0,
	typeId: playerType.id,
	profileId: 'balanced'
});

assert.equal(result.ok, true, 'the player can start a standing shipment');
var report = land(game, R.world.pads[1]);

assert.equal(report.status, 'delivered');
assert.equal(R.market.turn(), 1, 'one finished player leg is one market turn, not two');
assert.equal(R.game, game, 'the main game object survives the rival simulation');
assert.equal(R.operations.state, playerOperations, 'the player fleet and operation state are restored');
assert.equal(R.operations.state.types[0], playerType, 'the rival does not replace the player build');
assert.equal(R.operations.state.fleet[0], playerRocket, 'the rival does not touch the player rocket');
assert.equal(R.flightLog.entries.length, 1, 'only the player flight is written to the player log');
assert.equal(R.operations.state.playerStats.deliveries, 1, 'the player scoreboard counts a delivered load');
assert.equal(R.operations.state.playerStats.reputation, 51, 'a delivery improves player reputation');
assert.equal(rival.turns, 1, 'the rival receives one turn after the player leg');
assert.equal(rival.contractsAccepted, 1, 'the seeded rival bids on the same open contract board');
assert.equal(rival.lastFlight.status, 'delivered', 'the rival resolves its flight to a real outcome');
assert.ok(rival.lastFlight.steps > 1000, 'its outcome comes from physics steps, not an instant delivery shortcut');
assert.ok(rival.lastFlight.elapsed > 10, 'the autopilot flies a full route');
assert.equal(rival.deliveries, 1, 'the rival scoreboard counts its successful shipment');
assert.equal(rival.reputation, 51, 'the rival earns delivery reputation too');
assert.ok(rival.cash > rivalCash, 'the rival pays its flight costs and receives its contract payout');
assert.equal(R.market.servedBy(rival.lastFlight.toPadId, rival.id), 1,
	'the rival destination records its own delivery volume');
assert.equal(R.market.find(rival.lastFlight.contractId), null, 'a rival-delivered contract leaves the board');
assert.equal(R.autopilot.enabled, false, 'the rival leaves player guidance switched off');
assert.equal(R.autopilot.phase, 'PAD', 'the rival restores the player guidance phase');
assert.equal(R.autopilot.profileId, 'balanced', 'the rival restores the player profile');
assert.equal(R.autopilot.command.throttle, 0, 'the rival leaves no throttle command on the player');
var playerCashAtDeck = game.cash;
R.competitor.takeTurn(game);
assert.equal(game.cash, playerCashAtDeck, 'a later rival flight cannot charge or credit player cash');
assert.equal(R.market.turn(), 1, 'a rival flight cannot create a second market turn');

// Rebuilding a lost rival vehicle is a priced operation, not an infinite free
// respawn. The new ship inherits the rival's catalog build and budget.
rival.operations.fleet[0].status = 'lost';
rival.cash += 20000;
var cashBeforeRebuild = rival.cash;
var rebuildCost = R.parts.typeBuildCost(rival.operations.types[0], rival.currentPadId);
R.market.state.contracts.length = 0;
R.competitor.takeTurn(game);
assert.equal(rival.operations.fleet.length, 2, 'a funded rival can build a replacement vehicle');
assert.ok(Math.abs(rival.cash - (cashBeforeRebuild - rebuildCost)) < 1e-8,
	'the replacement is paid from the rival budget');

// An out-and-back order returns to the deck between legs. The rival gets one
// turn after each landing, never while the player's physics is active.
var returnGame = createRun();
R.market.initialize(4);
R.competitor.initialize(4);
var returnRival = R.competitor.state;
result = R.operations.dispatch({
	source: R.world.pads[0].id,
	destination: R.world.pads[1].id,
	mode: 'return',
	fuelPolicy: 'refuel',
	outboundPayload: 80,
	returnPayload: 80,
	typeId: R.operations.state.types[0].id,
	profileId: 'balanced'
});
assert.equal(result.ok, true, 'a two-leg player dispatch can be sent');
land(returnGame, R.world.pads[1]);
assert.equal(returnGame.phase, 'deck', 'the return leg waits for player authorization');
assert.equal(R.operations.state.mission.status, 'awaiting-return', 'the order stays open between flights');
assert.equal(returnRival.turns, 1, 'the rival gets a turn after the first finished flight');
assert.equal(R.operations.sendReturnLeg().ok, true, 'the player can authorize the return after that turn');
assert.equal(returnGame.phase, 'flying', 'the return leg then uses its own flight');
land(returnGame, R.world.pads[0]);
assert.equal(returnRival.turns, 2, 'the rival gets one opportunity after each finished flight');
assert.equal(R.market.turn(), 2, 'the two player flight legs still advance two market turns');

// The rival's compute cap settles a hung flight as a normal external loss:
// it releases no player log entry and cannot age the shared board twice.
var timeoutGame = createRun();
timeoutGame.competitorSimulation = true;
result = R.operations.dispatch({
	source: R.world.pads[0].id,
	destination: R.world.pads[1].id,
	mode: 'oneway',
	fuelPolicy: 'refuel',
	outboundPayload: 80,
	returnPayload: 0,
	typeId: R.operations.state.types[0].id,
	profileId: 'balanced',
	operatorId: 'skybolt'
});
assert.equal(result.ok, true, 'an external flight can enter the shared dispatch path');
R.mission.timeout(timeoutGame);
assert.equal(timeoutGame.phase, 'deck', 'the bounded timeout ends the flight');
assert.equal(timeoutGame.lastReport.cause, 'timeout', 'the debrief names why it ended');
assert.equal(R.market.turn(), 0, 'an external timeout does not advance the shared market');
assert.equal(R.flightLog.entries.length, 0, 'an external timeout does not enter the player log');
assert.equal(R.operations.state.playerStats.reputation, 50, 'an external timeout cannot affect player standings');

console.log('Competitor, shared-market and isolated-flight tests passed.');
