'use strict';

var assert = require('node:assert/strict');
var R = require('../js/namespaces.js');
require('../js/parts.js');

require('../js/util.js');
require('../js/constants.js');
require('../js/planets.js');
require('../js/coords.js');
require('../js/camera.js');
require('../js/world.js');

var camera = R.camera;
var screen = { x: 0, y: 0 };
var world = { x: 0, y: 0 };
var planet;
var cases;

R.world.initialize('verdant');
planet = R.world.planet;
cases = [
	{ x: -12500, y: 0 },
	{ x: -1200, y: 10 },
	{ x: 0, y: 100 },
	{ x: 2600, y: 1000 },
	{ x: 10000, y: 5000 },
	{ x: 32500, y: 20000 }
];

camera.resize(1440, 900);
camera.follow(0);

assert.equal(R.util.mod(-1, planet.circumference), planet.circumference - 1);
assert.equal(R.util.wrapDelta(planet.circumference * 0.75, planet.circumference), -planet.circumference * 0.25);
assert.equal(camera.groundY, 810);
assert.equal(planet.circumference, 20000);

var i;
for (i = 0; i < cases.length; i += 1) {
	camera.project(cases[i].x, cases[i].y, screen);
	camera.unproject(screen.x, screen.y, world);
	assert.ok(Math.abs(world.x - cases[i].x) < 1e-7, 'longitude round trip at case ' + i);
	assert.ok(Math.abs(world.y - cases[i].y) < 1e-6, 'altitude round trip at case ' + i);
}

camera.project(0, 0, screen);
assert.ok(Math.abs(screen.x - 480) < 1e-9, 'rocket anchor sits one-third across the view');
camera.project(0, planet.maxAltitude, screen);
assert.equal(screen.y, 0, 'maximum altitude maps to the top edge');
camera.project(0, 200, screen);
assert.ok(screen.y < camera.groundY && screen.y > 0, 'low altitude stays inside the playable band');

// A planet switch must rebuild the horizontal scale and pad longitudes.
R.world.initialize('gossamer');
camera.resize(1440, 900);
assert.equal(planet.circumference, 26000, 'gossamer circumference is live');
assert.equal(R.world.pads.length, 4);
assert.equal(R.world.pads[2].wx, R.world.planet.circumference * 0.45);
assert.ok(Math.abs(camera.pixelsPerMeterX - 1440 / 26000) < 1e-12, 'horizontal scale follows the planet');

console.log('Coordinate tests passed.');
