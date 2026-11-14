'use strict';

// Test mode: the deck's switch rates a build many times stronger than the
// catalog does. What is rated is what an engine delivers — thrust, delta-v, and
// the ceilings that would otherwise clamp or wreck the flight — and not what it
// is made of, so masses, costs and fuel flow are the built ones.

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
require('../js/sky.js');
require('../js/trajectory.js');
require('../js/autopilot.js');
require('../js/operations.js');
require('../js/controls.js');
require('../js/input.js');

R.damage.enabled = false;
R.world.initialize('verdant');

var home = R.world.pads[0];
var target = R.world.pads[1];
var factor = R.constants.rocket.testMultiplier;
var config = {
	targetPadId: target.id,
	stageCount: 3,
	payloadMass: R.constants.rocket.defaultPayloadMass,
	stages: [
		{ fuelMass: R.constants.rocket.defaultStageFuel[0], strength: 0.85 },
		{ fuelMass: R.constants.rocket.defaultStageFuel[1], strength: 0.9 },
		{ fuelMass: R.constants.rocket.defaultStageFuel[2], strength: 0.9 }
	]
};
var stats = R.rocket.createStats();
var activeType = null;

function setupRun() {
	var game = {
		currentPadId: home.id,
		targetPadId: config.targetPadId,
		rocket: R.rocket.create(home),
		phase: 'deck',
		cash: R.economy.startingCash,
		ledger: [],
		flight: null,
		mission: null,
		lastReport: null,
		selection: { sourcePadId: home.id, targetPadId: config.targetPadId, mode: 'oneway', visible: true },
		simTime: 0,
		physicsAccumulator: 0,
		timeScaleIndex: R.constants.time.defaultIndex,
		timeScale: 1
	};

	R.game = game;
	R.operations.initialize();
	R.operations.state.types.length = 0;
	R.operations.state.fleet.length = 0;
	activeType = R.operations.addType({
		name: 'test type',
		stageCount: config.stageCount,
		stages: config.stages,
		nominalPayload: config.payloadMass,
		defaultProfileId: R.autopilot.profileId
	});
	R.operations.createRocket(activeType, home);
	return game;
}

function launch() {
	var game = setupRun();

	assert.equal(R.operations.dispatch({
		source: home.id,
		destination: config.targetPadId,
		mode: 'oneway',
		fuelPolicy: 'refuel',
		outboundPayload: config.payloadMass,
		returnPayload: 0,
		typeId: activeType.id,
		profileId: R.autopilot.profileId
	}).ok, true, 'the build launches');
	return game;
}

// One full-throttle step from the same place in both modes.
function stepOnce(testMode) {
	var dt = R.constants.rocket.fixedStep;
	var game;
	var stage;
	var fuel;

	R.parts.testMode = testMode;
	game = launch();
	game.rocket.wy = 1000;
	game.rocket.vx = 0;
	game.rocket.vy = 0;
	game.rocket.heading = 0;
	game.rocket.throttle = 1;
	stage = game.rocket.stages[0];
	fuel = stage.fuelMass;
	// The step reports a ground crossing, so false here means it is still flying.
	assert.equal(R.physics.step(game, dt), false, 'the step flies');
	return {
		burn: fuel - stage.fuelMass,
		acceleration: game.rocket.vy / dt,
		thrust: stage.thrustMax,
		deltaV: R.rocket.remainingDeltaV(game.rocket)
	};
}

// ---------------------------------------------------------------------------

assert.ok(factor > 1, 'test mode is a multiplier, not a switch that does nothing');
R.parts.testMode = false;
assert.equal(R.parts.performanceFactor(), 1, 'the game ships with test mode off');

R.rocket.evaluateBuild(config, stats);
var plain = {
	thrust: stats.thrustMax,
	deltaV: stats.deltaV,
	twr: stats.twr,
	totalMass: stats.totalMass,
	dryMass: stats.dryMass,
	payloadLimit: stats.payloadLimit
};
var plainStep = stepOnce(false);

R.parts.testMode = true;
assert.equal(R.parts.performanceFactor(), factor, 'the switch reads the multiplier');
R.rocket.evaluateBuild(config, stats);
assert.equal(stats.thrustMax, plain.thrust * factor, 'the build is rated up');
assert.ok(Math.abs(stats.deltaV - plain.deltaV * factor) < 1e-6 * plain.deltaV, 'and so is its delta-v');
assert.equal(stats.twr, plain.twr * factor, 'so it lifts whatever it is pointed at');
assert.equal(stats.totalMass, plain.totalMass, 'a rated engine is not a lighter one');
assert.equal(stats.dryMass, plain.dryMass, 'and its structure does not change');
// The gate is the payload cap in both modes here, so it can only open as far as
// the cap allows; what matters is that it never closes on a rated build.
assert.ok(stats.payloadLimit >= plain.payloadLimit, 'the launch gate opens with the thrust');
assert.equal(stats.payloadLimit, R.constants.rocket.maxPayloadMass, 'and opens all the way');

var testStep = stepOnce(true);
assert.equal(testStep.thrust, plainStep.thrust * factor, 'the flying stack carries the rating');
assert.ok(Math.abs(testStep.deltaV - plainStep.deltaV * factor) < 1e-6 * testStep.deltaV,
	'the autopilot reads the same rated delta-v');
assert.ok(Math.abs(testStep.burn - plainStep.burn) < 1e-9 * Math.max(1, plainStep.burn),
	'the extra push is free: a rated engine burns fuel at the built rate');
assert.ok(testStep.acceleration > R.constants.rocket.maxAcceleration,
	'the structural ceiling lifts with the thrust instead of clamping it away');
assert.ok(testStep.acceleration > plainStep.acceleration * factor * 0.9,
	'and the flight actually feels the rating');

// The switch can be thrown mid-flight: the stack in the air is re-rated from its
// own parts, and the health this flight has taken off an engine survives it.
var game = launch();
var stage = game.rocket.stages[0];
var rated = stage.thrustMax;
var builtDryMass = stage.dryMass;

stage.engineHealth = 0.5;
stage.thrustMax = stage.thrustNominal * stage.engineHealth;
R.rocket.rerate(game.rocket);
assert.equal(stage.thrustMax, stage.thrustNominal * 0.5, 'a re-rate keeps the damage the flight has done');

R.parts.testMode = false;
R.rocket.rerate(game.rocket);
assert.equal(stage.thrustNominal, rated / factor, 'rating back down rebuilds the catalog thrust');
assert.equal(stage.thrustMax, rated / factor * 0.5, 'and keeps the health on top of it');
assert.equal(stage.dryMass, builtDryMass, 'and its mass, which is what it is built from');
R.rocket.rerate(game.rocket);
R.parts.testMode = true;
R.rocket.rerate(game.rocket);
assert.equal(stage.thrustNominal, rated, 'and rating up again returns the same stack');

// A dead stage stays dead whatever the switch says.
stage.alive = false;
stage.thrustMax = 0;
R.rocket.rerate(game.rocket);
assert.equal(stage.thrustMax, 0, 'a separated stage is not re-rated back to life');

R.parts.testMode = false;
console.log('Test mode suite passed.');
