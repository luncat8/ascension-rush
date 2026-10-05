'use strict';

// Damage and failures (0.5.1): the loads a flight puts on a stack leave
// stress, stress is what fails a part, and a failure is what the player sees,
// pays for and reads in the log. Every assertion here is either a property of
// the model or a leg flown through the real dispatch; the rates themselves are
// tuned on experiments/logs/0.5.1-failures.txt.

var assert = require('node:assert/strict');
var harness = require('./harness.js');
var R = harness.R;
var settings = R.constants;
var flags = R.damage.flags;

// The harness flies the 0.4 model; this suite is the one place damage is on.
R.damage.enabled = true;

var frameDt = 1 / 120;

function freshStage(strength, fuelMass) {
	return {
		fuelMass: fuelMass === undefined ? 400 : fuelMass,
		fuelMax: 400,
		dryMass: 100,
		thrustMax: 7200,
		thrustNominal: 7200,
		ispSea: 265,
		ispVac: 330,
		strength: strength === undefined ? 1 : strength,
		engineId: settings.parts.defaultEngineId,
		tankId: settings.parts.defaultTankId,
		engineBurnTimeUsed: 0,
		lifeFlights: 0,
		stress: 0,
		engineHealth: 1,
		leakRate: 0,
		engineOut: false,
		alive: true
	};
}

// The smallest thing damage.step flies: one stage, no market, no report.
function stepGame(stage) {
	return {
		phase: 'flying',
		rocket: {
			stageCount: 1,
			stages: [stage],
			currentStage: 0,
			throttle: 1,
			fairingAttached: false,
			fairingLost: false,
			fragileCargo: false
		}
	};
}

// Steps until the time is up, something fails, or the flight ends.
function stepFor(game, seconds, accel, pressure) {
	var dt = 1 / 120;
	var steps = Math.round(seconds / dt);
	var i;

	for (i = 0; i < steps; i += 1) {
		if (R.damage.step(game, dt, accel || 0, pressure || 0) || R.damage.active) {
			return true;
		}
	}
	return false;
}

function buildOf(strength, stageCount) {
	var planet = R.world.planet;
	var count = stageCount || planet.defaultFuel.length;

	return {
		stageCount: count,
		payloadMass: planet.defaultPayload,
		stages: planet.defaultFuel.slice(0, count).map(function(fuel) {
			return { fuelMass: fuel, strength: strength, engineId: null, tankId: null, fairingId: null };
		})
	};
}

// A leg through the real scheduler, ready to fly but not flown.
function launch(build, seed) {
	var planet = R.world.planet;
	var source = R.world.pads[0];
	var target = R.world.pads[1];
	var game = harness.createGame(source, target.id, 1, settings.economy.startingCash);
	var type;
	var order;

	R.game = game;
	R.operations.initialize();
	R.market.initialize(seed || 1);
	R.operations.state.types.length = 0;
	R.operations.state.fleet.length = 0;
	type = R.operations.addType({
		name: 'damage',
		stageCount: build.stageCount,
		stages: build.stages,
		nominalPayload: build.payloadMass,
		defaultProfileId: 'balanced'
	});
	R.operations.createRocket(type, source);
	planet.defaultPayload = build.payloadMass;
	order = R.operations.dispatch({
		source: source.id,
		destination: target.id,
		mode: 'oneway',
		fuelPolicy: 'refuel',
		outboundPayload: build.payloadMass,
		returnPayload: 0,
		typeId: type.id,
		profileId: 'balanced',
		overhaul: true
	});
	assert.equal(order.ok, true, 'the test leg is dispatched');
	return { game: game, type: type, seeding: seed || 1 };
}

// ------------------------------------------------------------- the rate model

R.world.initialize('verdant');
var healthy = freshStage(1);
assert.equal(R.damage.failureRate(healthy), 0, 'a fresh stage with a fresh engine cannot fail');

healthy.stress = 0.3;
var rateAt30 = R.damage.failureRate(healthy);
healthy.stress = 0.6;
assert.ok(Math.abs(R.damage.failureRate(healthy) - 4 * rateAt30) < 1e-12,
	'the failure rate rises with the square of the stress a stage carries');
