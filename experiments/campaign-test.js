'use strict';

var assert = require('node:assert/strict');
var childProcess = require('node:child_process');
var fs = require('node:fs');
var path = require('node:path');
var harness = require('./harness.js');
var R = harness.R;
require('../js/competitor.js');
require('../js/campaign.js');

var settings = R.constants.campaign;

R.damage.enabled = true;
R.camera.resize(1280, 720);

// What main.restart does to the simulation: the world, then a run on it. The
// campaign record is left alone, exactly as a world switch leaves it.
function startRun(planetId) {
	var game;

	R.world.initialize(planetId);
	game = harness.createGame(R.world.pads[0], R.world.pads[1].id, 1);
	R.game = game;
	R.operations.initialize();
	return game;
}

function newCampaign(planetId) {
	R.campaign.reset();
	return startRun(planetId || 'verdant');
}

function fleetRocket() {
	return R.operations.state.fleet.filter(function(rocket) {
		return rocket.status === 'available';
	})[0];
}

function send(toPad, extra) {
	var rocket = fleetRocket();
	var spec = {
		source: rocket.padId,
		destination: toPad.id,
		mode: 'oneway',
		fuelPolicy: 'refuel',
		outboundPayload: 80,
		returnPayload: 0,
		typeId: R.operations.state.types[0].id,
		profileId: 'balanced',
		overhaul: true
	};

	Object.keys(extra || {}).forEach(function(key) {
		spec[key] = extra[key];
	});
	return R.operations.dispatch(spec);
}

function land(game, pad, verticalSpeed) {
	game.rocket.wx = pad.wx;
	game.rocket.wy = 0;
	game.rocket.vx = 0;
	game.rocket.vy = verticalSpeed || -2;
	return R.mission.touchdown(game);
}

function deliver(game, toPad, extra) {
	var order = send(toPad, extra);

	assert.equal(order.ok, true, 'the test leg dispatches: ' + order.reason);
	return land(game, toPad);
}

// The pad the fleet rocket is not standing on, so a chain of legs can go on.
function otherPad() {
	var here = fleetRocket().padId;

	return R.world.pads[0].id === here ? R.world.pads[1] : R.world.pads[0];
}

// A board contract from where the rocket stands, pointed at `toPad`.
function contractTo(toPad, fragile) {
	var contract = R.market.contractsAt(fleetRocket().padId).filter(function(candidate) {
		return candidate.status === 'open';
	})[0];

	contract.toPadId = toPad.id;
	contract.payloadMass = 80;
	contract.fragile = !!fragile;
	contract.turnsLeft = 4;
	return contract;
}

function deliverContract(game, toPad, fragile) {
	var contract = contractTo(toPad, fragile);

	return deliver(game, toPad, { contractId: contract.id });
}

function activeId() {
	var milestone = R.campaign.activeMilestone();

	return milestone ? milestone.id : null;
}

function ladderIndex(planetId, milestoneId) {
	return settings.worlds[planetId].map(function(milestone) {
		return milestone.id;
	}).indexOf(milestoneId);
}

// Puts the run on a given rung without flying the ones before it: the record
// says they are cleared, and a fresh run of the world resumes after them.
function resumeAt(planetId, milestoneId) {
	var ladder = settings.worlds[planetId];
	var i;

	for (i = 0; i < ladderIndex(planetId, milestoneId); i += 1) {
		R.campaign.record.completed[planetId + ':' + ladder[i].id] = true;
	}
	return startRun(planetId);
}

// ---------------------------------------------------------------- the ladders

R.planets.list.forEach(function(planet) {
	var ladder = settings.worlds[planet.id];
	var names = planet.pads.map(function(pad) {
		return pad.name;
	});

	assert.equal(ladder.length, 6, planet.name + ' has a six-milestone ladder');
	assert.equal(ladder[ladder.length - 1].kind, 'dominant', planet.name + ' ends on the dominant-courier settlement');
	ladder.forEach(function(milestone) {
		assert.ok(milestone.title && milestone.detail && milestone.reward, planet.name + ' milestones are fully described');
		assert.ok(milestone.kind !== 'contractTo' || names.indexOf(milestone.padName) >= 0,
			planet.name + ' ' + milestone.id + ' names a pad of its own world');
	});
});
assert.equal(settings.worlds.verdant[4].reward.unlock, 'world:tinmoon', 'Verdant opens Tinmoon');
assert.equal(settings.worlds.tinmoon[4].reward.unlock, 'world:cinder', 'Tinmoon opens Cinder');
assert.equal(settings.worlds.cinder[4].reward.unlock, 'world:gossamer', 'Cinder opens Gossamer');

