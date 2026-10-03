'use strict';

var assert = require('node:assert/strict');
var R = require('../js/namespaces.js');

require('../js/util.js');
require('../js/constants.js');
require('../js/coords.js');
require('../js/camera.js');
require('../js/world.js');
require('../js/rocket.js');
require('../js/economy.js');
require('../js/mission.js');
require('../js/physics.js');
require('../js/controls.js');
require('../js/input.js');

var defaultConfig = {
	targetPadId: 'eastport',
	stageCount: 3,
	payloadMass: 120,
	stages: [
		{ fuelMass: 1800, strength: 0.85 },
		{ fuelMass: 900, strength: 0.9 },
		{ fuelMass: 1000, strength: 0.9 }
	]
};
var stats = R.rocket.createStats();

function createGame(targetPadId) {
	var home = R.world.findPadById('homeport');
	return {
		currentPadId: home.id,
		targetPadId: targetPadId || defaultConfig.targetPadId,
		rocket: R.rocket.create(home),
		phase: 'building',
		cash: R.economy.startingCash,
		ledger: [],
		flight: null,
		lastReport: null,
		physicsAccumulator: 0
	};
}

function launch(config) {
	var game = createGame(config.targetPadId);
	assert.equal(R.mission.launch(game, config), true);
	return game;
}

R.world.initialize();
R.rocket.evaluateBuild(defaultConfig, stats);
assert.ok(stats.twr > R.constants.rocket.minimumLaunchTwr, 'default rocket has enough lift');
assert.equal(stats.totalMass, stats.dryMass + stats.fuelMass + defaultConfig.payloadMass);
assert.ok(stats.deltaV > 3000 && stats.deltaV < 4000, 'staged rocket-equation estimate is plausible');
assert.ok(R.economy.estimateBuildCost(stats) < R.economy.startingCash, 'default build is affordable');

var rejectedGame = createGame('eastport');
var weakConfig = {
	targetPadId: 'eastport',
	stageCount: 1,
	payloadMass: 2000,
	stages: [
		{ fuelMass: 300, strength: 0.9 },
		{ fuelMass: 900, strength: 0.9 },
		{ fuelMass: 1000, strength: 0.9 }
	]
};
assert.equal(R.mission.launch(rejectedGame, weakConfig), false, 'underpowered rocket cannot launch');
assert.equal(rejectedGame.cash, R.economy.startingCash);
weakConfig.stageCount = 3;
weakConfig.payloadMass = 120;
weakConfig.targetPadId = 'homeport';
assert.equal(R.mission.launch(rejectedGame, weakConfig), false, 'cannot launch to the current pad');
weakConfig.targetPadId = 'eastport';
rejectedGame.cash = 1;
assert.equal(R.mission.launch(rejectedGame, weakConfig), false, 'unaffordable rocket cannot launch');

assert.equal(R.physics.gravityAtAltitude(0), R.constants.world.surfaceGravity);
assert.ok(R.physics.gravityAtAltitude(100000) < R.physics.gravityAtAltitude(0));
assert.ok(R.physics.densityAtAltitude(10000) < R.physics.densityAtAltitude(0));

var thirtyFpsGame = launch(defaultConfig);
var sixtyFpsGame = launch(defaultConfig);
var frame;
for (frame = 0; frame < 30; frame += 1) {
	R.physics.advance(thirtyFpsGame, 1 / 30);
}
for (frame = 0; frame < 60; frame += 1) {
	R.physics.advance(sixtyFpsGame, 1 / 60);
}
assert.ok(Math.abs(thirtyFpsGame.rocket.wy - sixtyFpsGame.rocket.wy) < 1e-6, 'fixed-step altitude is frame-rate independent');
assert.ok(Math.abs(thirtyFpsGame.rocket.vy - sixtyFpsGame.rocket.vy) < 1e-6, 'fixed-step velocity is frame-rate independent');

var game = launch(defaultConfig);
var launchCash = game.cash;
var startingFuel = game.rocket.stages[0].fuelMass;
R.physics.advance(game, 1 / 30);
assert.equal(game.phase, 'flying');
assert.ok(game.rocket.wy > 0, 'default rocket lifts off');
assert.ok(game.rocket.stages[0].fuelMass < startingFuel, 'fuel is consumed during powered flight');
assert.ok(game.cash < launchCash, 'fuel consumption reduces cash');
assert.equal(game.ledger[0].type, 'structure');

var stageDryMass = game.rocket.stages[0].dryMass;
game.rocket.stages[0].fuelMass = 0;
var emptyStackMass = R.rocket.totalMass(game.rocket);
assert.equal(R.rocket.separateStage(game.rocket), true);
assert.equal(game.rocket.currentStage, 1);
assert.equal(game.rocket.throttle, 1, 'next stage ignites on separation');
assert.ok(Math.abs(R.rocket.totalMass(game.rocket) - (emptyStackMass - stageDryMass)) < 1e-8);
assert.equal(R.rocket.separateStage(game.rocket), true);
assert.equal(game.rocket.currentStage, 2);
assert.equal(R.rocket.separateStage(game.rocket), true);
assert.equal(game.rocket.currentStage, 3);
assert.equal(R.rocket.separateStage(game.rocket), false, 'cannot stage beyond the configured stack');

