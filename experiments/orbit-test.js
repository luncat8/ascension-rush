'use strict';

var assert = require('node:assert/strict');
var harness = require('./harness.js');
var R = harness.R;
var dt = R.constants.rocket.fixedStep;
var position = { x: 0, y: 0 };
var expected = { x: 0, y: 0 };

R.world.initialize('tinmoon');
R.camera.resize(1000, 600);
R.sky.reset();
R.sky.ensure();
var planet = R.world.planet;
var moon = R.constants.sky.bodies.find(function(body) { return body.id === 'lune'; });
var radius = moon.distanceRadii * planet.radius;
var altitude = radius - planet.radius;
var speed = R.physics.circularSpeedAtAltitude(altitude);
var game = harness.launch(R.world.pads[0], R.world.pads[1].id,
	harness.referenceBuild(planet, R.world.pads[1].id), 'balanced');
var rocket = game.rocket;
var seconds = 3000;
var i;

R.autopilot.setEnabled(false);
rocket.wx = moon.longitude * planet.circumference;
rocket.wy = altitude;
rocket.vx = speed;
rocket.vy = 0;
rocket.throttle = 0;
for (i = 0; i < seconds / dt; i += 1) {
	R.physics.step(game, dt);
}
R.coords.planeOfWorld(rocket.wx, rocket.wy, planet.radius, position);
R.sky.planePosition(moon, seconds, expected);
assert.ok(Math.hypot(position.x - expected.x, position.y - expected.y) < 1,
	'a circular coasting rocket follows a moon at the same radius on the same simulation clock');
assert.ok(Math.abs(rocket.wy - altitude) < 1, 'a circular orbit holds altitude');
assert.ok(Math.abs(rocket.vx - speed) < 0.001, 'a circular orbit holds tangential speed');

// Full, lower circular orbit through the real fixed-step integrator.
altitude = 1000;
radius = planet.radius + altitude;
speed = R.physics.circularSpeedAtAltitude(altitude);
var period = 2 * Math.PI * radius / speed;
var steps = Math.round(period / dt);
rocket.wx = 0;
rocket.wy = altitude;
rocket.vx = speed;
rocket.vy = 0;
for (i = 0; i < steps; i += 1) {
	R.physics.step(game, dt);
}
assert.equal(game.phase, 'flying');
assert.ok(Math.abs(rocket.wy - altitude) < 1, 'one full orbit stays above the surface');
assert.ok(Math.abs(rocket.wx / planet.radius - 2 * Math.PI) < 0.001, 'one orbit takes the Keplerian period');
assert.ok(Math.abs(rocket.vy) < 0.001, 'the radial velocity returns to zero');

// Escape and sub-orbital paths remain distinct from a circular coast.
var result = {};
var state = { wx: 0, wy: altitude, vx: speed * 0.3, vy: 0, heading: 0,
	payloadMass: 900, stageCount: 0, stages: [] };
R.trajectory.rollout(state, dt, 120000, result);
assert.ok(result.valid, 'a slower coast falls back to the surface');
state.vx = R.physics.escapeSpeedAtAltitude(altitude) * 1.1;
assert.ok(R.physics.isUnbound(state), 'escape is measured using the same central potential');
R.trajectory.rollout(state, dt, 120000, result);
assert.equal(result.valid, false, 'an escaping coast does not produce a ground impact');

// Circular angular rates are derived from each live world, not a fixed catalog rate.
R.planets.list.forEach(function(preset) {
	R.world.initialize(preset.id);
	R.sky.reset();
	R.sky.ensure();
	var r = moon.distanceRadii * R.world.planet.radius;
	var angularRate = Math.sqrt(R.physics.gravitationalParameter() / (r * r * r));
	R.sky.planePosition(moon, 1000, position);
	var angle = moon.longitude * 2 * Math.PI + angularRate * 1000;
	assert.ok(Math.hypot(position.x - r * Math.sin(angle), position.y - r * Math.cos(angle)) < 1e-6,
		preset.id + ' uses its own gravity and radius for the catalog orbit');
});
// Frame-rate and time-warp budgets move the craft on the same clock as the sky.
[1, 4].forEach(function(scale) {
	R.world.initialize('tinmoon');
	R.sky.reset();
	R.sky.ensure();
	var world = R.world.planet;
	var bodyRadius = moon.distanceRadii * world.radius;
	var shipGame = harness.launch(R.world.pads[0], R.world.pads[1].id,
		harness.referenceBuild(world, R.world.pads[1].id), 'balanced', scale);
	var ship = shipGame.rocket;
	var frame = 1 / 60;
	var frames = 6000;

	ship.wx = moon.longitude * world.circumference;
	ship.wy = bodyRadius - world.radius;
	ship.vx = R.physics.circularSpeedAtAltitude(ship.wy);
	ship.vy = 0;
	ship.throttle = 0;
	for (var n = 0; n < frames; n += 1) {
		R.physics.advance(shipGame, frame);
	}
	R.coords.planeOfWorld(ship.wx, ship.wy, world.radius, position);
	R.sky.planePosition(moon, frames * frame * scale, expected);
	assert.ok(Math.hypot(position.x - expected.x, position.y - expected.y) < 0.2,
		'time scale ' + scale + ' keeps the craft and body on the same clock');
});

R.planets.list.forEach(function(preset) {
	[1, 4].forEach(function(scale) {
		R.world.initialize(preset.id);
		var game = harness.launch(R.world.pads[0], R.world.pads[1].id,
			harness.referenceBuild(R.world.planet, R.world.pads[1].id), 'balanced', scale);
		var result = harness.fly(game, 1 / 60);
		assert.equal(result.status, 'delivered', preset.id + ' reference hop delivers at ' + scale + 'x');
	});
});
console.log('Orbital flight and catalog timing tests passed.');
