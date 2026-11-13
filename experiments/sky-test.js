'use strict';

// Inter-planet chart slice: GM / escape speed, the atmosphere ceiling, the
// log-polar chart, the lens projection of every catalog body through it, the
// pivot hand-over, coast trace and the flown-trail ring buffer. No physics
// input is changed by any of it.

var assert = require('node:assert/strict');
var R = require('../js/namespaces.js');
require('../js/util.js');
require('../js/constants.js');
require('../js/planets.js');
require('../js/coords.js');
require('../js/camera.js');
require('../js/world.js');
require('../js/parts.js');
require('../js/rocket.js');
require('../js/aerodynamics.js');
require('../js/physics.js');
require('../js/trajectory.js');
require('../js/sky.js');
require('../js/flight-path.js');

var screen = { x: 0, y: 0 };
var worldPoint = { x: 0, y: 0 };
var shape;
var game;
var planet;
var mu;
var i;
var airTop;

function close(actual, expected, tolerance, label) {
	assert.ok(Math.abs(actual - expected) <= tolerance, label + ': ' + actual + ' vs ' + expected);
}

function settle(seconds, theGame) {
	var frames = Math.round(seconds / 0.016);
	var f;

	for (f = 0; f < frames; f += 1) {
		R.sky.update(theGame, 0.016);
	}
}

// A hand-over must not cut. The invariant that guarantees it: the anchor's
// screen position is unchanged at every frame, because the pose is solved from
// it against the live pole. The ship is not the anchor and does move — it is
// a different point of the plane, and its own motion is the flight.
var anchorScreen = { x: 0, y: 0 };

function anchorOf() {
	var dx = R.sky.pivot.anchorX - R.camera.pivotX;
	var dy = R.sky.pivot.anchorY - R.camera.pivotY;

	anchorScreen.x = R.camera.ox + R.camera.scalePx * Math.atan2(dx, dy);
	anchorScreen.y = R.camera.oy - R.camera.scalePx * Math.log(Math.max(1e-9, Math.sqrt(dx * dx + dy * dy)));
	return anchorScreen;
}

function handOver(from, to, label) {
	var drift = 0;
	var frames = 0;

	R.sky.reset();
	settle(1.5, game);
	if (from >= 0) {
		R.sky.seatPivot(from, game);
		while (R.sky.pivot.reseating) {
			R.sky.update(game, 0.016);
		}
		settle(0.5, game);
	}
	assert.ok(R.sky.seatPivot(to, game), label + ': the seat is accepted');
	anchorOf();
	assert.ok(Math.abs(anchorScreen.x - R.sky.pivot.anchorSx) < 0.001,
		label + ': the first frame reproduces the anchor');
	assert.ok(Math.abs(anchorScreen.y - R.sky.pivot.anchorSy) < 0.001,
		label + ': and its height');
	while (R.sky.pivot.reseating) {
		R.sky.update(game, 0.016);
		anchorOf();
		drift = Math.max(drift, Math.hypot(anchorScreen.x - R.sky.pivot.anchorSx,
			anchorScreen.y - R.sky.pivot.anchorSy));
		frames += 1;
	}
	assert.ok(frames > 10, label + ': the hand-over takes real frames, not a cut');
	assert.ok(drift < 0.001, label + ': the anchor does not move (drift ' + drift + ' px)');
}

R.world.initialize('verdant');
R.camera.resize(1440, 900);
R.camera.follow(0);
planet = R.world.planet;
mu = planet.surfaceGravity * planet.radius * planet.radius;

// Escape speed from the same GM whose derivative is gravityAtAltitude.
close(R.physics.gravitationalParameter(), mu, 1e-6, 'GM = g0 * R^2');
close(R.physics.escapeSpeedAtAltitude(0), Math.sqrt(2 * planet.surfaceGravity * planet.radius), 1e-9,
	'surface escape speed');
close(R.physics.escapeSpeedAtAltitude(1000), Math.sqrt(2 * mu / (planet.radius + 1000)), 1e-9,
	'escape speed falls with radius');
close(R.physics.escapeSpeedAtAltitude(1000), Math.SQRT2 * R.physics.circularSpeedAtAltitude(1000), 1e-9,
	'escape is sqrt(2) times circular');

// ---------------------------------------------------------------------------
// The deck is the closed form of the chart, not a second projection.
// ---------------------------------------------------------------------------

