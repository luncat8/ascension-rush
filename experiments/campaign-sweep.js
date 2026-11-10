'use strict';

// Campaign sweep: a reference player flies the milestone ladder through the
// real dispatch, autopilot, physics, damage, market and rival turn, on the
// seeds the game itself uses, so the output is what a careful player meets.
//
//   node experiments/campaign-sweep.js [legs] [world]      one world, `legs` legs
//   node experiments/campaign-sweep.js [legs] campaign     every world in order, each
//                                                          until it is settled or `legs` run out
//
// The reference player keeps the granted reference rocket, flies one-way legs
// from wherever it stands, and each leg takes the most profitable cargo on
// offer — a board contract or a standing service at the destination's
// appetite. A paying cargo that moves the active milestone goes first; failing
// that, a paying leg to a pad whose board holds such a contract, the way a
// player reads the Market tab before choosing where to fly. Fragile cargo
// flies Gentle once that is unlocked. A lost rocket is rebuilt at the home pad.

var harness = require('./harness.js');
var R = harness.R;
require('../js/competitor.js');
require('../js/campaign.js');

var legLimit = Number(process.argv[2] || 40);
var mode = process.argv[3] || 'verdant';
var frameDt = 1 / 60;
var summaries = [];

R.damage.enabled = true;

function pad(text, width) {
	return String(text).padEnd(width);
}

function padLeft(text, width) {
	return String(text).padStart(width);
}

function money(value) {
	return '$' + Math.round(value);
}

function startWorld(planetId) {
	var game;

	R.world.initialize(planetId);
	game = harness.createGame(R.world.pads[0], R.world.pads[1].id, R.constants.time.scales[R.constants.time.defaultIndex]);
	R.game = game;
	R.operations.initialize();
	return game;
}

// The frame loop's order at the default time scale: one control update, then
// that frame's physics budget.
function fly(game) {
	var simDt = frameDt * game.timeScale;

	while (game.phase === 'flying' && game.flight.elapsed < harness.maxSeconds) {
		game.simTime += simDt;
		R.controls.update(game, simDt);
		R.physics.advance(game, frameDt);
	}
	if (game.phase === 'flying') {
		R.mission.timeout(game);
	}
}

function standingPayload(type, toPadId) {
	var capacity = Math.floor(R.operations.typeStats(type).payloadLimit / 10) * 10;

	return Math.min(capacity, R.market.demand(toPadId));
}

// Whether delivering this cargo moves the active milestone.
var advances = {
	contracts: function(option) {
		return !!option.contract;
	},
	contractTo: function(option, milestone) {
		return !!option.contract && R.world.findPadById(option.toPadId).name === milestone.padName;
	},
	fragile: function(option) {
		return !!option.contract && option.contract.fragile;
	},
	dominant: function(option) {
		var rival = R.competitor.state;

		return R.market.servedBy(option.toPadId, 'player') <
			Math.max(R.constants.campaign.dominantMinPerPad, R.market.servedBy(option.toPadId, rival.id));
	}
};

// Only a contract milestone is worth repositioning for: the board at the
// destination must hold a contract that moves it and outlasts the flight there.
var contractKinds = { contracts: true, contractTo: true, fragile: true };

function boardAdvances(padId, milestone) {
	var contracts = R.market.contractsAt(padId);
	var i;

	if (!contractKinds[milestone.kind]) {
		return false;
	}
	for (i = 0; i < contracts.length; i += 1) {
		if (contracts[i].status === 'open' && contracts[i].turnsLeft > 1 &&
			advances[milestone.kind]({ toPadId: contracts[i].toPadId, contract: contracts[i] }, milestone)) {
			return true;
		}
	}
	return false;
}

// 2: the cargo moves the milestone; 1: the leg ends at a board that can; 0: neither.
function milestoneRank(option, milestone) {
	if (!milestone || !advances[milestone.kind] || option.profit <= 0) {
		return 0;
	}
	if (advances[milestone.kind](option, milestone)) {
		return 2;
	}
	return boardAdvances(option.toPadId, milestone) ? 1 : 0;
}