// ------------------------------------------------------------- a fresh company

var game = newCampaign();
var pads = R.world.pads;

assert.equal(activeId(), 'first-receipt', 'a fresh run starts at the first milestone');
assert.equal(R.campaign.progress(), 0, 'with nothing delivered');
assert.equal(R.campaign.profileUnlocked('balanced'), true, 'the default profile is always available');
assert.equal(R.campaign.profileUnlocked('gentle'), false, 'Gentle is gated by a milestone');
assert.equal(R.campaign.worldUnlocked('verdant'), true, 'the starting world is always open');
assert.equal(R.campaign.worldUnlocked('tinmoon'), false, 'the next world is not');
assert.equal(R.operations.state.playerStats.reputation, settings.startReputation,
	'the company starts at the default reputation');
assert.equal(R.competitor.state.reputation, 50, 'and so does the rival');
assert.equal(R.competitor.state.skill, R.constants.competitor.initialSkill, 'with no head start');
assert.equal(R.competitor.state.noticed, false, 'and no notice taken');

// Milestone 1: any delivered leg, and the grant goes through the ledger.
var cashBefore = game.cash;
var report = deliver(game, pads[1]);
var grant = game.ledger.filter(function(entry) {
	return entry.type === 'grant';
});

assert.equal(report.status, 'delivered');
assert.equal(report.milestones.length, 1, 'the debrief carries the award');
assert.equal(report.milestones[0].milestone.id, 'first-receipt');
assert.equal(report.milestones[0].number, 1);
assert.ok(report.milestones[0].rewardText.indexOf('$1,000 grant') >= 0, 'and says what it paid');
assert.equal(grant.length, 1, 'the grant is one ledger entry');
assert.equal(grant[0].amount, settings.worlds.verdant[0].reward.cash);
assert.ok(game.cash > cashBefore + grant[0].amount - 1, 'credited on top of the leg');
assert.equal(activeId(), 'on-the-board', 'the next milestone is active');
assert.equal(R.campaign.progressText(), '0 / 3 contracts', 'and reads in its own unit');

// ----------------------------------------------------------- the profile lock

var locked = send(otherPad(), { profileId: 'gentle' });
var lockReason = R.operations.reasons.LOCKED_PROFILE + 'ON THE BOARD (VERDANT)';

assert.equal(locked.ok, false, 'dispatch refuses a locked profile');
assert.equal(locked.reason, lockReason, 'and names the milestone that opens it');
assert.equal(R.operations.state.mission, null, 'nothing was launched');

// A saved route on a locked profile waits with the lock as its reason, and is
// never offered: an auto-launch cannot loop on a dispatch that will refuse.
var lockedRoute = R.operations.createRoute({
	name: 'Locked', source: fleetRocket().padId, destination: otherPad().id, mode: 'oneway', fuelPolicy: 'refuel',
	outboundPayload: 80, returnPayload: 0, typeId: R.operations.state.types[0].id, profileId: 'gentle', enabled: true
});

assert.equal(R.operations.routeReadiness(lockedRoute).ready, false, 'a route on a locked profile is not ready');
assert.equal(R.operations.routeReadiness(lockedRoute).reason, lockReason, 'and says why');
R.operations.run(game, 0.1);
assert.equal(R.operations.state.offer, null, 'so the scheduler never offers it');
R.operations.deleteRoute(lockedRoute.id);

// The lock is the player's. The rival flies by its own rules: its dispatch on
// the same profile goes through its own operations state untouched.
var rivalGame = harness.createGame(R.world.findPadById(fleetRocket().padId), otherPad().id, 1);
var playerMission = R.operations.state.mission;

rivalGame.competitorSimulation = true;
R.game = rivalGame;
var rivalOrder = send(otherPad(), { profileId: 'gentle', operatorId: R.competitor.id });

assert.equal(rivalOrder.ok, true, 'the rival is not held by the player\'s lock');
R.mission.timeout(rivalGame);
R.game = game;
assert.equal(playerMission, null);
assert.equal(R.campaign.state.legs, 1, 'and a rival flight is not a leg of the player\'s campaign');
// The borrowed flight wrote off the fleet rocket; the company buys another.
assert.equal(R.operations.buildRocket(R.operations.state.types[0].id, pads[0].id).ok, true);

// --------------------------------------------- tasks, totals and failed legs

