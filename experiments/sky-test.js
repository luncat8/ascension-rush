'use strict';

// Inter-planet sky slice: GM / escape speed, atmosphere ceiling, an eased and
// still-invertible log scale, azimuthal body projection, coast trace and the
// flown-trail ring buffer. No physics input is changed by any of it.

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
var projection = {
	x: 0, y: 0, radius: 0, elevation: 0, azimuth: 0, visible: false,
	shade: 0, distance: 0, angularRadius: 0
};
var game;
var planet;
var mu;
var i;
var y;
var previousY;
var body;
var maxAngle;
var expectedRadius;
var airTop;
var oldCeiling;
var impact;
var trace;
var coastRocket;

function close(actual, expected, tolerance, label) {
	assert.ok(Math.abs(actual - expected) <= tolerance, label + ': ' + actual + ' vs ' + expected);
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
	'escape = sqrt(2) * circular');
close(R.physics.gravityAtAltitude(1000), mu / Math.pow(planet.radius + 1000, 2), 1e-9,
	'gravity is the derivative of the same potential');
assert.ok(R.physics.escapeSpeedAtAltitude(1000) < R.physics.escapeSpeedAtAltitude(0));

airTop = R.physics.atmosphereTop();
close(airTop, planet.atmosphereScaleHeight * Math.log(1 / R.constants.sky.atmosphereDensityFraction),
	1e-9, 'atmosphere ceiling from the density fraction');
close(R.physics.densityAtAltitude(airTop) / planet.seaLevelDensity,
	R.constants.sky.atmosphereDensityFraction, 1e-9, 'density at the ceiling');
assert.ok(!R.physics.isUnbound({ wx: 0, wy: 0, vx: 1e6, vy: 0 }), 'the pad is not in space');
assert.ok(R.physics.isUnbound({ wx: 0, wy: airTop + 1, vx: R.physics.escapeSpeedAtAltitude(airTop + 1) + 1, vy: 0 }),
	'an above-atmosphere rocket at escape speed is unbound');

game = {
	phase: 'flying',
	simTime: 0,
	flight: {},
	rocket: R.rocket.create(R.world.pads[0])
};
R.sky.update(game, 0);
assert.equal(R.sky.view.planetId, 'verdant');
assert.equal(R.camera.logScale, planet.logAltitudeScale, 'deck keeps the world log scale');
assert.equal(R.camera.ceiling, planet.maxAltitude, 'and the world ceiling');
close(R.camera.altitudeLogRange, Math.log1p(planet.maxAltitude / planet.logAltitudeScale), 1e-12,
	'log range matches the ceiling');

// A high climb expands the ceiling and moves the log knee toward the nearest
// body, without breaking the forward / inverse transform.
game.rocket.wy = 60000;
for (i = 0; i < 80; i += 1) {
	R.sky.update(game, 0.016);
}
assert.ok(R.camera.ceiling > planet.maxAltitude * 2, 'the ceiling follows the climb');
assert.ok(R.camera.logScale > planet.logAltitudeScale, 'the log knee follows the approached body');
assert.ok(R.sky.focus.approach > 0.5, 'a high rocket is approaching a catalog body');
assert.ok(Number.isFinite(R.camera.altitudeLogRange) && R.camera.altitudeLogRange > 0);

previousY = Infinity;
var altitudes = [0, 100, airTop, planet.maxAltitude, R.camera.ceiling];
for (i = 0; i < altitudes.length; i += 1) {
	R.camera.project(0, altitudes[i], screen);
	R.camera.unproject(screen.x, screen.y, worldPoint);
	close(worldPoint.y, altitudes[i], Math.max(1, altitudes[i]) * 1e-6,
		'log round trip at altitude ' + altitudes[i]);
	y = screen.y;
	assert.ok(y < previousY, 'screen y is monotonic in altitude');
	previousY = y;
}
close(R.physics.gravityAtAltitude(1000), mu / Math.pow(planet.radius + 1000, 2), 1e-9,
	'sky easing does not touch physics');

// A world switch morphs gravity, radius, air ceiling and camera range from
// the outgoing values; nothing snaps on the first frame.
oldCeiling = R.camera.ceiling;
R.world.initialize('cinder');
R.sky.update(game, 0);
assert.equal(R.sky.view.planetId, 'cinder');
assert.equal(R.sky.view.morph, 0, 'the morph starts at zero');
close(R.camera.ceiling, oldCeiling, 1e-9, 'the first frame keeps the outgoing scale');
for (i = 0; i < 80; i += 1) {
	R.sky.update(game, 0.016);
}
assert.equal(R.sky.view.morph, 1, 'the morph completes');
close(R.sky.view.gravity, R.world.planet.surfaceGravity, 1e-9, 'gravity reaches the new world');
close(R.sky.view.radius, R.world.planet.radius, 1e-9, 'radius reaches the new world');
close(R.sky.view.atmosphereTop, R.physics.atmosphereTop(), 1e-9, 'air ceiling reaches the new world');
assert.ok(R.camera.ceiling > R.world.planet.maxAltitude, 'and the camera range follows');

