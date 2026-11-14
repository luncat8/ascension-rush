'use strict';

// The chart's contract: one log-polar map of the system plane, read from a
// pole, fitted by the sky each frame. Longitude and altitude round trip through
// it, the body under the pole is the ground line, the camera target holds the
// origin line, and a pan or a zoom moves the view without moving the law.

var assert = require('node:assert/strict');
var R = require('../js/namespaces.js');
require('../js/parts.js');

require('../js/util.js');
require('../js/constants.js');
require('../js/planets.js');
require('../js/coords.js');
require('../js/camera.js');
require('../js/world.js');
require('../js/physics.js');
require('../js/sky.js');

var camera = R.camera;
var view = R.constants.view;
var screen = { x: 0, y: 0 };
var world = { x: 0, y: 0 };
var planet;
var game;
var cases;
var anchorX;
var airY;
var i;

function close(actual, expected, tolerance, label) {
	assert.ok(Math.abs(actual - expected) <= tolerance, label + ': ' + actual + ' vs ' + expected);
}

function settle(seconds) {
	var frames = Math.round(seconds / 0.016);
	var f;

	for (f = 0; f < frames; f += 1) {
		R.sky.update(game, 0.016);
	}
}

R.world.initialize('verdant');
R.camera.resize(1440, 900);
planet = R.world.planet;
game = { rocket: { wx: 0, wy: 0 }, simTime: 0 };
anchorX = camera.width * view.cameraAnchorFraction;
cases = [
	{ x: -12500, y: 0 },
	{ x: -1200, y: 10 },
	{ x: 0, y: 100 },
	{ x: 2600, y: 1000 },
	{ x: 10000, y: 5000 },
	{ x: 32500, y: 20000 }
];

assert.equal(R.util.mod(-1, planet.circumference), planet.circumference - 1);
assert.equal(R.util.wrapDelta(planet.circumference * 0.75, planet.circumference), -planet.circumference * 0.25);
assert.equal(planet.circumference, 20000);

// ---------------------------------------------------------------------------
// The ladder: a log on a knee, gentler beyond the switch altitude, and a single
// log below the ladder's start so a cutaway stays shallow.
// ---------------------------------------------------------------------------

R.sky.reset();
settle(3);

close(camera.logScale, planet.logAltitudeScale, 1e-9, 'the landed chart keeps the planet log knee');
close(camera.ladderFar, view.ladderFar, 1e-9, 'and its far-field compression');
assert.ok(camera.ladderQ0 > 0, 'the knee has a switch altitude above it');

for (i = 0; i < 24; i += 1) {
	var height = Math.pow(10, i / 3) * 0.5;

	close(R.coords.unladder(R.coords.ladderOf(height, camera.logScale, camera.ladderQ0, camera.ladderFar),
		camera.logScale, camera.ladderQ0, camera.ladderFar), height, height * 1e-9 + 1e-9,
		'the ladder inverts itself at ' + height.toFixed(2) + ' m');
}
for (i = 1; i < 12; i += 1) {
	var distance = planet.radius / i;

	close(R.coords.distanceWith(R.coords.depthWith(distance, planet.radius, 100, 4, 0.5),
		planet.radius, 100, 4, 0.5), distance, distance * 1e-9,
		'depth inverts itself below the ladder start at ' + i);
}
assert.ok(R.coords.depthWith(planet.radius * 0.5, planet.radius, 100, 4, 0.5) < 0,
	'inside the ladder start the depth is negative: below the ground line');
assert.equal(R.coords.depthWith(planet.radius, planet.radius, 100, 4, 0.5), 0,
	'and the ladder start itself is the ground line');

// ---------------------------------------------------------------------------
// The ground line is the body under the pole, and it is flat: the pole is that
// body's centre, so every longitude of its surface is at depth zero.
// ---------------------------------------------------------------------------

assert.equal(R.sky.pivot.index, -1, 'a fresh session stands on the world');
assert.equal(R.sky.groundBody(), -1, 'and the world is the body under the pole');
close(camera.ladderRef, planet.radius, 1e-6, 'the ladder starts at the world surface');
close(camera.groundY, camera.oy, 1e-12, 'the ground line is the origin of the depth axis');
close(camera.originY, camera.groundY, 1e-9, 'landed, the camera target sits on the ground line');
close(camera.groundY, camera.height * (1 - view.groundFraction), 1e-9,
	'which is the deck ground line');

