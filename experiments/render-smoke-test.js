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
R.input.worldPoint.x = 125000;
R.input.worldPoint.y = 10000;
R.input.debugText = 'E 125000 m  ·  ALT 10000 m';
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
flightRocket.wy = 12000;
flightRocket.vx = 450;
flightRocket.vy = 600;
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
delete global.document;
console.log('Render and app startup smoke test passed.');
