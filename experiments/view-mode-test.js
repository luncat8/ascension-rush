'use strict';

// The view scale control: real and experimental log planes, chart frames,
// automatic local-body selection, and prograde / nose tracking views.

var assert = require('node:assert/strict');
var R = require('../js/namespaces.js');
require('../js/util.js');
require('../js/constants.js');
require('../js/planets.js');
require('../js/coords.js');
require('../js/camera.js');
require('../js/world.js');
require('../js/aerodynamics.js');
require('../js/physics.js');
require('../js/sky.js');
require('../js/controls.js');

var camera = R.camera;
var game = { rocket: { wx: 0, wy: 0, heading: 0, throttle: 0 }, simTime: 0 };
var screen = { x: 0, y: 0 };
var other = { x: 0, y: 0 };
var plane = { x: 0, y: 0 };
var oldPoleX;
var oldPoleY;
var dx;
var dy;
var distance;
var expectedX;
var expectedY;
var worldRadius;
var localRadius;
var crossingDistance;
var heading;
var prograde;
var pointerAngle;
var beforeHeading;
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
// Nearest-body selection changes at the equal-surface-clearance boundary,
// then the log pole travels continuously to the new nearest surface point.
R.sky.bodyCentre(-1, other);
R.sky.bodyCentre(3, plane);
dx = plane.x - other.x;
dy = plane.y - other.y;
distance = Math.hypot(dx, dy);
worldRadius = R.sky.bodyRadius(R.sky.bodyOf(-1));
localRadius = R.sky.bodyRadius(R.sky.bodyOf(3));
crossingDistance = (distance + worldRadius - localRadius) * 0.5;
expectedX = other.x + dx / distance * (crossingDistance - 1000);
expectedY = other.y + dy / distance * (crossingDistance - 1000);
R.coords.worldOfPlane(expectedX, expectedY, radius, screen);
game.rocket.wx = screen.x;
game.rocket.wy = screen.y;
frames(1);
assert.equal(R.sky.flat.nearest, -1, 'the world remains nearest just before equal surface clearance');
oldPoleX = camera.poleX;
oldPoleY = camera.poleY;
expectedX = other.x + dx / distance * (crossingDistance + 1000);
expectedY = other.y + dy / distance * (crossingDistance + 1000);
R.coords.worldOfPlane(expectedX, expectedY, radius, screen);
game.rocket.wx = screen.x;
game.rocket.wy = screen.y;
frames(1);
assert.equal(R.sky.flat.nearest, 3, 'the moon becomes nearest just beyond equal surface clearance');
assert.ok(Math.hypot(camera.poleX - oldPoleX, camera.poleY - oldPoleY) < localRadius * 0.1,
	'the pole starts moving without a cut');
assert.ok(R.sky.flat.swap < 1, 'and eases toward the new surface');
frames(209);
R.sky.bodyCentre(3, plane);
R.coords.planeOfWorld(game.rocket.wx, game.rocket.wy, radius, other);
dx = other.x - plane.x;
dy = other.y - plane.y;
distance = Math.hypot(dx, dy);
expectedX = plane.x + dx / distance * localRadius;
expectedY = plane.y + dy / distance * localRadius;
assert.ok(Math.hypot(camera.poleX - expectedX, camera.poleY - expectedY) < 1e-3,
	'the settled pole is at the nearest point on the moon surface');

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
R.sky.bodyCentre(3, plane);
localRadius = R.sky.bodyRadius(R.sky.bodyOf(3));
game.rocket.wx = Math.atan2(plane.x, plane.y) * radius;
game.rocket.wy = Math.hypot(plane.x, plane.y) - radius + 2 * localRadius;
frames(200);
assert.equal(R.sky.pivot.index, 3, 'local-body mode automatically selects a nearby moon');
assert.ok(R.sky.pivot.approach, 'the local body is an automatic seat');
assert.ok(Math.abs(camera.groundY - camera.baseGroundY) < 1,
	'the automatically selected surface becomes the flat ground line');

// ------------------------------------------------------- prograde-locked view
game.rocket.wx = 1550;
game.rocket.wy = 2000;
game.rocket.heading = 1.1;
game.rocket.vx = 3;
game.rocket.vy = 4;
prograde = Math.atan2(game.rocket.vx, game.rocket.vy);
R.sky.setMode('prograde');
frames(400);
assert.equal(camera.directionLock, true, 'prograde lock enables the camera roll');
assert.equal(R.sky.mode.id, 'prograde', 'the prograde mode is selectable');
assert.ok(Math.abs(camera.period - 2 * Math.PI * camera.angularScale) < 1e-9,
	'the prograde view keeps the chart wrap');
camera.project(game.rocket.wx, game.rocket.wy, screen);
camera.rotateScreen(screen.x, screen.y, other);
assert.ok(Math.abs(other.x - camera.width * R.constants.view.directionLock.centreX) < 1e-6 &&
	Math.abs(other.y - camera.height * R.constants.view.directionLock.objectY) < 1e-6,
	'the rocket stays at the lower-centre anchor');
assert.ok(Math.abs(camera.screenRotation + prograde) < 1e-12,
	'the chart rolls against velocity, not attitude');