for (i = 0; i <= 8; i += 1) {
	camera.project(i * 2500, 0, screen);
	close(screen.y, camera.groundY, 1e-9, 'the surface is flat at longitude ' + i * 2500);
}

// ---------------------------------------------------------------------------
// Round trips, both spellings of the map.
// ---------------------------------------------------------------------------

// Longitude comes back modulo the circumference: X is an angle, so the chart is
// a cylinder and a round trip recovers the ground, not the raw number.
for (i = 0; i < cases.length; i += 1) {
	camera.project(cases[i].x, cases[i].y, screen);
	camera.unproject(screen.x, screen.y, world);
	close(Math.abs(R.util.wrapDelta(world.x - cases[i].x, planet.circumference)), 0, 1e-6,
		'longitude round trip at case ' + i);
	close(world.y, cases[i].y, 1e-6, 'altitude round trip at case ' + i);
}
camera.project(2600, 1000, screen);
camera.unproject(screen.x, screen.y, world);
close(world.x, 2600, 1e-6, 'and inside the window it is the raw longitude');
for (i = 0; i < 16; i += 1) {
	var px = Math.cos(i) * planet.radius * 40;
	var py = Math.sin(i) * planet.radius * 40;

	camera.projectPlane(px, py, screen);
	camera.unprojectPlane(screen.x, screen.y, world);
	close(world.x, px, Math.abs(px) * 1e-9 + 1e-6, 'plane round trip x at ' + i);
	close(world.y, py, Math.abs(py) * 1e-9 + 1e-6, 'plane round trip y at ' + i);
}

camera.project(0, 0, screen);
close(screen.x, anchorX, 1e-9, 'the camera target sits on its anchor column');
close(screen.y, camera.originY, 1e-9, 'and on the origin line');

// ---------------------------------------------------------------------------
// The fit: the farthest charted surface is the top edge, and the ladder spends
// most of the deck on the air column.
// ---------------------------------------------------------------------------

var farthest = 0;
for (i = 0; i < R.constants.sky.bodies.length; i += 1) {
	farthest = Math.max(farthest, (R.constants.sky.bodies[i].distanceRadii +
		R.constants.sky.bodies[i].radiusRadii) * planet.radius);
}
camera.project(0, farthest - planet.radius, screen);
close(screen.y, camera.topY(), 0.5, 'the farthest far limb is fitted to the top edge');
close(camera.extent, farthest, farthest * 1e-6, 'the charted extent is that limb');

camera.project(0, R.physics.atmosphereTop(), screen);
airY = screen.y;
assert.ok(airY < camera.groundY * 0.78 && airY > camera.groundY * 0.3,
	'the atmosphere top sits between 22% and 70% up the deck (got ' +
	Math.round(100 * (1 - airY / camera.groundY)) + '%)');
assert.ok(camera.groundY - airY > airY - camera.topY(),
	'the air column is taller than the whole system above it');
camera.project(0, 1000, screen);
assert.ok(screen.y > airY && screen.y < camera.groundY - 100, '1 km sits inside the air column band');

// On the deck the tangential axis carries exactly one circumference per
// viewport: the world seam is the viewport edge, so a lap is a full world.
close(camera.period, camera.width, 1e-9, 'the deck shows one circumference across the viewport');
close(R.coords.periodOf(camera.angularScale), camera.period, 1e-12, 'the period is 2 pi of the angular scale');
assert.equal(R.coords.lapSpan(camera.period, camera.width), 2, 'which needs two laps either side to cover it');

// ---------------------------------------------------------------------------
// Above the air the ship becomes the centre of the scale: it holds the origin
// line and the ground sinks below it by exactly the climb.
// ---------------------------------------------------------------------------

game.rocket.wy = 200000;
settle(8);

close(camera.fly, 1, 1e-9, 'above the switch altitude the chart is in the system view');
close(camera.targetDistance, planet.radius + 200000, 1e-4,
	'the camera target is the ship at its own distance from the pole');
close(camera.originY, camera.height * view.followHeight, 1e-6, 'and it holds the follow line');
camera.project(game.rocket.wx, game.rocket.wy, screen);
close(screen.x, anchorX, 1e-9, 'the ship stays on its anchor column');
close(screen.y, camera.originY, 1e-6, 'and on the origin line');
assert.ok(camera.groundY > camera.height, 'the ground has sunk below the viewport');
close(R.coords.distanceAt(R.coords.depthOf(camera.targetDistance, camera), camera),
	camera.targetDistance, camera.targetDistance * 1e-9, 'the target distance inverts through the depth');
