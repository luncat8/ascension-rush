'use strict';

var assert = require('node:assert/strict');
var harness = require('./harness.js');
var R = harness.R;
require('../js/competitor.js');
require('../js/campaign.js');

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

// Initial state: first milestone active, gentle profile locked.
var game = createRun();
var state = R.campaign.state;
var m0 = R.campaign.activeMilestone();

assert.equal(m0.id, 'first-receipt', 'fresh run starts at the first milestone');
assert.equal(R.campaign.progress(m0), 0, 'no deliveries yet');
assert.equal(R.campaign.unlocked('balanced-profile'), true, 'balanced is always available');
assert.equal(R.campaign.unlocked('gentle-profile'), false, 'gentle is gated by a milestone');
assert.equal(R.operations.state.playerStats.reputation, R.constants.campaign.startReputation,
	'player reputation starts at the campaign default');

// Milestone 1: one standing service to Eastport awards the first-receipt grant.
var cashBefore = game.cash;
var result = R.operations.dispatch({
	source: R.world.pads[0].id,
	destination: R.world.pads[1].id,
	mode: 'oneway',
	fuelPolicy: 'refuel',
	outboundPayload: 80,
	returnPayload: 0,
	typeId: R.operations.state.types[0].id,
	profileId: 'balanced'
});
assert.equal(result.ok, true);
var report = land(game, R.world.pads[1]);
assert.equal(report.status, 'delivered');
m0 = R.campaign.activeMilestone();
assert.equal(m0.id, 'on-the-board', 'after first delivery the active milestone advances');
var reward = report.milestone;
assert.ok(reward && reward.milestone.id === 'first-receipt', 'the leg result carries the milestone award');
assert.equal(reward.reward.cash, 2000, 'first-receipt pays its cash grant');
assert.ok(game.cash > cashBefore + 1500, 'the grant is credited to player cash');

// Gentle profile is still locked until milestone 2.
assert.equal(R.campaign.unlocked('gentle-profile'), false, 'gentle stays locked until three contracts deliver');
var locked = R.operations.dispatch({
	source: R.world.pads[1].id,
	destination: R.world.pads[0].id,
	mode: 'oneway',
	fuelPolicy: 'refuel',
	outboundPayload: 80,
	returnPayload: 0,
	typeId: R.operations.state.types[0].id,
	profileId: 'gentle'
});
assert.equal(locked.ok, false, 'dispatch refuses a locked profile');
assert.equal(locked.reason, R.operations.reasons.LOCKED_PROFILE, 'it names the lock reason');

// Crash does not award a milestone and counts against the clean-streak window.
var failGame = harness.createGame(R.world.pads[1], R.world.pads[0].id, 1, game.cash);
failGame.competitorSimulation = true;
R.game = failGame;
R.operations.state.mission = null;
failGame.mission = null;
var failResult = R.operations.dispatch({
	source: R.world.pads[1].id,
	destination: R.world.pads[0].id,
	mode: 'oneway',
	fuelPolicy: 'refuel',
	outboundPayload: 80,
	returnPayload: 0,
	typeId: R.operations.state.types[0].id,
	profileId: 'balanced',
	operatorId: 'skybolt'
});
assert.equal(failResult.ok, true);
R.mission.timeout(failGame);
var reliable = null;
for (var i = 0; i < state.ladder.length; i += 1) {
	if (state.ladder[i].id === 'reliable') { reliable = state.ladder[i]; }
}
assert.ok(R.campaign.progress(reliable) < reliable.target,
	'a crashed rival leg does not hand the player the reliable-service milestone');
R.game = game;

console.log('Campaign, milestone and unlock tests passed.');