healthy.stress = 0;
healthy.engineBurnTimeUsed = settings.damage.wearStart * 900 - 1;
assert.equal(R.damage.failureRate(healthy), 0, 'an engine inside its useful burn time adds no risk');
healthy.engineBurnTimeUsed = 900;
assert.ok(R.damage.failureRate(healthy) > 0, 'and one at the end of it does');
healthy.stress = settings.damage.ruptureStress;
assert.ok(R.damage.failureRate(healthy) <= settings.damage.maxFailureRate,
	'the rate is capped, however bad the stage is');

// Sampling is `1 - exp(-rate * dt)`, so the odds of a failure do not depend on
// the step the physics happens to be running.
function failuresIn(step, stress, trials) {
	var game;
	var count = 0;
	var trial;
	var elapsed;

	for (trial = 0; trial < trials; trial += 1) {
		R.damage.reset(trial + 1);
		game = stepGame(freshStage(1, 400));
		game.rocket.stages[0].stress = stress;
		for (elapsed = 0; elapsed < 30; elapsed += step) {
			if (R.damage.step(game, step, 0, 0)) {
				break;
			}
			if (game.rocket.stages[0].engineHealth <= 0 || game.rocket.stages[0].leakRate > 0 ||
				game.rocket.stages[0].stress >= settings.damage.ruptureStress) {
				count += 1;
				break;
			}
			if (R.damage.active) {
				count += 1;
				break;
			}
		}
	}
	return count / trials;
}

var coarse = failuresIn(1 / 60, 0.6, 600);
var fine = failuresIn(1 / 240, 0.6, 600);
assert.ok(coarse > 0.05 && fine > 0.05, 'a badly damaged stage does fail within a flight');
assert.ok(Math.abs(coarse - fine) < 0.35 * Math.max(coarse, fine),
	'a coarser step does not change the odds: 60 fps ' + (100 * coarse).toFixed(1) +
	' % against 240 fps ' + (100 * fine).toFixed(1) + ' %');

// ------------------------------------------------------- stress from the loads

R.damage.reset(1);
var gentleStage = freshStage(1);
stepFor(stepGame(gentleStage), 20, 5, 0);
var fatigue = gentleStage.stress;
assert.ok(fatigue > 0, 'a load inside the rating still costs a little fatigue');

R.damage.reset(1);
var hardStage = freshStage(1);
var limit = R.world.planet.flight.maxThrustAcceleration * settings.damage.structureMargin;
// Kept short of the rupture limit on purpose: a rupture ends the flight, and
// this assertion is about the stress a load leaves behind.
stepFor(stepGame(hardStage), 10, limit * 1.5, 0);
assert.ok(hardStage.stress > 10 * fatigue,
	'and a load past the rating is what actually damages a stage: ' +
	hardStage.stress.toFixed(3) + ' against ' + fatigue.toFixed(4));

R.damage.reset(1);
var strongStage = freshStage(1);
R.damage.reset(1);
var skimpyStage = freshStage(0.5);
stepFor(stepGame(strongStage), 5, limit, 0);
stepFor(stepGame(skimpyStage), 5, limit, 0);
assert.ok(skimpyStage.stress > strongStage.stress,
	'the same flight damages a lightly built stage more than a heavy one');

// ------------------------------------------------------------ what a failure does

var seen = {};
var seed;
var game;
var stage;

for (seed = 1; seed < 400 && Object.keys(seen).length < 4; seed += 1) {
	R.damage.reset(seed);
	game = stepGame(freshStage(1, 400));
	game.rocket.fairingAttached = true;
	game.rocket.fairingMass = 40;
	game.rocket.stages[0].dryMass = 140;
	game.rocket.stages[0].stress = 0.6;
	stepFor(game, 40, 0, 0);
	if (!R.damage.active) {
		continue;
	}
	stage = game.rocket.stages[0];
	if (R.damage.active & flags.DEGRADED) {
		seen.DEGRADED = true;
		assert.equal(stage.engineHealth, settings.damage.enginePartialHealth, 'a degraded engine keeps part of its health');
		assert.equal(stage.thrustMax, stage.thrustNominal * settings.damage.enginePartialHealth,
			'and half its thrust — the failure is written into the stage, not subtracted per step');
		assert.ok(stage.ispSea < 265, 'and it burns a little dirtier');
	}
	if (R.damage.active & flags.ENGINE_OUT) {
		seen.ENGINE_OUT = true;
		assert.equal(stage.thrustMax, 0, 'a dead engine makes no thrust');
		assert.equal(stage.engineOut, true, 'and the stage says so, because a new one has to be bought');
	}
	if (R.damage.active & flags.LEAK) {
		seen.LEAK = true;
		assert.ok(stage.leakRate > 0, 'a leaking tank starts losing propellant');
	}
	if (R.damage.active & flags.FAIRING) {
		seen.FAIRING = true;
		assert.equal(game.rocket.fairingAttached, false, 'a fairing that failed is gone');
		assert.equal(game.rocket.fairingLost, true, 'and the cargo is exposed from then on');
		assert.ok(stage.dryMass < 140, 'with its mass off the stack');
	}
	assert.ok(R.damage.alarmTime > 0, 'a failure raises an alarm the HUD can show');
	assert.ok(R.damage.alarmLabel().length > 0, 'named, not just flagged');
}
Object.keys(seen).forEach(function(mode) {
	assert.ok(seen[mode], mode + ' was observed and its effect checked');
});
assert.equal(Object.keys(seen).length, 4, 'every failure mode is reachable on a damaged stack');