game = { rocket: { wx: 0, wy: 0 }, simTime: 0 };
R.sky.reset();
settle(2, game);
assert.equal(R.sky.pivot.index, -1, 'a fresh session is seated on the world');
assert.equal(R.camera.flat, true, 'the deck uses the closed-form chart there');
close(R.sky.pivot.radius, planet.radius, 1e-6, 'the pivot radius is the world radius');
close(R.camera.ceiling, planet.maxAltitude, 1e-6, 'the deck keeps the planet log range');
close(R.camera.logScale, planet.logAltitudeScale, 1e-9, 'and its log knee');

// The flat form is the log-polar form with the pivot on the world: for a point
// on the surface it is exactly the wrap-X map, and the round trip is exact.
for (i = 0; i < 32; i += 1) {
	R.camera.project(i * 500, 200, screen);
	R.camera.unproject(screen.x, screen.y, worldPoint);
	close(worldPoint.x, i * 500, 1e-6, 'deck round trip x at ' + i);
	close(worldPoint.y, 200, 1e-6, 'deck round trip y at ' + i);
}

// The log-polar form is one shared scale on both axes: the height of a lens
// and its width are produced by the same number, so a body cannot be squashed.
assert.ok(R.camera.scalePx > 0, 'the chart has a shared log scale');

// ---------------------------------------------------------------------------
// Every catalog body is a lens through that map.
// ---------------------------------------------------------------------------

for (i = 0; i < R.constants.sky.bodies.length; i += 1) {
	shape = R.sky.outline(i, game);
	assert.ok(shape.visible, 'body ' + i + ' is charted');
	assert.ok(shape.nearY > shape.farY, 'body ' + i + ' has its near limb below its far limb');
	assert.ok(shape.halfWidth > 0, 'body ' + i + ' has a finite angular half-width');
	assert.equal(shape.xs.length, shape.farYs.length);
	// The two limbs meet exactly at the two edges of the lens.
	close(shape.nearYs[0], shape.farYs[0], 1e-6, 'body ' + i + ' limbs meet at the left edge');
	close(shape.nearYs[shape.nearYs.length - 1], shape.farYs[shape.farYs.length - 1], 1e-6,
		'body ' + i + ' limbs meet at the right edge');
	// And at psi = 0 the near and far limbs are D - rho and D + rho.
	close(shape.nearY, R.camera.oy - R.camera.scalePx * Math.log(shape.distance - R.sky.bodyRadius(
		R.sky.bodyOf(i))), 1e-6, 'body ' + i + ' near limb is D - rho');
}

// The body the chart is seated on is the ground, so it is not a lens.
shape = R.sky.outline(-1, game);
assert.equal(shape.visible, false, 'the seated body is not drawn as a lens');

// A distant body is still a visible lens rather than a one-pixel line: that is
// the whole reason both axes share one scale.
shape = R.sky.outline(0, game);
assert.ok(shape.nearY - shape.farY > 2, 'the star is at least two pixels tall');

// ---------------------------------------------------------------------------
// A world switch morphs the view, never the physics.
// ---------------------------------------------------------------------------

R.world.initialize('cinder');
game.rocket = { wx: 0, wy: 0 };
R.sky.update(game, 0);
assert.equal(R.sky.view.planetId, 'cinder');
assert.equal(R.sky.view.morph, 0, 'the morph starts at zero');
settle(2, game);
assert.equal(R.sky.view.morph, 1, 'the morph completes');
close(R.sky.view.gravity, R.world.planet.surfaceGravity, 1e-9, 'gravity reaches the new world');
close(R.sky.view.radius, R.world.planet.radius, 1e-6, 'radius reaches the new world');

// ---------------------------------------------------------------------------
// The pivot hand-over: the anchor does not move, and the map realigns.
// ---------------------------------------------------------------------------

R.world.initialize('verdant');
game = { rocket: { wx: 0, wy: 0 }, simTime: 0 };
R.sky.reset();
settle(2, game);

var luneIndex = 3;
var luneRadius = R.constants.sky.bodies[luneIndex].radiusRadii * R.world.planet.radius;
handOver(-1, luneIndex, 'world -> Lune');
assert.equal(R.sky.pivot.index, luneIndex);
close(R.sky.pivot.radius, luneRadius, 1e-6, 'the pivot radius is Lune\'s');
close(Math.hypot(R.sky.pivot.x, R.sky.pivot.y), 24 * R.world.planet.radius, 1e-3,
	'the pivot centre is Lune\'s orbit');
