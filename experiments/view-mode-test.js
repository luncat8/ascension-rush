'use strict';

// The view scale control: two flat views that draw the plane as it is (real
// scale, and its log variant read from the nearest surface point) and the two
// chart views (log read from the hull's ground point, or from the centre of
// the body whose influence the hull is in).

var assert = require('node:assert/strict');
var R = require('../js/namespaces.js');
require('../js/util.js');
require('../js/constants.js');
require('../js/planets.js');
require('../js/coords.js');
require('../js/camera.js');
require('../js/world.js');
require('../js/physics.js');
require('../js/sky.js');

var camera = R.camera;
var game = { rocket: { wx: 0, wy: 0 }, simTime: 0 };
var screen = { x: 0, y: 0 };
var other = { x: 0, y: 0 };
var plane = { x: 0, y: 0 };
var radius;

function frames(count) {
	var f;

	for (f = 0; f < count; f += 1) {
		R.sky.update(game, 0.016);
	}
}

function start(mode, wx, wy) {
	R.sky.reset();
	R.sky.setMode('ship');
	R.sky.setMode(mode);
	game.rocket.wx = wx;
	game.rocket.wy = wy;
	frames(400);
}

function roundTrip(px, py, label) {
	camera.projectPlane(px, py, screen);
	camera.unprojectPlane(screen.x, screen.y, plane);
	assert.ok(Math.hypot(plane.x - px, plane.y - py) < 1e-6 * Math.max(1, Math.hypot(px, py)),
		label + ' round-trips');
}

R.world.initialize('verdant');
camera.resize(1200, 800);
radius = R.world.planet.radius;

assert.equal(R.sky.mode.id, 'ship', 'the chart read from the hull is the default view');
assert.equal(R.sky.setMode('nowhere'), false, 'an unknown mode is refused');

// ---------------------------------------------------------------- real scale
start('real', 1500, 400);
assert.ok(camera.flat && !camera.flatLog, 'real scale is a flat view');
assert.equal(camera.period, 0, 'with no wrap');
camera.project(1500, 400, screen);
assert.ok(Math.abs(screen.x - 600) < 1e-6 && Math.abs(screen.y - 800 * 0.55) < 1e-6,
	'the hull is the centre');
camera.project(1500, 0, other);
assert.ok(Math.abs(other.x - screen.x) < 1e-6 && other.y > screen.y,
	'the ground is straight below it: the local up is the top of the screen');
assert.ok(Math.abs((other.y - screen.y) - 400 * camera.scale) < 1e-6,
	'at one scale: 400 m of climb is 400 m of pixels');
assert.ok(Math.abs((other.y - screen.y) - 800 * 0.3) < 1, 'fitted to keep the ground in view');
// One scale everywhere: a chord across the world is as long as it is.
camera.projectPlane(radius, 0, screen);
camera.projectPlane(-radius, 0, other);
assert.ok(Math.abs(Math.hypot(screen.x - other.x, screen.y - other.y) - 2 * radius * camera.scale) < 1e-6,
	'the world is round and to scale');
roundTrip(radius * 30, -radius * 12, 'real scale');
// The world is a ring like every other body, smooth where the hull stands.
R.sky.outline(-1, game);
assert.ok(R.sky.shape.ring && R.sky.shape.visible, 'the world is drawn as its own circle');
assert.ok(Math.hypot(R.sky.shape.ringXs[73] - R.sky.shape.ringXs[72],
	R.sky.shape.ringYs[73] - R.sky.shape.ringYs[72]) < 400 * camera.scale,
	'sampled finest under the hull');
// The wheel reaches the whole system and no gesture walks a pole.
camera.zoomBy(1e-9);
assert.equal(camera.zoomTarget, R.constants.view.flat.zoomMin, 'the wheel has the flat band');
assert.equal(R.sky.handBegin(300, 300, game), false, 'a flat view has no drag');
assert.equal(R.sky.seatPivot(3, game), false, 'and no seat');

// ------------------------------------------------------------------ real log
start('real-log', 0, 2000);
assert.ok(camera.flat && camera.flatLog, 'the log variant is a flat view');
assert.ok(Math.hypot(camera.poleX, camera.poleY - radius) < 1e-6,
	'its pole is the surface point nearest the hull');