// Three contracts clear "On the board" and open Gentle for dispatch.
deliverContract(game, otherPad());
deliverContract(game, pads[2]);
assert.equal(R.campaign.progress(), 2);
report = deliverContract(game, otherPad());
assert.equal(report.milestones[0].milestone.id, 'on-the-board');
assert.equal(R.campaign.profileUnlocked('gentle'), true, 'the milestone unlocks Gentle');
assert.equal(R.operations.profileLock('gentle'), '', 'and the dispatch gate opens with it');
assert.equal(activeId(), 'haulier');
assert.equal(R.campaign.progressText(), '320 / 1000 kg delivered', 'cargo is a company total: every leg so far counts');

// A crash clears nothing, even with the measure already met, and breaks the
// clean run; the next delivered leg collects.
R.campaign.state.cargoKg = settings.worlds.verdant[2].target;
var crashSite = otherPad();

assert.equal(send(crashSite).ok, true);
report = land(game, crashSite, -60);
assert.equal(report.status, 'crashed');
assert.equal(report.milestones.length, 0, 'a crashed leg awards nothing');
assert.equal(activeId(), 'haulier', 'the milestone is still open');
assert.equal(R.campaign.state.cleanLegs, 0, 'and the clean run starts over');
assert.equal(R.operations.buildRocket(R.operations.state.types[0].id, pads[0].id).ok, true);
report = deliver(game, otherPad());
assert.equal(report.milestones[0].milestone.id, 'haulier', 'the next delivery collects it');
assert.equal(activeId(), 'reliable');

// Reputation alone is not reliability: it needs the clean run as well.
R.operations.state.playerStats.reputation = 80;
assert.equal(R.campaign.progress(), settings.worlds.verdant[3].target - 1, 'a short clean run stops one short');
assert.ok(/REP 80 \/ 65 · 1 \/ 5 clean legs/.test(R.campaign.progressText()));
report = deliver(game, otherPad());
assert.equal(report.milestones.length, 0);
deliver(game, otherPad());
deliver(game, otherPad());
report = deliver(game, otherPad());
assert.equal(report.milestones[0].milestone.id, 'reliable', 'five clean legs at the reputation clear it');
assert.equal(R.competitor.state.noticed, true, 'and the rival takes notice');

// A task counts from the moment it is active: the contracts already flown to
// Farport do not clear "Long reach".
assert.equal(activeId(), 'long-reach');
assert.equal(R.campaign.state.contractsToPad[pads[2].id], 1, 'a contract was flown to Farport before the task opened');
assert.equal(R.campaign.progress(), 0, 'and a task starts from zero all the same');
if (fleetRocket().padId !== pads[0].id) {
	deliver(game, pads[0]);
}
report = deliverContract(game, pads[1]);
assert.equal(report.milestones.length, 0, 'a contract to another pad does not count');
report = deliverContract(game, pads[2]);
assert.equal(report.milestones[0].milestone.id, 'long-reach');
assert.equal(R.campaign.worldUnlocked('tinmoon'), true, 'Long reach opens Tinmoon');
assert.equal(R.campaign.worldUnlocked('cinder'), false, 'and only Tinmoon');

// ------------------------------------------------------ the dominant settlement

var rival = R.competitor.state;

assert.equal(activeId(), 'dominant');
rival.cash = game.cash + 5000;
assert.ok(R.campaign.progressText().indexOf(rival.name + ' still leads by $') === 0, 'behind on cash reads as a deficit');
rival.cash = game.cash - 5000;
R.market.state.pads.forEach(function(entry) {
	entry.playerServed = 0;
	entry.competitorServed = 0;
});
assert.equal(R.campaign.standing().padsBehind, pads.length, 'an unserved pad is a pad behind, rival or no rival');
assert.ok(/Ahead by \$[\d,]+ · Homeport needs 3 more deliveries · 3 more pads behind/.test(R.campaign.progressText()),
	'ahead on cash reads as the pads still to serve');
