'use strict';

var assert = require('node:assert/strict');
var R = require('../js/namespaces.js');

require('../js/util.js');
require('../js/constants.js');
require('../js/planets.js');
require('../js/coords.js');
require('../js/camera.js');
require('../js/world.js');
require('../js/rocket.js');
require('../js/economy.js');
require('../js/mission.js');
require('../js/aerodynamics.js');
require('../js/physics.js');
require('../js/trajectory.js');
require('../js/autopilot.js');
require('../js/controls.js');
require('../js/input.js');

R.world.initialize('verdant');

var home = R.world.pads[0];
var target = R.world.pads[1];
var defaultConfig = {
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

function createGame(targetPadId) {
	return {
		currentPadId: home.id,
		targetPadId: targetPadId || defaultConfig.targetPadId,
		rocket: R.rocket.create(home),
		phase: 'building',
		cash: R.economy.startingCash,
		ledger: [],
		flight: null,
		lastReport: null,
		simTime: 0,
		physicsAccumulator: 0,
		timeScaleIndex: R.constants.time.defaultIndex,
		timeScale: 1
	};
}

function launch(config) {
	var game = createGame(config.targetPadId);

	assert.equal(R.mission.launch(game, config), true);
	return game;
}

R.rocket.evaluateBuild(defaultConfig, stats);
assert.ok(stats.twr > R.constants.rocket.minimumLaunchTwr, 'default rocket has enough lift');
assert.equal(stats.totalMass, stats.dryMass + stats.fuelMass + defaultConfig.payloadMass);
assert.ok(stats.deltaV > 3000 && stats.deltaV < 4000, 'staged rocket-equation estimate is plausible');
assert.ok(R.economy.estimateBuildCost(stats) < R.economy.startingCash, 'default build is affordable');
R.world.initialize('cinder');
var cinderStats = R.rocket.createStats();
R.rocket.evaluateBuild(defaultConfig, cinderStats);
assert.equal(cinderStats.deltaV, stats.deltaV, 'rocket equation does not depend on local gravity');
assert.ok(cinderStats.twr < stats.twr, 'the same build lifts less on a heavier world');
R.world.initialize('verdant');

var rejectedGame = createGame();
var weakConfig = {
	targetPadId: target.id,
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
weakConfig.payloadMass = 80;
weakConfig.targetPadId = home.id;
assert.equal(R.mission.launch(rejectedGame, weakConfig), false, 'cannot launch to the current pad');
weakConfig.targetPadId = target.id;
rejectedGame.cash = 1;
assert.equal(R.mission.launch(rejectedGame, weakConfig), false, 'unaffordable rocket cannot launch');

assert.equal(R.physics.gravityAtAltitude(0), R.world.planet.surfaceGravity);
assert.ok(R.physics.gravityAtAltitude(10000) < R.physics.gravityAtAltitude(0));
assert.ok(R.physics.densityAtAltitude(1000) < R.physics.densityAtAltitude(0));

// Isp is quoted against standard gravity, so the same stage burns the same
// fuel mass per second on every world.
R.world.initialize('tinmoon');
var tinmoonBurn = { currentStage: 0, stageCount: 1, stages: [{ fuelMass: 100, thrustMax: 7200, ispSea: 265, ispVac: 330, alive: true, dryMass: 100 }], throttle: 1, heading: 0, wx: 0, wy: 500, vx: 0, vy: 0, payloadMass: 0 };
var tinmoonGame = { phase: 'flying', rocket: tinmoonBurn, flight: { elapsed: 0, currentDynamicPressure: 0, currentAngleOfAttack: 0, peakDynamicPressure: 0, peakDynamicPressureAltitude: 0, peakDynamicPressureAngleOfAttack: 0, peakAngleOfAttack: 0, peakAngleOfAttackDynamicPressure: 0, peakThrustAcceleration: 0, peakAppliedThrustAcceleration: 0 }, cash: 0, ledger: [] };
R.physics.step(tinmoonGame, 1);
assert.ok(Math.abs(tinmoonGame.flight.peakAppliedThrustAcceleration - 7200 / 200) < 1e-9, 'the flight record measures the thrust acceleration actually applied');
assert.ok(Math.abs(100 - tinmoonBurn.stages[0].fuelMass - 7200 / (330 * R.constants.rocket.standardGravity)) < 1e-6, 'airless worlds burn on vacuum Isp and standard gravity');
R.world.initialize('verdant');

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

// Time scale buys simulated time; the integration step never changes.
var scaledGame = launch(defaultConfig);
var plainGame = launch(defaultConfig);
scaledGame.timeScale = 4;
for (frame = 0; frame < 20; frame += 1) {
	R.physics.advance(scaledGame, 1 / 60);
}
for (frame = 0; frame < 80; frame += 1) {
	R.physics.advance(plainGame, 1 / 60);
}
assert.ok(Math.abs(scaledGame.rocket.wy - plainGame.rocket.wy) < 1e-6, '4x over 20 frames equals 1x over 80 frames');
assert.equal(scaledGame.rocket.stages[0].fuelMass, plainGame.rocket.stages[0].fuelMass, 'time scale does not change fuel flow');
assert.ok(scaledGame.physicsAccumulator < R.constants.rocket.fixedStep, 'accumulator drains at every time scale');

var game = launch(defaultConfig);
var launchCash = game.cash;
var startingFuel = game.rocket.stages[0].fuelMass;
R.physics.advance(game, 1 / 30);
assert.equal(game.phase, 'flying');
assert.ok(game.rocket.wy > 0, 'default rocket lifts off');
assert.ok(game.rocket.stages[0].fuelMass < startingFuel, 'fuel is consumed during powered flight');
assert.ok(game.cash < launchCash, 'fuel consumption reduces cash');
assert.ok(game.flight.peakThrustAcceleration > 0, 'flight record measures peak thrust acceleration');
assert.ok(game.flight.peakAppliedThrustAcceleration > 0 && game.flight.peakAppliedThrustAcceleration <= game.flight.peakThrustAcceleration, 'applied thrust acceleration never exceeds what the stage can give');
assert.equal(game.flight.autopilotProfile, R.autopilot.profileId, 'the flight records the autopilot profile it launched with');
assert.ok(Number.isFinite(game.flight.currentDynamicPressure), 'flight telemetry records current Q');
assert.ok(Number.isFinite(game.flight.currentAngleOfAttack), 'flight telemetry records current AoA');
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

var ignitionRocket = launch(defaultConfig).rocket;
R.rocket.separateStage(ignitionRocket, 0.4);
assert.equal(ignitionRocket.throttle, 0.4, 'the autopilot can light the next stage at the throttle it holds');
ignitionRocket.stages[2].alive = false;
R.rocket.separateStage(ignitionRocket, 0.4);
assert.equal(ignitionRocket.throttle, 0, 'with no stage left there is nothing to light');

var burnGame = launch(defaultConfig);
burnGame.rocket.wy = 1000;
burnGame.rocket.stages[0].fuelMass = 0.001;
R.physics.step(burnGame, R.constants.rocket.fixedStep);
assert.equal(burnGame.rocket.stages[0].fuelMass, 0, 'fuel is clamped at zero');
assert.ok(burnGame.flight.fuelUsed <= 0.001, 'fuel accounting does not exceed remaining fuel');

var dragGame = launch(defaultConfig);
dragGame.rocket.wy = 1000;
dragGame.rocket.vx = 400;
dragGame.rocket.throttle = 0;
R.physics.step(dragGame, R.constants.rocket.fixedStep);
assert.ok(dragGame.flight.currentDynamicPressure > 0, 'current Q is measured in flight');
assert.ok(dragGame.flight.peakDynamicPressure >= dragGame.flight.currentDynamicPressure, 'peak Q tracks current Q');
assert.ok(dragGame.flight.peakAngleOfAttack > 0, 'atmospheric peak AoA is recorded');
assert.ok(Number.isFinite(dragGame.flight.peakAngleOfAttackDynamicPressure), 'pressure at peak AoA is available for interpreting the measurement');
assert.ok(dragGame.rocket.vx < 400, 'atmospheric drag opposes horizontal velocity');
assert.ok(dragGame.rocket.vy < 0, 'gravity accelerates the rocket downward');

dragGame.rocket.wx = R.world.planet.circumference - 2;
dragGame.rocket.vx = 400;
dragGame.rocket.vy = 0;
R.physics.step(dragGame, R.constants.rocket.fixedStep);
assert.ok(dragGame.rocket.wx > R.world.planet.circumference, 'flight longitude stays unbounded at the wrap seam');
assert.equal(R.mission.findLandingPad({ wx: R.world.planet.circumference + 100 }).id, home.id);

var inputListeners = {};
global.addEventListener = function(type, listener) {
	inputListeners[type] = listener;
};
R.camera.resize(1200, 800);
var controlGame = launch(defaultConfig);
R.game = controlGame;
R.autopilot.setEnabled(false);
R.camera.follow(controlGame.rocket.wx);
R.input.pointerActive = true;
R.input.pointerX = 500;
R.input.pointerY = R.camera.groundY;
R.controls.initialize();
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
inputListeners.keydown({ code: 'BracketRight', key: ']', target: { tagName: 'BODY' } });
assert.ok(controlGame.timeScale > 1, 'bracket keys raise the time scale');
inputListeners.keydown({ code: 'KeyA', target: { tagName: 'BODY' } });
assert.equal(R.autopilot.enabled, true, 'A toggles the autopilot in flight');
inputListeners.keydown({ code: 'KeyA', target: { tagName: 'BODY' } });
assert.equal(R.autopilot.enabled, false, 'A toggles the autopilot back off');
R.controls.setTimeScaleIndex(R.constants.time.defaultIndex);
R.controls.reset();
assert.equal(controlGame.timeScale, R.constants.time.scales[R.constants.time.defaultIndex]);

var collisionGame = launch(defaultConfig);
var collisionTarget = R.world.pads[1];
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
deliveredGame.rocket.wx = target.wx + 100;
deliveredGame.rocket.wy = 0;
deliveredGame.rocket.vx = 10;
deliveredGame.rocket.vy = -5;
deliveredGame.flight.peakDynamicPressure = 12345;
deliveredGame.flight.peakDynamicPressureAltitude = 678;
deliveredGame.flight.peakDynamicPressureAngleOfAttack = 0.25;
deliveredGame.flight.peakAngleOfAttack = 0.5;
deliveredGame.flight.peakAngleOfAttackDynamicPressure = 4321;
deliveredGame.flight.peakThrustAcceleration = 12.3;
deliveredGame.flight.peakAppliedThrustAcceleration = 11.1;
var startingBalance = deliveredGame.cash;
var report = R.mission.touchdown(deliveredGame);
assert.equal(report.status, 'delivered');
assert.equal(report.peakDynamicPressure, 12345);
assert.equal(report.peakDynamicPressureAltitude, 678);
assert.equal(report.peakDynamicPressureAngleOfAttack, 0.25);
assert.equal(report.peakAngleOfAttack, 0.5);
assert.equal(report.peakAngleOfAttackDynamicPressure, 4321);
assert.equal(report.peakThrustAcceleration, 12.3);
assert.equal(report.peakAppliedThrustAcceleration, 11.1);
assert.match(report.detail, /peak thrust acceleration 11.1 m\/s²/, 'the debrief reports the thrust the rocket actually felt');
assert.match(report.detail, /Peak Q 12.3 kPa at 678 m/);
assert.equal(report.touchdownVerticalSpeed, -5, 'the debrief quotes the measured sink rate, not a prediction');
assert.equal(report.touchdownHorizontalSpeed, 10, 'and the measured horizontal speed');
assert.equal(report.targetError, 100, 'and the touchdown error against the target pad');
assert.match(report.detail, /Touchdown 5\.0 m\/s down and 10\.0 m\/s across, 100 m from Eastport centre\./,
	'the debrief reports where and how hard it arrived');
assert.equal(deliveredGame.currentPadId, target.id);
assert.ok(deliveredGame.cash > startingBalance, 'target delivery pays a reward');
assert.equal(deliveredGame.phase, 'building');
assert.equal(deliveredGame.rocket.padId, target.id);
assert.equal(deliveredGame.ledger[deliveredGame.ledger.length - 1].type, 'delivery');

// An autopilot delivery keeps a tenth of the reward as its fee.
var autopilotGame = launch(defaultConfig);
R.autopilot.setEnabled(true);
autopilotGame.flight.usedAutopilot = true;
autopilotGame.rocket.wx = target.wx;
autopilotGame.rocket.vy = -3;
startingBalance = autopilotGame.cash;
report = R.mission.touchdown(autopilotGame);
assert.equal(report.status, 'delivered');
assert.ok(Math.abs(autopilotGame.cash - (startingBalance + 80 * R.economy.priceDelivery() * 0.9)) < 1e-6, 'autopilot fee is deducted');
assert.match(report.detail, /Autopilot fee \$\d+ \(Balanced profile\)\./, 'the debrief names the profile that flew');
R.autopilot.setEnabled(false);

var elsewhereGame = launch(defaultConfig);
var farPad = R.world.pads[2];
elsewhereGame.rocket.wx = farPad.wx;
elsewhereGame.rocket.wy = 0;
elsewhereGame.rocket.vx = 0;
elsewhereGame.rocket.vy = 0;
report = R.mission.touchdown(elsewhereGame);
assert.equal(report.status, 'landed');
assert.equal(report.targetError, farPad.wx - target.wx, 'a safe landing elsewhere quotes its error from the target');
assert.match(report.detail, /5\.0 km east of Eastport/, 'the error is signed along the wrap map');
assert.equal(elsewhereGame.currentPadId, farPad.id);
assert.equal(elsewhereGame.cash, R.economy.startingCash - stats.dryMass * R.economy.priceSteel());

var crashGame = launch(defaultConfig);
crashGame.rocket.wx = target.wx - 1200;
crashGame.rocket.wy = 0;
crashGame.rocket.vx = 0;
crashGame.rocket.vy = -40;
report = R.mission.touchdown(crashGame);
assert.equal(report.status, 'crashed');
assert.match(report.detail, /Touchdown 40\.0 m\/s down and 0\.0 m\/s across, 1\.2 km west of Eastport\./,
	'a crash is reported with the arrival speeds and the side of the pad it fell short on');
assert.equal(crashGame.currentPadId, home.id);
assert.equal(crashGame.cash, R.economy.startingCash - stats.dryMass * R.economy.priceSteel());

// Landing tolerances scale with the planet, not with the rescaled map.
R.world.initialize('tinmoon');
assert.equal(R.world.planet.landingRadius, 180);
assert.equal(R.mission.findLandingPad({ wx: 220 }), null, 'tinmoon pad tolerance is tighter than verdant');
R.world.initialize('verdant');
assert.equal(R.mission.findLandingPad({ wx: 220 }).id, home.id);
delete global.addEventListener;

console.log('Flight physics and mission tests passed.');