camera.project(0, 2000, screen);
assert.ok(Math.abs(screen.x - camera.ox) < 1e-6, 'the hull is straight above the pole');
assert.ok(Math.abs((camera.oy - screen.y) - camera.scale * Math.log1p(2000 / camera.logScale)) < 1e-6,
	'at the log of its altitude');
// Bearings from the pole are kept: only distance is compressed.
camera.projectPlane(camera.poleX + 3e5, camera.poleY + 4e5, screen);
assert.ok(Math.abs(Math.atan2(screen.x - camera.ox, camera.oy - screen.y) - Math.atan2(3, 4)) < 1e-9,
	'a bearing from the pole is the same bearing on screen');
roundTrip(radius * 400, radius * 90, 'the log view');
roundTrip(camera.poleX + 0.5, camera.poleY - 0.25, 'the log view beside its pole');
// The whole system fits inside the disc above the pole.
R.sky.outline(0, game);
assert.ok(R.sky.shape.farY > 0 && R.sky.shape.nearY < 800, 'the star is on screen');
// Nearer a moon than the world, the pole travels to the moon.
R.sky.bodyCentre(3, plane);
game.rocket.wx = Math.atan2(plane.x, plane.y) * radius;
game.rocket.wy = Math.hypot(plane.x, plane.y) - radius - 4 * radius;
frames(10);
assert.equal(R.sky.flat.nearest, 3, 'the moon is the nearest surface');
assert.ok(R.sky.flat.swap < 1, 'and the pole is on its way there');
frames(200);
R.sky.bodyCentre(3, plane);
assert.ok(Math.abs(Math.hypot(camera.poleX - plane.x, camera.poleY - plane.y) -
	R.sky.bodyRadius(R.sky.bodyOf(3))) < 1e-3, 'ending on the moon');

// ---------------------------------------------------------------- chart: ship
start('ship', 0, 8 * radius);
assert.equal(camera.flat, false, 'back on the chart');
assert.equal(camera.zoomTarget, 1, 'with the chart\'s own zoom');
assert.ok(Math.abs(Math.hypot(camera.poleX, camera.poleY) - radius) < 1,
	'above the air the hull\'s own ground point is the pole');

// ---------------------------------------------------------------- chart: body
R.sky.setMode('body');
frames(600);
assert.ok(Math.hypot(camera.poleX, camera.poleY) < 1, 'the body view eases the pole back to the centre');
assert.ok(Math.abs(camera.groundY - camera.baseGroundY) < 1, 'so the whole surface is the flat ground line');
assert.ok(Math.abs(camera.period - camera.width) < 1, 'one circumference across the viewport');
camera.project(0, 8 * radius, screen);
assert.ok(screen.y > 0 && screen.y < camera.groundY, 'and the hull is charted above it');

// Beyond the world's reach and inside no other body's, the star takes the chart.
game.rocket.wy = 200 * radius;
frames(400);
assert.equal(R.sky.pivot.index, 0, 'the chart is handed to the star');
assert.ok(R.sky.pivot.approach, 'as a seat the hull flew into');
game.rocket.wy = 100 * radius;
frames(400);
assert.equal(R.sky.pivot.index, 0, 'and held through the hysteresis band');
game.rocket.wy = 40 * radius;
frames(400);
assert.equal(R.sky.pivot.index, -1, 'until the hull is back inside the world\'s reach');

// The ship view never does that.
R.sky.setMode('ship');
game.rocket.wy = 200 * radius;
frames(400);
assert.equal(R.sky.pivot.index, -1, 'the ship view stays on the world out there');

// A flat view drops whatever seat the chart had.
R.sky.setMode('body');
frames(400);
assert.equal(R.sky.pivot.index, 0);
R.sky.setMode('real');
frames(2);
assert.equal(R.sky.pivot.index, -1, 'a flat view starts from the world');
assert.equal(camera.transition.active, false, 'with no hand-over running');
R.sky.setMode('ship');

console.log('View scale mode tests passed.');