// A leak accelerates: the tank it is in loses more of its load every second.
R.damage.reset(1);
game = stepGame(freshStage(1, 400));
game.rocket.stages[0].leakRate = settings.damage.leakRate;
stepFor(game, 1, 0, 0);
var leakedFirst = 400 - game.rocket.stages[0].fuelMass;
assert.ok(leakedFirst > 0, 'a leak drains the tank it is in');
stepFor(game, 1, 0, 0);
assert.ok(400 - game.rocket.stages[0].fuelMass > 2 * leakedFirst, 'and it drains faster as it goes');

// Separating a stage shakes the stack.
R.damage.reset(1);
game = stepGame(freshStage(1, 400));
R.damage.separation(game.rocket);
assert.ok(game.rocket.stages[0].stress > 0, 'staging costs the stack a little');

// ------------------------------------------------------------ rupture in flight

R.world.initialize('verdant');
var flight = launch(buildOf(0.85), 1);
game = flight.game;
game.rocket.stages[0].stress = settings.damage.ruptureStress;
R.damage.reset(7);
R.physics.step(game, 1 / 120);
assert.equal(game.phase, 'deck', 'a tank past its rupture limit ends the flight where it is');
var ruptureEntry = R.flightLog.entries[0];
assert.equal(ruptureEntry.status, 'crashed', 'a rupture is a loss');
assert.equal(ruptureEntry.cause, 'rupture', 'and the log says what caused it');
assert.equal(ruptureEntry.landingPadId, null, 'nothing landed');
assert.equal(ruptureEntry.cargoLost, true, 'the cargo went with it');
assert.ok(ruptureEntry.failures & flags.RUPTURE, 'and it is recorded as a failure');
assert.equal(R.operations.state.fleet[0].status, 'lost', 'the fleet instance is gone');
assert.ok(game.lastReport.title.indexOf('RUPTURE') >= 0, 'the debrief names it');

// ------------------------------------------------------------------- touchdown

// The 0.3.3 reference band is the zero point of the landing scale.
R.world.initialize('verdant');
flight = launch(buildOf(0.85), 1);
game = flight.game;
R.damage.reset(3);
var soft = R.damage.landing(game.rocket, -3.5, 0.5, R.world.planet, false);
assert.equal(soft.stress, 0, 'an autopilot touchdown costs the stack nothing');
assert.equal(soft.payloadDamage, 0, 'and the cargo nothing either');

var hard = R.damage.landing(game.rocket, -10, 4, R.world.planet, false);
var hardStress = hard.stress;
var hardPayload = hard.payloadDamage;
assert.ok(hardStress > 0, 'a hard arrival leaves its mark');
assert.ok(hardPayload > 0, 'and damages the cargo');
// The landing record is shared, so the numbers are read before it is reused.
assert.ok(R.damage.landing(game.rocket, -10, 4, R.world.planet, true).payloadDamage > hardPayload,
	'fragile cargo takes more of the same arrival');