R.market.state.pads.forEach(function(entry) {
	entry.playerServed = settings.dominantMinPerPad;
});
R.market.state.pads[3].competitorServed = settings.dominantMinPerPad + 2;
assert.equal(R.campaign.standing().dominant, false, 'a pad the rival serves more often is still behind');
R.market.state.pads[3].playerServed = settings.dominantMinPerPad + 2;
assert.equal(R.campaign.standing().dominant, true);
// The rival may answer the leg; it cannot catch a $1M lead on one flight.
game.cash += 1000000;
report = deliver(game, otherPad());
assert.equal(report.milestones[0].milestone.id, 'dominant');
assert.ok(report.milestones[0].settlement.cashLead > 0, 'the settlement records the lead');
assert.equal(report.milestones[0].settlement.reputation, R.operations.state.playerStats.reputation);
assert.equal(report.milestones[0].arcComplete, false, 'one world is not the whole arc');
assert.equal(activeId(), null, 'the ladder is complete');
assert.deepEqual(R.campaign.settlement('verdant'), report.milestones[0].settlement);
assert.equal(R.campaign.nextWorld().id, 'tinmoon', 'the settlement card points at the next open world');
report = deliver(game, otherPad());
assert.equal(report.milestones.length, 0, 'free play goes on without awards');

// ----------------------------------------------------------- the world switch

var carriedReputation = R.operations.state.playerStats.reputation;
var verdantCompleted = R.campaign.completedCount('verdant');

assert.ok(carriedReputation > settings.carryReputationCap, 'the company leaves Verdant well regarded');
game = startRun('tinmoon');
assert.equal(R.operations.state.playerStats.reputation, settings.carryReputationCap, 'reputation carries, clamped');
assert.equal(R.competitor.state.reputation, settings.carryReputationCap, 'the rival gets the same carry');
assert.equal(R.competitor.state.skill.toFixed(6), (R.constants.competitor.initialSkill +
	(settings.carryReputationCap - settings.startReputation) * settings.rivalSkillPerCarriedReputation).toFixed(6),
'and opens a little more skilled: it has heard of you');
assert.equal(R.competitor.state.noticed, false, 'notice is taken world by world');
assert.equal(game.cash, R.constants.economy.startingCash, 'cash does not transfer');
assert.equal(R.operations.state.fleet.length, 1, 'the fleet is the new world\'s reference rocket');
assert.equal(R.operations.state.routes.length, 0, 'routes start empty');
assert.equal(activeId(), 'first-receipt', 'the new world starts at the bottom of its own ladder');
assert.equal(R.campaign.profileUnlocked('gentle'), true, 'unlocks travel');
assert.equal(R.campaign.completedCount('verdant'), verdantCompleted, 'and so does what was cleared');
assert.ok(R.campaign.settlement('verdant'), 'the dominant-courier state persists across the switch');

// The same record seeds the same rival, every time.
var firstSkill = R.competitor.state.skill;

startRun('tinmoon');
assert.equal(R.competitor.state.skill, firstSkill, 'the carry is deterministic');

// A battered reputation is not carried below the default.
R.campaign.record.reputation = 20;
startRun('tinmoon');
assert.equal(R.operations.state.playerStats.reputation, settings.startReputation, 'a new world never starts below the default');
assert.equal(R.competitor.state.skill, R.constants.competitor.initialSkill);

// Going back to a world resumes its ladder where it stood and pays nothing twice.
game = startRun('verdant');
assert.equal(activeId(), null, 'a settled world stays settled');
report = deliver(game, pads[1]);
assert.equal(report.milestones.length, 0, 'and its grants are not paid a second time');
assert.equal(R.competitor.state.noticed, true, 'the notice a cleared milestone gave stands on a revisit');

// ------------------------------------------------------- other kinds of measure

// Net cash: measured above the opening balance, never below zero.
newCampaign();
game = resumeAt('tinmoon', 'in-the-black');
assert.equal(activeId(), 'in-the-black');
game.cash = R.constants.economy.startingCash - 3000;
assert.equal(R.campaign.progress(), 0, 'a loss is zero progress, not negative');
assert.equal(R.campaign.progressText(), '$0 / $5,000 above opening cash');
game.cash = R.constants.economy.startingCash + 6000;
report = deliver(game, R.world.pads[1]);
assert.equal(report.milestones[0].milestone.id, 'in-the-black');

// Fragile cargo: only fragile contracts that arrive count, from activation.
newCampaign();
game = resumeAt('cinder', 'fragile');
assert.equal(activeId(), 'fragile');
deliverContract(game, otherPad(), false);
assert.equal(R.campaign.progress(), 0, 'an ordinary contract is not fragile cargo');
deliverContract(game, otherPad(), true);
assert.equal(R.campaign.progress(), 1);
var hardPad = otherPad();