close(camera.groundY - camera.originY,
	camera.scale * R.coords.depthOf(camera.targetDistance, camera), 1e-6,
	'by exactly the depth of the climb');
close(camera.period, Math.PI * 2 * camera.angularScale, 1e-9, 'the period is still 2 pi of the angular scale');
close(camera.angularScale, camera.scale, 1e-9, 'and in the system view both axes share one scale');

// A ship out at the moon's distance is still fitted with the whole system: the
// shared scale widens rather than dropping the catalog off the top.
game.rocket.wy = 23 * planet.radius;
settle(8);
close(camera.targetDistance, planet.radius + 23 * planet.radius, 1e-2, 'the target is the ship out at 24 radii');
assert.ok(camera.extent >= farthest * 0.999, 'the chart still reaches the farthest body');
camera.project(0, farthest - planet.radius, screen);
assert.ok(screen.y >= camera.topY() - 1 && screen.y < camera.height,
	'and that body is still on screen');

// ---------------------------------------------------------------------------
// A zoom moves the view, never the law, and never the ground under the target.
// ---------------------------------------------------------------------------

game.rocket.wy = 0;
R.sky.reset();
settle(3);
close(camera.ox, camera.baseOx, 1e-12, 'the pose is the whole view: the offsets are what it solved');
close(camera.oy, camera.baseOy, 1e-12, 'in both axes');

var groundBefore = camera.groundY;
camera.zoomBy(2);
R.sky.update(game, 0);
camera.project(0, 0, screen);
close(screen.x, anchorX, 1e-9, 'a zoom keeps the camera target on its anchor column');
close(camera.groundY, groundBefore, 1e-9, 'and the ground line on its line');
close(camera.scale, camera.fitScale * 2, 1e-9, 'the zoom multiplies the shared scale');
camera.project(0, 1000, screen);
assert.ok(screen.y < airY, 'so it magnifies the flight band');
camera.zoomBy(0.25);
R.sky.update(game, 0);
close(camera.zoom, 0.5, 1e-9, 'the zoom factor compounds');
camera.zoomBy(1e6);
R.sky.update(game, 0);
close(camera.zoom, view.zoomMax, 1e-9, 'and a hard flick is clamped, not lost');
camera.resetZoom();
R.sky.update(game, 0);
close(camera.zoom, 1, 1e-12, 'a reset returns to the fitted view');

// ---------------------------------------------------------------------------
// The wrap: a screen x has one place per lap, and putting it in the lap of a
// reference makes a seam a translate instead of a jump.
// ---------------------------------------------------------------------------

close(R.coords.wrapScreenX(10, 100, 50), 110, 1e-12, 'a wrap moves x by whole periods');
close(R.coords.wrapScreenX(10, 100, 0), 10, 1e-12, 'and without a period it is the identity');
assert.ok(Math.abs(R.coords.wrapScreenX(3000, 40, 1440) - 40) <= 720,
	'the wrapped x is within half a period of its reference');
assert.equal(R.coords.lapSpan(1440, 1440), 2, 'laps cover the viewport at one period per width');
assert.equal(R.coords.lapSpan(400, 1440), 3, 'and more of them when the period is shorter');

// ---------------------------------------------------------------------------
// A world switch rebuilds the plane radius and the pads, and the chart follows.
// ---------------------------------------------------------------------------

R.world.initialize('gossamer');
settle(4);
assert.equal(planet.circumference, 26000, 'gossamer circumference is live');
assert.equal(R.world.pads.length, 4);
assert.equal(R.world.pads[2].wx, R.world.planet.circumference * 0.45);
close(camera.worldRadius, R.world.planet.radius, 1e-9, 'the plane radius follows the planet');
close(R.sky.view.radius, R.world.planet.radius, 1e-6, 'and so does the charted one');
close(camera.ladderRef, R.world.planet.radius, 1e-6, 'the ladder starts at the new surface');
camera.project(0, 0, screen);
close(screen.y, camera.groundY, 1e-9, 'the new surface is the ground line');

console.log('Coordinate tests passed.');