// Fly it: a soft landing pays in full, a hard one pays for what arrived.
function landAt(vy, vx, fragile) {
	var run = launch(buildOf(0.85), 1);
	var target = R.world.findPadById(run.game.targetPadId);
	var before;

	run.game.rocket.wx = target.wx;
	run.game.rocket.wy = 0.01;
	run.game.rocket.vy = vy;
	run.game.rocket.vx = vx;
	run.game.flight.fragileSpeed = fragile ? R.world.planet.landingVerticalSpeed * 0.5 : 0;
	run.game.rocket.fragileCargo = fragile;
	R.damage.reset(5);
	before = run.game.flight.rewardQuote;
	R.mission.touchdown(run.game);
	return { entry: R.flightLog.entries[0], quote: before, game: run.game };
}

var softLanding = landAt(-3.5, 0.5, false);
assert.equal(softLanding.entry.status, 'delivered', 'a soft arrival on the pad delivers');
assert.equal(softLanding.entry.payloadDamage, 0, 'with the whole cargo');
assert.equal(softLanding.entry.revenue, softLanding.quote, 'and the payout it was quoted');
assert.equal(softLanding.entry.repairCost, 0, 'the leg was launched with the damage put right');

var hardLanding = landAt(-10, 4, false);
assert.equal(hardLanding.entry.status, 'delivered', 'a hard arrival still delivers what survived');
assert.ok(hardLanding.entry.payloadDamage > 0, 'but part of the cargo did not survive');
assert.ok(hardLanding.entry.revenue < hardLanding.quote, 'and the payout is for what arrived, not what was loaded');
assert.ok(hardLanding.game.lastReport.detail.indexOf('% of the cargo arrived') > 0,
	'the debrief says how much arrived');
var fleet = R.operations.state.fleet[0];
assert.ok(fleet.stageState[0].stress > 0, 'the stage that came down hard carries the damage');
assert.ok(R.parts.repairValue(flight.type, fleet.stageState, true) > 0, 'and the next dispatch pays to put it right');

var lostLanding = landAt(-10, 4, true);
assert.equal(lostLanding.entry.cargoLost, true, 'fragile cargo above its own limit is lost');
assert.equal(lostLanding.entry.status, 'landed', 'and the leg is a safe landing with nothing to deliver');
assert.equal(lostLanding.entry.revenue, 0, 'so nothing is paid');

// ---------------------------------------------------- the autopilot answers it

R.world.initialize('verdant');
flight = launch(buildOf(0.85, 3), 1);
game = flight.game;
R.autopilot.setEnabled(true);
R.autopilot.reset();
R.autopilot.setProfile('balanced');
R.autopilot.update(game);
assert.equal(R.autopilot.command.stage, false, 'a healthy stack is not staging');
game.rocket.stages[game.rocket.currentStage].thrustMax = 0;
game.rocket.stages[game.rocket.currentStage].engineHealth = 0;
R.autopilot.update(game);
assert.equal(R.autopilot.command.stage, true, 'an engine that died is answered by staging');

// With nothing left to light, the autopilot has no answer: it aborts.
game.rocket.stages[2].alive = false;
game.rocket.stages[1].alive = false;
R.autopilot.update(game);
assert.equal(R.autopilot.phase, 'ABORT', 'a dead engine with no stage behind it is an abort');
assert.equal(R.autopilot.command.throttle, 0, 'and the engine is shut down');

// ----------------------------------------------------------- the same roll twice

function flownFailure(seed) {
	var run = launch(buildOf(0.5), seed);

	R.damage.reset(seed);
	harness.fly(run.game, frameDt);
	return {
		status: R.flightLog.entries[0].status,
		failures: R.flightLog.entries[0].failures,
		stress: R.flightLog.entries[0].payloadDamage
	};
}

R.world.initialize('verdant');
var first = flownFailure(4242);
var second = flownFailure(4242);
assert.equal(first.failures, second.failures, 'the same seed rolls the same failures');
assert.equal(first.status, second.status, 'and the same outcome');
assert.equal(first.stress, second.stress, 'and the same damage to the cargo');

// ------------------------------------------------------------ damage switched off

R.damage.enabled = false;
var clean = launch(buildOf(0.5), 9);
R.damage.reset(9);
harness.fly(clean.game, frameDt);
var cleanEntry = R.flightLog.entries[0];
assert.equal(cleanEntry.failures, 0, 'with damage off nothing fails');
assert.equal(cleanEntry.payloadDamage, 0, 'and nothing is damaged');
assert.equal(cleanEntry.repairCost, 0, 'and there is no repair bill');
R.damage.enabled = true;

console.log('Damage and failure tests passed.');