function consider(best, option, type, rocket, milestone) {
	var evaluation = R.operations.evaluateLeg(type.id, rocket.padId, option.payloadMass, true, rocket.id, true, option.toPadId);
	var quote;

	if (!evaluation.ready) {
		return best;
	}
	quote = R.market.quote(rocket.padId, option.toPadId, option.payloadMass, option.contract ? option.contract.id : null);
	option.profit = quote.reward * (1 - R.autopilot.feeFraction) - evaluation.cost;
	option.rank = milestoneRank(option, milestone);
	if (!best || option.rank > best.rank || (option.rank === best.rank && option.profit > best.profit)) {
		return option;
	}
	return best;
}

function chooseCargo(type, rocket) {
	var milestone = R.campaign.activeMilestone();
	var contracts = R.market.contractsAt(rocket.padId);
	var pads = R.world.pads;
	var best = null;
	var i;

	for (i = 0; i < contracts.length; i += 1) {
		if (contracts[i].status !== 'open') {
			continue;
		}
		best = consider(best, { toPadId: contracts[i].toPadId, payloadMass: contracts[i].payloadMass,
			contract: contracts[i], profit: 0, rank: 0 }, type, rocket, milestone);
	}
	for (i = 0; i < pads.length; i += 1) {
		if (pads[i].id === rocket.padId) {
			continue;
		}
		best = consider(best, { toPadId: pads[i].id, payloadMass: standingPayload(type, pads[i].id),
			contract: null, profit: 0, rank: 0 }, type, rocket, milestone);
	}
	return best;
}

function availableRocket(type) {
	var fleet = R.operations.state.fleet;
	var built;
	var i;

	for (i = 0; i < fleet.length; i += 1) {
		if (fleet[i].status === 'available') {
			return fleet[i];
		}
	}
	built = R.operations.buildRocket(type.id, R.world.pads[0].id);
	return built.ok ? R.operations.findRocket(built.rocketId) : null;
}

function cargoKind(option) {
	if (!option.contract) {
		return 'standing';
	}
	return option.contract.fragile ? 'fragile' : 'contract';
}

function awardText(awards) {
	return awards.map(function(award) {
		return award.number + ' ' + award.milestone.title + ' (' + award.rewardText + ')';
	}).join(' + ');
}

