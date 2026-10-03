'use strict';

var assert = require('node:assert/strict');
var R = require('../js/namespaces.js');

require('../js/util.js');
require('../js/constants.js');
require('../js/coords.js');
require('../js/camera.js');

var camera = R.camera;
var screen = { x: 0, y: 0 };
var world = { x: 0, y: 0 };
var circumference = R.constants.world.circumference;
var cases = [
	{ x: -1250000, y: 0 },
	{ x: -120000, y: 100 },
	{ x: 0, y: 1000 },
	{ x: 260000, y: 10000 },
	{ x: 1000000, y: 100000 },
	{ x: 3250000, y: 1000000 }
];
var i;

camera.resize(1440, 900);
camera.follow(0);

assert.equal(R.util.mod(-1, circumference), circumference - 1);
assert.equal(R.util.wrapDelta(circumference * 0.75, circumference), -circumference * 0.25);
assert.equal(camera.groundY, 810);

for (i = 0; i < cases.length; i += 1) {
	camera.project(cases[i].x, cases[i].y, screen);
	camera.unproject(screen.x, screen.y, world);
	assert.ok(Math.abs(world.x - cases[i].x) < 1e-7, 'longitude round trip at case ' + i);
	assert.ok(Math.abs(world.y - cases[i].y) < 1e-6, 'altitude round trip at case ' + i);
}

camera.project(0, 0, screen);
assert.ok(Math.abs(screen.x - 480) < 1e-9, 'rocket anchor sits one-third across the view');
camera.project(0, R.constants.world.maxAltitude, screen);
assert.equal(screen.y, 0, 'maximum altitude maps to the top edge');

console.log('Coordinate tests passed.');