R.sky.outline(3, game);
camera.rotateScreen(R.sky.shape.centerX, R.sky.shape.centerY, screen);
assert.equal(R.sky.pick(screen.x, screen.y, game), 3,
	'body picking follows the rolled map');
camera.rotateScreen(camera.screenOriginX + Math.sin(prograde) * 20,
	camera.screenOriginY - Math.cos(prograde) * 20, screen);
assert.ok(Math.abs(screen.x - camera.screenOriginX) < 1e-9 &&
	screen.y < camera.screenOriginY, 'the prograde direction points straight up on screen');
camera.rotateScreen(camera.screenOriginX + 43, camera.screenOriginY + 27, screen);
camera.unrotateScreen(screen.x, screen.y, other);
assert.ok(Math.hypot(other.x - camera.screenOriginX - 43,
	other.y - camera.screenOriginY - 27) < 1e-9, 'pointer coordinates invert the view roll');
game.phase = 'flying';
R.input.pointerActive = true;
pointerAngle = 0.2;
R.input.pointerX = camera.screenOriginX + 60 * Math.sin(pointerAngle);
R.input.pointerY = camera.screenOriginY - 60 * Math.cos(pointerAngle);
beforeHeading = game.rocket.heading;
R.controls.update(game, 0.1);
assert.ok(Math.abs(R.util.wrapDelta(game.rocket.heading - beforeHeading, 2 * Math.PI) +
	R.constants.rocket.turnRate * 0.1) < 1e-9,
	'mouse aim is relative to the current screen-up axis');
frames(1);
assert.ok(Math.abs(camera.screenRotation + prograde) < 1e-12,
	'the prograde camera remains locked to velocity as attitude changes');
R.sky.setMode('nose');
frames(1);
assert.equal(R.sky.mode.id, 'nose', 'nose lock is a separate selectable mode');
assert.ok(Math.abs(camera.screenRotation + game.rocket.heading) < 1e-12,
	'the nose mode tracks rocket attitude instead of velocity');
heading = game.rocket.heading;
camera.rotateScreen(camera.screenOriginX + Math.sin(heading) * 20,
	camera.screenOriginY - Math.cos(heading) * 20, screen);
assert.ok(Math.abs(screen.x - camera.screenOriginX) < 1e-9 &&
	screen.y < camera.screenOriginY, 'nose lock keeps the rocket pointed screen-up');
game.rocket.vx = 0;
game.rocket.vy = 0;
R.sky.setMode('prograde');
frames(1);
assert.ok(Math.abs(camera.screenRotation + game.rocket.heading) < 1e-12,
	'prograde falls back to nose direction at rest');
game.rocket.vx = 3;
game.rocket.vy = 4;
prograde = Math.atan2(game.rocket.vx, game.rocket.vy);
frames(1);
assert.ok(Math.abs(camera.screenRotation + prograde) < 1e-12,
	'prograde reacquires velocity once it is defined');
game.phase = 'deck';
R.input.pointerActive = false;
camera.projectPlane(0, radius, screen);
camera.projectPlane(radius, 0, other);
assert.ok(Math.abs(screen.y - other.y) < 1e-6 && Math.abs(screen.y - camera.groundY) < 1e-6,
	'the active body surface is still an unwrapped line beneath the rocket');
assert.equal(R.sky.handBegin(300, 300, game), false, 'the tracking view does not pan away from its object');

game.rocket.wy = 200 * radius;
frames(1);
assert.equal(R.sky.pivot.index, 0, 'prograde lock follows the same visual hand-off to the star');
assert.equal(camera.transition.active, true, 'the body-to-star change is eased');
camera.project(game.rocket.wx, game.rocket.wy, screen);
camera.rotateScreen(screen.x, screen.y, other);
assert.ok(Math.abs(other.x - camera.screenOriginX) < 1e-6 &&
	Math.abs(other.y - camera.screenOriginY) < 1e-6,
	'the rocket stays pinned through the first hand-over frame');
frames(200);
assert.equal(camera.transition.active, false, 'the star hand-over settles in prograde lock');
game.rocket.wy = 40 * radius;
frames(1);
assert.equal(R.sky.pivot.index, -1, 'the chart returns to the world inside its approach band');
assert.equal(camera.transition.active, true, 'the star-to-world change is eased too');
frames(200);
assert.equal(camera.transition.active, false, 'the return hand-over settles');

R.sky.setMode('ship');
game.rocket.heading = 0;
frames(400);
assert.equal(camera.directionLock, false, 'leaving the direction-lock views restores the ordinary chart');
assert.equal(R.sky.seatPivot(3, game), true, 'the rocket-frame chart can still be seated manually');
frames(200);
assert.equal(R.sky.pivot.index, 3, 'the click-selected body is held in rocket-frame mode');

// Local-body mode reselects from the rocket's location rather than retaining
// the manual seat left by the rocket-frame chart.
R.sky.setMode('body');
// Beyond the world's reach and inside no other body's, the star takes the chart.
game.rocket.wy = 200 * radius;
frames(400);
assert.equal(R.sky.pivot.index, 0, 'local-body mode hands over automatically to the star');
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