// Body projection: direction, angular size and the horizon test.
R.world.initialize('verdant');
R.camera.resize(1440, 900);
game.rocket.wx = 0;
game.rocket.wy = 0;
game.simTime = 0;
for (i = 0; i < 80; i += 1) {
	R.sky.update(game, 0.016);
}
for (i = 0; i < R.constants.sky.bodies.length; i += 1) {
	body = R.constants.sky.bodies[i];
	R.sky.projectBody(body, game, projection);
	assert.ok(projection.visible, body.name + ' is above the home horizon');
	assert.ok(projection.x > -R.camera.width && projection.x < R.camera.width * 2,
		body.name + ' stays near the viewport');
	assert.ok(projection.y >= 0 && projection.y <= R.camera.groundY,
		body.name + ' stays in the sky band');
	maxAngle = Math.max(0.2, Math.min(R.constants.view.skyHorizonAngle,
		Math.acos(R.sky.view.radius / (body.distanceRadii * R.sky.view.radius))));
	expectedRadius = projection.angularRadius / maxAngle * R.camera.width * 0.5;
	expectedRadius = R.util.clamp(expectedRadius, R.constants.view.minBodyRadius,
		R.constants.view.maxBodyRadius);
	close(projection.radius, expectedRadius, 1e-9, body.name + ' apparent radius');
	close(projection.angularRadius,
		Math.asin((body.radiusRadii * R.sky.view.radius) / projection.distance), 1e-9,
		body.name + ' angular radius');
}
game.rocket.wx = planet.circumference * 0.5;
R.sky.projectBody(R.constants.sky.bodies[0], game, projection);
assert.equal(projection.visible, false, 'a body on the far side is hidden');
assert.ok(projection.elevation < 0, 'and its elevation is below the horizon');

// The coast trace is a strided copy of the same rollout, ending at the ground.
coastRocket = R.rocket.create(R.world.pads[0]);
coastRocket.payloadMass = 1000;
coastRocket.wx = 0;
coastRocket.wy = 3000;
coastRocket.vx = 80;
coastRocket.vy = -40;
coastRocket.throttle = 0;
coastRocket.heading = 0;
impact = R.trajectory.impact;
trace = R.trajectory.trace;
R.trajectory.rollout(coastRocket, R.trajectory.coastStep, R.trajectory.maxCoastSteps, impact, trace);
assert.ok(impact.valid, 'the coast reaches the ground inside the horizon');
assert.ok(trace.count >= 2 && trace.count <= R.trajectory.traceCapacity, 'trace is bounded');
close(trace.points[0], coastRocket.wx, 1e-3, 'trace starts at the rocket longitude');
close(trace.points[1], coastRocket.wy, 1e-3, 'trace starts at the rocket altitude');
close(trace.points[(trace.count - 1) * 2], impact.wx, 1e-3, 'trace ends at the impact longitude');
assert.equal(trace.points[(trace.count - 1) * 2 + 1], 0, 'trace ends at the surface');
coastRocket.wy = 0;
R.trajectory.predictCoast(coastRocket, impact, trace);
assert.equal(trace.count, 0, 'a grounded rocket has no forecast path');

// The flown trail is a ring that resets with a new leg or a new world.
R.flightPath.reset();
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

// Airless worlds have no ceiling line and still project their sky.
R.sky.update(game, 0);
for (i = 0; i < 80; i += 1) {
	R.sky.update(game, 0.016);
}
assert.ok(R.physics.atmosphereTop() > 0, 'a deep atmosphere has a ceiling line');
R.world.initialize('tinmoon');
R.sky.update(game, 0);
assert.equal(R.physics.atmosphereTop(), 0, 'tinmoon is airless');
for (i = 0; i < 80; i += 1) {
	R.sky.update(game, 0.016);
}
assert.ok(Number.isFinite(R.camera.ceiling) && R.camera.ceiling > 0);
R.sky.projectBody(R.constants.sky.bodies[3], game, projection);
assert.ok(Number.isFinite(projection.x) && Number.isFinite(projection.radius));

console.log('Sky, escape speed and projection tests passed.');