function flyWorld(planetId, stopWhenSettled) {
	var game = startWorld(planetId);
	var type = R.operations.state.types[0];
	var planet = R.world.planet;
	var rival = R.competitor.state;
	var reached = [];
	var stopped = '';
	var legs = 0;
	var rocket;
	var option;
	var order;
	var report;
	var cashBefore;
	var profile;
	var i;

	console.log('=== ' + planet.name + ' · reference player · up to ' + legLimit + ' legs · market seed ' +
		R.market.state.seed + ' · arrives REP ' + R.operations.state.playerStats.reputation +
		' · ' + rival.name + ' REP ' + rival.reputation + ' skill ' + rival.skill.toFixed(3) + ' ===');
	console.log(' leg  route                     cargo            profile   result        cash Δ     cash    rival  REP  milestone');
	while (legs < legLimit) {
		rocket = availableRocket(type);
		if (!rocket) {
			stopped = 'cannot afford a new rocket';
			break;
		}
		option = chooseCargo(type, rocket);
		if (!option) {
			stopped = 'no leg can be flown from ' + R.world.findPadById(rocket.padId).name;
			break;
		}
		profile = option.contract && option.contract.fragile && R.campaign.profileUnlocked('gentle') ? 'gentle' : 'balanced';
		cashBefore = game.cash;
		order = R.operations.dispatch({
			source: rocket.padId,
			destination: option.toPadId,
			mode: 'oneway',
			fuelPolicy: 'refuel',
			outboundPayload: option.payloadMass,
			returnPayload: 0,
			typeId: type.id,
			rocketId: rocket.id,
			profileId: profile,
			overhaul: true,
			contractId: option.contract ? option.contract.id : null
		});
		if (!order.ok) {
			stopped = 'dispatch refused: ' + order.reason;
			break;
		}
		fly(game);
		legs += 1;
		report = game.lastReport;
		for (i = 0; i < report.milestones.length; i += 1) {
			reached.push({ number: report.milestones[i].number, title: report.milestones[i].milestone.title, leg: legs });
		}
		console.log(padLeft(legs, 4) + '  ' +
			pad(R.world.findPadById(order.mission.source).name + ' → ' + R.world.findPadById(option.toPadId).name, 25) + ' ' +
			pad(padLeft(option.payloadMass, 3) + ' kg ' + cargoKind(option), 16) + ' ' + pad(profile, 9) + ' ' +
			pad(report.status, 10) + ' ' + padLeft(money(game.cash - cashBefore), 9) + ' ' + padLeft(money(game.cash), 8) + ' ' +
			padLeft(money(rival.cash), 8) + ' ' + padLeft(R.operations.state.playerStats.reputation, 4) + '  ' +
			awardText(report.milestones));
		if (stopWhenSettled && R.campaign.settlement(planetId)) {
			break;
		}
	}
	console.log('');
	console.log(planet.name + ' ladder after ' + legs + ' legs' + (stopped ? ' (stopped: ' + stopped + ')' : '') + ':');
	for (i = 0; i < R.campaign.state.ladder.length; i += 1) {
		console.log('  ' + (i + 1) + ' ' + pad(R.campaign.state.ladder[i].title, 20) + ' ' +
			(reached[i] ? 'leg ' + reached[i].leg :
				(i === R.campaign.state.activeIndex ? 'active · ' + R.campaign.progressText() : 'not reached')));
	}
	console.log('  player ' + money(game.cash) + ' · ' + R.operations.state.playerStats.deliveries + ' deliveries · REP ' +
		R.operations.state.playerStats.reputation + ' | ' + rival.name + ' ' + money(rival.cash) + ' · ' + rival.deliveries +
		' deliveries · REP ' + rival.reputation + ' · skill ' + rival.skill.toFixed(3) + ' · failed ' + rival.failedFlights);
	for (i = 0; i < R.world.pads.length; i += 1) {
		console.log('  ' + pad(R.world.pads[i].name, 12) + ' player ' + R.market.servedBy(R.world.pads[i].id, 'player') +
			' · rival ' + R.market.servedBy(R.world.pads[i].id, rival.id));
	}
	console.log('');
	summaries.push({ planetId: planetId, name: planet.name, legs: legs, reached: reached.length,
		settled: !!R.campaign.settlement(planetId) });
}

function flyCampaign() {
	var list = R.planets.list;
	var i;

	for (i = 0; i < list.length; i += 1) {
		if (!R.campaign.worldUnlocked(list[i].id)) {
			console.log('=== ' + list[i].name + ' is locked: ' + R.campaign.unlockSource('world:' + list[i].id) + ' not cleared ===\n');
			continue;
		}
		flyWorld(list[i].id, true);
	}
	console.log('=== campaign tally ===');
	for (i = 0; i < summaries.length; i += 1) {
		console.log(pad(summaries[i].name, 10) + ' ' + summaries[i].reached + ' / ' +
			R.campaign.ladderOf(summaries[i].planetId).length + ' milestones in ' + padLeft(summaries[i].legs, 3) + ' legs · ' +
			(summaries[i].settled ? 'DOMINANT COURIER' : 'not settled'));
	}
	console.log('arc ' + (R.campaign.arcComplete() ? 'complete: dominant courier on every world' : 'not complete') +
		' · carried REP ' + R.campaign.record.reputation);
}

R.campaign.reset();
if (mode === 'campaign') {
	flyCampaign();
} else {
	flyWorld(mode, false);
}