assert.equal(R.camera.flat, false, 'the chart is the general log-polar form away from the world');

// Seated on Lune, the world is a lens like any other.
R.sky.outline(-1, game);
assert.ok(R.sky.shape.visible, 'the world is charted as a body');
assert.ok(R.sky.shape.nearY - R.sky.shape.farY > 1, 'and it has a visible lens');

// The inverse still round trips while seated elsewhere.
R.camera.project(1234, 567, screen);
R.camera.unproject(screen.x, screen.y, worldPoint);
close(worldPoint.x, 1234, 1e-6, 'log-polar round trip x');
close(worldPoint.y, 567, 1e-6, 'log-polar round trip y');

// And back to the world: the deck's own map again.
handOver(luneIndex, -1, 'Lune -> world');
assert.equal(R.sky.pivot.index, -1);
assert.equal(R.camera.flat, true, 'the deck map is back');

// A seat request while a hand-over is running is refused rather than stacked.
assert.ok(R.sky.seatPivot(luneIndex, game));
assert.equal(R.sky.seatPivot(4, game), false, 'a seat during a hand-over is refused');
assert.equal(R.sky.seatPivot(luneIndex, game), false, 'and so is a repeat of the same seat');
while (R.sky.pivot.reseating) {
	R.sky.update(game, 0.016);
}

// ---------------------------------------------------------------------------
// Airless worlds still chart their sky.
// ---------------------------------------------------------------------------

R.sky.reset();
R.world.initialize('gossamer');
R.sky.update(game, 0);
settle(2, game);
assert.ok(R.physics.atmosphereTop() > 0, 'a deep atmosphere has a ceiling line');
R.world.initialize('tinmoon');
R.sky.update(game, 0);
assert.equal(R.physics.atmosphereTop(), 0, 'tinmoon is airless');
settle(2, game);
assert.ok(Number.isFinite(R.camera.ceiling) && R.camera.ceiling > 0);
shape = R.sky.outline(luneIndex, game);
assert.ok(Number.isFinite(shape.centerX) && Number.isFinite(shape.nearY));

// ---------------------------------------------------------------------------
// Coast trace and the flown-trail ring buffer.
// ---------------------------------------------------------------------------

R.world.initialize('verdant');
game = { rocket: { wx: 0, wy: 0 }, simTime: 0 };
R.sky.reset();
settle(1, game);

var coastRocket = R.rocket.create(R.world.pads[0]);
var impact = R.trajectory.impact;
var coastTrace = R.trajectory.trace;

coastRocket.payloadMass = 1000;
coastRocket.wx = 0;
coastRocket.wy = 3000;
coastRocket.vx = 80;
coastRocket.vy = -40;
coastRocket.throttle = 0;
coastRocket.heading = 0;
R.trajectory.rollout(coastRocket, R.trajectory.coastStep, R.trajectory.maxCoastSteps, impact, coastTrace);
assert.ok(impact.valid, 'the coast reaches the ground inside the horizon');
assert.ok(coastTrace.count >= 2 && coastTrace.count <= R.trajectory.traceCapacity, 'trace is bounded');
close(coastTrace.points[0], coastRocket.wx, 1e-3, 'trace starts at the rocket longitude');
close(coastTrace.points[1], coastRocket.wy, 1e-3, 'trace starts at the rocket altitude');
assert.equal(coastTrace.points[(coastTrace.count - 1) * 2 + 1], 0, 'trace ends at the surface');

R.flightPath.reset();
game.phase = 'flying';
game.flight = {};
game.rocket.wy = 1000;
game.simTime = 0;
R.flightPath.sample(game);
assert.equal(R.flightPath.count, 1, 'the first sample lands');
for (i = 1; i < 12; i += 1) {
	game.simTime = i * R.constants.sky.trailInterval * 1.5;
	game.rocket.wx = i * 100;
	game.rocket.wy = 1000 + i * 50;
	R.flightPath.sample(game);
}
assert.ok(R.flightPath.count >= 5, 'sampling fills the ring');
assert.ok(R.flightPath.count <= R.flightPath.capacity, 'and never overflows it');
game.flight = {};
R.flightPath.sample(game);
assert.equal(R.flightPath.count, 1, 'a new flight record starts a new trail');
R.world.initialize('gossamer');
R.flightPath.sample(game);
assert.equal(R.flightPath.count, 1, 'a world switch starts a new trail');

console.log('Sky chart, pivot hand-over and projection tests passed.');
