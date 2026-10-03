'use strict';

var assert = require('node:assert/strict');
var renderCalls = 0;
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
require('../js/physics.js');
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
	flight: { cashDelta: -600 },
	cash: 29400,
	timeScaleIndex: R.constants.time.defaultIndex,
	timeScale: R.constants.time.scales[R.constants.time.defaultIndex],
	rocket: flightRocket
});

var main = require('../js/main.js');
main.start();

assert.ok(renderCalls > 100, 'renderer executed expected drawing operations');
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