assert.equal(send(hardPad, { contractId: contractTo(hardPad, true).id }).ok, true);
report = land(game, hardPad, -(R.world.planet.landingVerticalSpeed - 1));
assert.equal(report.cargoLost, true, 'a hard arrival loses fragile cargo');
assert.equal(R.campaign.progress(), 1, 'and lost cargo does not count');
assert.equal(R.campaign.state.cleanLegs, 0, 'it also breaks the clean run');
report = deliverContract(game, otherPad(), true);
assert.equal(report.milestones[0].milestone.id, 'fragile');

// Totals that are already met clear together on one delivered leg.
newCampaign();
game = resumeAt('verdant', 'haulier');
R.campaign.state.cargoKg = 5000;
R.campaign.state.cleanLegs = 10;
R.operations.state.playerStats.reputation = 90;
report = deliver(game, R.world.pads[1]);
assert.deepEqual(report.milestones.map(function(award) {
	return award.milestone.id;
}), ['haulier', 'reliable'], 'two met totals clear in order on one leg');
assert.equal(activeId(), 'long-reach', 'and the ladder stops at the first task');

// ------------------------------------------------------------ the whole arc

newCampaign();
R.planets.list.forEach(function(planet) {
	R.campaign.record.settlements[planet.id] = { cashLead: 1, deliveries: 1, deliveryLead: 0, reputation: 60, legs: 1 };
});
delete R.campaign.record.settlements.gossamer;
assert.equal(R.campaign.arcComplete(), false, 'three worlds are not the arc');
R.campaign.record.unlocks['world:gossamer'] = true;
game = resumeAt('gossamer', 'dominant');
R.market.state.pads.forEach(function(entry) {
	entry.playerServed = settings.dominantMinPerPad;
});
game.cash += 1000000;
report = deliver(game, R.world.pads[1]);
assert.equal(report.milestones[0].milestone.id, 'dominant');
assert.equal(report.milestones[0].arcComplete, true, 'the last world settled completes the arc');
assert.equal(R.campaign.arcComplete(), true);
assert.equal(R.campaign.nextWorld(), null, 'with no world left to point at');

// --------------------------------------------------------------- persistence

// The page restores the record from storage before its first run and saves on
// every settled leg; a reload is a restore.
var stored = {};

global.localStorage = {
	getItem: function(key) {
		return Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : null;
	},
	setItem: function(key, value) {
		stored[key] = String(value);
	}
};
R.campaign.restore();
assert.equal(R.campaign.completedCount('verdant'), 0, 'empty storage restores a fresh campaign');
game = startRun('verdant');
deliver(game, R.world.pads[1]);
assert.ok(stored[settings.storageKey], 'a settled leg saves the record');
var savedRecord = JSON.parse(stored[settings.storageKey]);

R.campaign.record = null;
R.campaign.restore();
assert.deepEqual(R.campaign.record, savedRecord, 'a reload restores exactly what was saved');
startRun('verdant');
assert.equal(activeId(), 'on-the-board', 'and the ladder resumes where it stood');
R.campaign.reset();
assert.equal(JSON.parse(stored[settings.storageKey]).completed['verdant:first-receipt'], undefined,
	'a new campaign overwrites the save');
stored[settings.storageKey] = '{not json';
R.campaign.restore();
assert.equal(R.campaign.completedCount('verdant'), 0, 'an unreadable save starts a fresh campaign');
delete global.localStorage;

// ------------------------------------------------------------- recorded runs

// The reference player on the game's own seeds: both logs reproduce byte for
// byte, so the ladder is deterministic and a change that moves it shows here.
function sweep(args) {
	return childProcess.execFileSync(process.execPath, [path.join(__dirname, 'campaign-sweep.js')].concat(args),
		{ encoding: 'utf8' });
}

function recorded(name) {
	return fs.readFileSync(path.join(__dirname, 'logs', name), 'utf8');
}

var verdantRun = sweep(['40', 'verdant']);
var campaignRun = sweep(['60', 'campaign']);

assert.equal(sweep(['40', 'verdant']), verdantRun, 'the same run twice advances the ladder identically');
assert.equal(verdantRun, recorded('0.6.1-milestones.txt'), 'the Verdant run matches its recorded log');
assert.equal(campaignRun, recorded('0.6.2-campaign.txt'), 'the four-world run matches its recorded log');
assert.ok(/6 Dominant courier +leg \d+/.test(verdantRun), 'the reference player settles Verdant');
assert.ok(campaignRun.indexOf('arc complete: dominant courier on every world') >= 0,
	'and wins all four worlds in order');

console.log('Campaign, milestone and unlock tests passed.');