var burnGame = launch(defaultConfig);
burnGame.rocket.wy = 1000;
burnGame.rocket.stages[0].fuelMass = 0.001;
R.physics.step(burnGame, R.constants.rocket.fixedStep);
assert.equal(burnGame.rocket.stages[0].fuelMass, 0, 'fuel is clamped at zero');
assert.ok(burnGame.flight.fuelUsed <= 0.001, 'fuel accounting does not exceed remaining fuel');

var dragGame = launch(defaultConfig);
dragGame.rocket.wy = 2000;
dragGame.rocket.vx = 1000;
dragGame.rocket.throttle = 0;
R.physics.step(dragGame, R.constants.rocket.fixedStep);
assert.ok(dragGame.rocket.vx < 1000, 'atmospheric drag opposes horizontal velocity');
assert.ok(dragGame.rocket.vy < 0, 'gravity accelerates the rocket downward');

dragGame.rocket.wx = R.constants.world.circumference - 2;
dragGame.rocket.vx = 1000;
dragGame.rocket.vy = 0;
R.physics.step(dragGame, R.constants.rocket.fixedStep);
assert.ok(dragGame.rocket.wx > R.constants.world.circumference, 'flight longitude stays unbounded at the wrap seam');
assert.equal(R.mission.findLandingPad({ wx: R.constants.world.circumference + 1000 }), R.world.findPadById('homeport'));

var inputListeners = {};
global.addEventListener = function(type, listener) {
	inputListeners[type] = listener;
};
R.camera.resize(1200, 800);
var controlGame = launch(defaultConfig);
R.camera.follow(controlGame.rocket.wx);
R.input.pointerActive = true;
R.input.pointerX = 500;
R.input.pointerY = R.camera.groundY;
R.controls.initialize(controlGame);
controlGame.rocket.throttle = 0.2;
R.controls.update(controlGame, 0.1);
assert.ok(controlGame.rocket.heading > 0, 'mouse aim turns the thrust vector');
inputListeners.keydown({ code: 'ShiftLeft', key: 'Shift', target: { tagName: 'BODY' } });
R.controls.update(controlGame, 0.2);
assert.ok(Math.abs(controlGame.rocket.throttle - 0.56) < 1e-8, 'Shift raises throttle continuously');
inputListeners.keyup({ code: 'ShiftLeft', key: 'Shift' });
inputListeners.keydown({ code: 'ControlLeft', key: 'Control', target: { tagName: 'BODY' } });
R.controls.update(controlGame, 0.2);
assert.ok(Math.abs(controlGame.rocket.throttle - 0.2) < 1e-8, 'Ctrl lowers throttle continuously');
inputListeners.keyup({ code: 'ControlLeft', key: 'Control' });
inputListeners.keydown({ code: 'Space', repeat: false, target: { tagName: 'BODY' }, preventDefault: function() {} });
assert.equal(controlGame.rocket.currentStage, 1, 'Space separates the active stage');
R.controls.reset();

var collisionGame = launch(defaultConfig);
var collisionTarget = R.world.findPadById(defaultConfig.targetPadId);
collisionGame.rocket.wx = collisionTarget.wx;
collisionGame.rocket.wy = 1;
collisionGame.rocket.vx = 0;
collisionGame.rocket.vy = -200;
collisionGame.rocket.throttle = 0;
assert.equal(R.physics.step(collisionGame, R.constants.rocket.fixedStep), true, 'ground crossing resolves in the physics step');
assert.equal(collisionGame.lastReport.status, 'crashed', 'unsafe touchdown is adjudicated once');
var collisionReport = collisionGame.lastReport;
assert.equal(R.physics.step(collisionGame, R.constants.rocket.fixedStep), false);
assert.equal(collisionGame.lastReport, collisionReport);

var deliveredGame = launch(defaultConfig);
var targetPad = R.world.findPadById(defaultConfig.targetPadId);
deliveredGame.rocket.wx = targetPad.wx + 5000;
deliveredGame.rocket.wy = 0;
deliveredGame.rocket.vx = 10;
deliveredGame.rocket.vy = -5;
var startingBalance = deliveredGame.cash;
var report = R.mission.touchdown(deliveredGame);
assert.equal(report.status, 'delivered');
assert.equal(deliveredGame.currentPadId, targetPad.id);
assert.ok(deliveredGame.cash > startingBalance, 'target delivery pays a reward');
assert.equal(deliveredGame.phase, 'building');
assert.equal(deliveredGame.rocket.padId, targetPad.id);
assert.equal(deliveredGame.ledger[deliveredGame.ledger.length - 1].type, 'delivery');

var elsewhereGame = launch(defaultConfig);
var farPad = R.world.findPadById('farport');
elsewhereGame.rocket.wx = farPad.wx;
elsewhereGame.rocket.wy = 0;
elsewhereGame.rocket.vx = 0;
elsewhereGame.rocket.vy = 0;
report = R.mission.touchdown(elsewhereGame);
assert.equal(report.status, 'landed');
assert.equal(elsewhereGame.currentPadId, farPad.id);
assert.equal(elsewhereGame.cash, R.economy.startingCash - stats.dryMass * R.economy.priceSteelPerKg);

var crashGame = launch(defaultConfig);
crashGame.rocket.wx = 125000;
crashGame.rocket.wy = 0;
crashGame.rocket.vx = 0;
crashGame.rocket.vy = -40;
report = R.mission.touchdown(crashGame);
assert.equal(report.status, 'crashed');
assert.equal(crashGame.currentPadId, 'homeport');
assert.equal(crashGame.cash, R.economy.startingCash - stats.dryMass * R.economy.priceSteelPerKg);

console.log('Flight physics and mission tests passed.');
