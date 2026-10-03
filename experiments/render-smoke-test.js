'use strict';

var assert = require('node:assert/strict');
var renderCalls = 0;
var drawnText = [];
var frameCallback = null;
var tileContext = {
	fillRect: function() {
		renderCalls += 1;
	}
};
var context = {};
var canvas;
var contextMethods = [
	'clearRect', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'quadraticCurveTo',
	'closePath', 'fill', 'stroke', 'arc', 'fillText', 'save', 'translate',
	'rotate', 'restore'
];
var i;

for (i = 0; i < contextMethods.length; i += 1) {
	context[contextMethods[i]] = function() {
		renderCalls += 1;
	};
}
context.fillText = function(text) {
	drawnText.push(String(text));
	renderCalls += 1;
};
context.setTransform = function() {
	renderCalls += 1;
};
context.createPattern = function() {
	return {};
};
context.createLinearGradient = function() {
	return {
		addColorStop: function() {
			renderCalls += 1;
		}
	};
};
canvas = {
	width: 300,
	height: 150,
	getContext: function() {
		return context;
	},
	getBoundingClientRect: function() {
		return { left: 0, top: 0, width: 1280, height: 720 };
	},
	addEventListener: function() {}
};

global.innerWidth = 1280;
global.innerHeight = 720;
global.devicePixelRatio = 2;
global.addEventListener = function() {};
global.requestAnimationFrame = function(callback) {
	frameCallback = callback;
};
global.document = {
	getElementById: function(id) {
		return id === 'c' ? canvas : null;
	},
	createElement: function() {
		return {
			width: 0,
			height: 0,
			getContext: function() {
				return tileContext;
			}
		};
	}
};

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
require('../js/builder.js');
require('../js/controls.js');
require('../js/input.js');
require('../js/render.js');
require('../js/menu.js');

R.world.initialize();
R.camera.resize(1280, 720);
R.camera.follow(0);
R.render.initialize(context);
R.render.resize(1280, 720);
R.render.draw({
	currentPadId: R.world.currentPadId,
	targetPadId: R.world.targetPadId,
	rocket: R.rocket.create(R.world.findPadById(R.world.currentPadId))
});

R.input.pointerActive = true;
R.input.pointerX = 620;
R.input.pointerY = 340;
R.input.worldPoint.x = 12600;
R.input.worldPoint.y = 900;
R.input.debugText = 'E 12600 m  ·  ALT 900 m';
R.render.draw({
	currentPadId: R.world.currentPadId,
	targetPadId: R.world.targetPadId,
	rocket: R.rocket.create(R.world.findPadById(R.world.currentPadId))
});

var flightRocket = R.rocket.create(R.world.findPadById(R.world.currentPadId));
R.rocket.applyBuild(flightRocket, {
	targetPadId: R.world.targetPadId,
	stageCount: 2,
	payloadMass: 100,
	stages: [
		{ fuelMass: 1000, strength: 0.9 },
		{ fuelMass: 500, strength: 0.9 },
		{ fuelMass: 300, strength: 0.9 }
	]
});
flightRocket.wy = 1400;
flightRocket.vx = 240;
flightRocket.vy = 60;
flightRocket.throttle = 0.75;
R.camera.follow(flightRocket.wx);
R.render.draw({
	currentPadId: R.world.currentPadId,
	targetPadId: R.world.targetPadId,
	phase: 'flying',
	flight: { cashDelta: -600, currentDynamicPressure: 24000, currentAngleOfAttack: 0.4, peakDynamicPressure: 28000 },
	cash: 29400,
	timeScaleIndex: R.constants.time.defaultIndex,
	timeScale: R.constants.time.scales[R.constants.time.defaultIndex],
	rocket: flightRocket
});

// The limiter row is shown in manual flight too, as OFF; with the autopilot on it names the active limits.
assert.ok(drawnText.indexOf('LIMITER') >= 0, 'flight HUD draws the limiter row');
assert.ok(drawnText.indexOf('Q + ACCEL LIMIT') < 0, 'no limiter is named while flying by hand');
assert.ok(drawnText.indexOf('COAST IMPACT') >= 0, 'flight HUD forecasts the coast impact while flying by hand');
assert.ok(drawnText.indexOf('COAST TOUCHDOWN') >= 0, 'and the speeds that coast would arrive with');
assert.ok(drawnText.indexOf('OUT OF HORIZON') >= 0, 'with no forecast yet the row says so instead of showing a stale point');

// The coast forecast is a property of the state, not of the autopilot, so the
// marker and its numbers belong to a hand-flown rocket too.
var coastGame = {
	currentPadId: R.world.currentPadId,
	targetPadId: R.world.targetPadId,
	phase: 'flying',
	flight: { cashDelta: -600, currentDynamicPressure: 24000, currentAngleOfAttack: 0.4, peakDynamicPressure: 28000 },
	cash: 29400,
	timeScaleIndex: R.constants.time.defaultIndex,
	timeScale: R.constants.time.scales[R.constants.time.defaultIndex],
	rocket: flightRocket
};
var coastError = Math.abs(R.trajectory.update(coastGame).targetError);

assert.ok(R.trajectory.impact.valid, 'the cruising state has a coast impact');
R.camera.follow(flightRocket.wx);
drawnText.length = 0;
R.render.draw(coastGame);
assert.equal(drawnText.indexOf('OUT OF HORIZON'), -1, 'an in-range forecast replaces the horizon notice');
assert.ok(drawnText.indexOf('COAST') >= 0, 'the coast marker is labelled on the ground');
assert.ok(drawnText.indexOf(Math.abs(R.trajectory.impact.vy).toFixed(1)) >= 0, 'the HUD quotes the predicted sink rate');
assert.ok(drawnText.indexOf(Math.abs(R.trajectory.impact.vx).toFixed(1)) >= 0, 'and the predicted horizontal speed');
assert.ok(drawnText.indexOf(coastError >= 1000 ? (coastError / 1000).toFixed(1) : String(Math.round(coastError))) >= 0,
	'and how far the coast impact is from the selected pad');

R.trajectory.impact.valid = false;
drawnText.length = 0;
R.render.draw(coastGame);
assert.ok(drawnText.indexOf('OUT OF HORIZON') >= 0, 'an invalid forecast is announced');
assert.equal(drawnText.indexOf('COAST'), -1, 'and no marker is drawn for it');
R.trajectory.update(coastGame);

// The map shows one whole circumference, so the marker comes from the
// viewport's periodic copy of the impact longitude: a coast that wraps the world
// stays on screen, and at the seam it is drawn on both edges like the pads are.
var viewportLeft = flightRocket.wx - R.world.planet.circumference / 3;

function coastLabels() {
	return drawnText.filter(function(text) {
		return text === 'COAST';
	}).length;
}

R.trajectory.impact.wx = viewportLeft + R.world.planet.circumference + 3000;
drawnText.length = 0;
R.render.draw(coastGame);
assert.equal(coastLabels(), 1, 'a coast a whole world east is the same ground, drawn once inside the viewport');

R.trajectory.impact.wx = viewportLeft + 5;
drawnText.length = 0;
R.render.draw(coastGame);
assert.equal(coastLabels(), 2, 'a coast at the viewport seam is drawn on both edges');
R.trajectory.update(coastGame);

var autopilotFlight = {
	currentPadId: R.world.pads[0].id,
	targetPadId: R.world.pads[1].id,
	phase: 'flying',
	flight: { cashDelta: -600, currentDynamicPressure: 24000, currentAngleOfAttack: 0.4, peakDynamicPressure: 28000, autopilotProfile: 'gentle' },
	cash: 29400,
	timeScaleIndex: R.constants.time.defaultIndex,
	timeScale: R.constants.time.scales[R.constants.time.defaultIndex],
	rocket: flightRocket
};

R.autopilot.setEnabled(true);
R.autopilot.limiter = R.autopilot.limitFlags.Q | R.autopilot.limitFlags.ACCEL;
R.render.draw(autopilotFlight);
assert.ok(drawnText.indexOf('Q + ACCEL LIMIT') >= 0, 'flight HUD names the active limiters');
assert.ok(drawnText.indexOf('Gentle') >= 0, 'flight HUD names the profile the flight launched with');
R.autopilot.limiter = 0;
drawnText.length = 0;
R.render.draw(autopilotFlight);
assert.ok(drawnText.indexOf('—') >= 0, 'flight HUD shows a dash when nothing is limiting');
assert.equal(drawnText.indexOf('Q + ACCEL LIMIT'), -1, 'and no limiter name');
assert.equal(drawnText.indexOf('EARLY'), -1, 'and no staging marker on an ordinary frame');
R.autopilot.stagedEarly = true;
R.render.draw(autopilotFlight);
assert.ok(drawnText.indexOf('EARLY') >= 0, 'the HUD marks the frame an authority separation is commanded');
R.autopilot.stagedEarly = false;
R.autopilot.setEnabled(false);

var main = require('../js/main.js');
main.start();

assert.ok(renderCalls > 100, 'renderer executed expected drawing operations');
assert.ok(drawnText.indexOf('ANGLE OF ATTACK') >= 0, 'flight HUD draws AoA telemetry');
assert.ok(drawnText.indexOf('PEAK Q') >= 0, 'flight HUD draws peak-Q telemetry');
assert.equal(canvas.width, 2560, 'canvas backing store uses device pixel ratio');
assert.equal(canvas.height, 1440, 'canvas backing store uses device pixel ratio');
assert.equal(typeof frameCallback, 'function', 'main schedules the animation frame');

// Drive the real frame loop: launch through the mission, then measure how much
// simulated time a fixed number of frames buys at two time scales.
var game = R.game;
var pads = R.world.pads;
var referenceBuild = {
	targetPadId: pads[1].id,
	stageCount: 3,
	payloadMass: R.world.planet.defaultPayload,
	stages: R.world.planet.defaultFuel.map(function(fuel, index) {
		return { fuelMass: fuel, strength: R.constants.rocket.defaultStageStrength[index] };
	})
};
var frames = 0;
var timestamp = 0;
var elapsedBefore;
var twoTimes;
var fourTimes;

assert.ok(R.mission.launch(game, referenceBuild), 'builder build launches');
elapsedBefore = 0;
R.controls.setTimeScaleIndex(4);
while (frames < 12) {
	timestamp += 16.7;
	frameCallback(timestamp);
	frames += 1;
}
twoTimes = game.flight.elapsed - elapsedBefore;
assert.ok(game.rocket.wy > 0, 'frame loop lifts the rocket off the pad');
assert.ok(game.rocket.stages[0].fuelMass < R.world.planet.defaultFuel[0], 'frame loop burns fuel');

elapsedBefore = game.flight.elapsed;
R.controls.setTimeScaleIndex(6);
frames = 0;
while (frames < 12) {
	timestamp += 16.7;
	frameCallback(timestamp);
	frames += 1;
}
fourTimes = game.flight.elapsed - elapsedBefore;
assert.equal(game.timeScale, R.constants.time.scales[6], 'time scale index selects the multiplier');
assert.ok(fourTimes > 0 && fourTimes > twoTimes, 'a higher time scale buys more simulated time per frame');
assert.ok(R.util.mod(game.rocket.wx - pads[0].wx, R.world.planet.circumference) > 0, 'the frame loop flies downrange');

delete global.document;
console.log('Render and app startup smoke test passed.');
