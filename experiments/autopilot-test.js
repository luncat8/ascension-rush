'use strict';

var assert = require('node:assert/strict');
var harness = require('./harness.js');

var R = harness.R;
var flags = R.autopilot.limitFlags;
var settings = R.constants.autopilot;
var degrees = Math.PI / 180;
var step = R.constants.rocket.fixedStep;
var planetIds = ['verdant', 'tinmoon', 'cinder', 'gossamer'];
var withLimits = harness.withLimits;

function launchReference(sourceIndex, targetIndex, profileId, build) {
	var target = R.world.pads[targetIndex];
	var game = harness.launch(R.world.pads[sourceIndex], target.id, build || harness.referenceBuild(R.world.planet, target.id), profileId || 'balanced');

	assert.ok(game, 'the build launches');
	return game;
}

function thrustOf(game) {
	var rocket = game.rocket;
	var command = R.autopilot.command;
	var accel = command.throttle * R.rocket.activeStage(rocket).thrustMax / R.rocket.totalMass(rocket);

	return { x: accel * Math.sin(command.heading), y: accel * Math.cos(command.heading), accel: accel };
}

function commandAngleOfAttack(game) {
	var rocket = game.rocket;
	var heading = R.autopilot.command.heading;
	var speed = Math.sqrt(rocket.vx * rocket.vx + rocket.vy * rocket.vy);
	var alignment = (Math.sin(heading) * rocket.vx + Math.cos(heading) * rocket.vy) / speed;

	return Math.acos(Math.min(1, Math.abs(alignment)));
}

// The command the guidance gives for one flight state, under given limits.
// Homeport to Farport (10 km) cruises toward +x at 800 m and wants to keep
// accelerating well past the speeds probed here.
function probe(limits, state, build, profileId) {
	return withLimits(limits, function() {
		var game = launchReference(0, 2, profileId, build);

		Object.assign(game.rocket, state);
		R.autopilot.update(game);
		return {
			thrust: thrustOf(game),
			heading: R.autopilot.command.heading,
			throttle: R.autopilot.command.throttle,
			limiter: R.autopilot.limiter,
			angleOfAttack: commandAngleOfAttack(game),
			game: game
		};
	});
}

function pressureBand(altitude, speed, cap) {
	var pressure = R.aerodynamics.dynamicPressure(R.physics.densityAtAltitude(altitude), speed);

	return R.util.clamp((pressure - settings.qFadeStartFraction * cap) / (cap - settings.qFadeStartFraction * cap), 0, 1);
}

// ---- Limits resolve once per flight, scaled by the profile.
R.world.initialize('verdant');
var verdant = R.world.planet;
var balanced = Object.assign({}, R.autopilot.tuningFor(verdant, 'balanced'));
var gentle = Object.assign({}, R.autopilot.tuningFor(verdant, 'gentle'));
var gentleProfile = R.autopilot.profileById('gentle');

assert.equal(balanced.pressureCap, verdant.flight.maxDynamicPressure, 'balanced uses the planet limits unscaled');
assert.equal(balanced.pressureFadeStart, balanced.pressureCap * settings.qFadeStartFraction);
assert.equal(balanced.accelerationCap, verdant.flight.maxThrustAcceleration);
assert.ok(Math.abs(balanced.angleCap - verdant.flight.maxAngleOfAttackDeg * degrees) < 1e-12, 'angle tuning is degrees, resolved to radians');
assert.equal(gentle.pressureCap, verdant.flight.maxDynamicPressure * gentleProfile.dynamicPressure, 'gentle scales the pressure cap');
assert.equal(gentle.accelerationCap, verdant.flight.maxThrustAcceleration * gentleProfile.thrustAcceleration);
assert.ok(Math.abs(gentle.angleCap - balanced.angleCap * gentleProfile.angleOfAttack) < 1e-12);

planetIds.forEach(function(planetId) {
	var planet;
	var loose;
	var tight;

	R.world.initialize(planetId);
	planet = R.world.planet;
	loose = Object.assign({}, R.autopilot.tuningFor(planet, 'balanced'));
	tight = Object.assign({}, R.autopilot.tuningFor(planet, 'gentle'));
	assert.ok(tight.pressureCap <= loose.pressureCap, planetId + ' gentle never raises the pressure cap');
	assert.ok(tight.accelerationCap <= loose.accelerationCap, planetId + ' gentle never raises the acceleration cap');
	assert.ok(tight.angleCap <= loose.angleCap, planetId + ' gentle never loosens the angle limit');
	assert.ok(tight.accelerationCap >= settings.minThrustToWeight * planet.surfaceGravity, planetId + ' cap keeps the landing margin');
});
R.world.initialize('tinmoon');
assert.equal(R.autopilot.tuningFor(R.world.planet, 'balanced').pressureCap, 0, 'an airless world has no pressure limit');
assert.equal(R.autopilot.tuningFor(R.world.planet, 'balanced').angleCap, Math.PI / 2, 'and no angle limit');
R.world.initialize('cinder');
assert.equal(
	R.autopilot.tuningFor(R.world.planet, 'gentle').accelerationCap,
	settings.minThrustToWeight * R.world.planet.surfaceGravity,
	'the gravity floor wins when a profile would leave the landing too little thrust'
);

var bare = { id: 'bare', surfaceGravity: 3, flight: { maxDynamicPressure: 0, maxThrustAcceleration: null } };
var bareTuning = R.autopilot.tuningFor(bare, 'balanced');

assert.equal(bareTuning.pressureCap, 0, 'zero disables the pressure limit');
assert.equal(bareTuning.accelerationCap, Infinity, 'null disables the acceleration limit');
assert.equal(bareTuning.angleCap, Math.PI / 2, 'an absent limit disables the angle limit');

// The cache survives updates and is dropped by a reset.
bare.flight.maxThrustAcceleration = 20;
assert.equal(R.autopilot.tuningFor(bare, 'balanced').accelerationCap, Infinity, 'resolved limits are cached for the flight');
R.autopilot.reset();
assert.equal(R.autopilot.tuningFor(bare, 'balanced').accelerationCap, 20, 'a reset re-reads the limits');
assert.equal(R.autopilot.tuningFor(bare, 'gentle').accelerationCap, Math.max(20 * gentleProfile.thrustAcceleration, settings.minThrustToWeight * 3), 'a profile change resolves again');
assert.equal(R.autopilot.setProfile('reckless'), false, 'unknown profiles are refused');
assert.equal(R.autopilot.profileId, 'balanced');

// ---- The profile is snapshotted into the flight at launch.
R.world.initialize('verdant');
R.autopilot.setProfile('gentle');
var snapshotGame = launchReference(0, 2, 'gentle');

assert.equal(snapshotGame.flight.autopilotProfile, 'gentle');
R.autopilot.setProfile('balanced');
assert.equal(snapshotGame.flight.autopilotProfile, 'gentle', 'changing the builder choice does not touch a flight in progress');

// ---- Q fade: forward thrust fades toward the cap; braking and lift stay.
var cap = verdant.flight.maxDynamicPressure;
var cruise = { wx: 1500, wy: 800, vy: 0, heading: Math.PI / 2 };
var below = probe({ maxDynamicPressure: cap }, Object.assign({ vx: 200 }, cruise));

assert.equal(below.limiter, 0, 'nothing limits a flight below the fade band');

[310, 330, 350].forEach(function(speed) {
	var state = Object.assign({ vx: speed }, cruise);
	var free = probe({}, state);
	var limited = probe({ maxDynamicPressure: cap }, state);
	var band = pressureBand(800, speed, cap);

	assert.ok(band > 0 && band <= 1, 'the test state is inside the band');
	assert.ok(Math.abs(limited.thrust.x - (1 - band) * free.thrust.x) < 1e-6, 'forward thrust fades linearly with the band at ' + speed + ' m/s');
	assert.ok(Math.abs(limited.thrust.y - free.thrust.y) < 1e-6, 'sideways (lift) thrust is untouched at ' + speed + ' m/s');
	assert.ok(limited.limiter & flags.Q, 'the HUD reports the Q limiter at ' + speed + ' m/s');
	assert.ok(!(limited.limiter & flags.AOA) && !(limited.limiter & flags.ACCEL), 'only the Q limiter is set');
});

var pastCap = probe({ maxDynamicPressure: cap }, Object.assign({ vx: 400 }, cruise));

assert.ok(Math.abs(pastCap.thrust.x) < 1e-6, 'no forward thrust is left at the cap');
assert.ok(pastCap.thrust.y > 0, 'but the rocket still holds its altitude');

var overshoot = { wx: 11000, wy: 800, vx: 330, vy: 0, heading: Math.PI / 2 };
var brakingFree = probe({}, overshoot);
var brakingLimited = probe({ maxDynamicPressure: cap }, overshoot);

assert.ok(brakingFree.thrust.x < 0, 'past the pad the guidance brakes');
assert.ok(Math.abs(brakingLimited.thrust.x - brakingFree.thrust.x) < 1e-6 && Math.abs(brakingLimited.thrust.y - brakingFree.thrust.y) < 1e-6, 'braking is never faded');
assert.equal(brakingLimited.limiter & flags.Q, 0, 'and is not reported as limiting');

// ---- Acceleration cap: applied before guidance plans, from the first light-off.
var hotBuild = {
	targetPadId: R.world.pads[2].id,
	stageCount: 1,
	payloadMass: 80,
	stages: [{ fuelMass: 900, strength: 0.9 }, { fuelMass: 100, strength: 0.9 }, { fuelMass: 100, strength: 0.9 }]
};
var hotFree = probe({}, { wx: 0, wy: 100, vy: 30 }, hotBuild);
var hotCapped = probe({ maxThrustAcceleration: 30 }, { wx: 0, wy: 100, vy: 30 }, hotBuild);

assert.ok(hotFree.thrust.accel > 35, 'a single stage that lifts off at 42 m/s² commands more than the cap allows');
assert.ok(hotCapped.thrust.accel <= 30 + 1e-9, 'the commanded acceleration never exceeds the cap');
assert.ok(hotCapped.limiter & flags.ACCEL, 'the HUD reports the acceleration limiter');
var ignition = withLimits({ maxThrustAcceleration: 30 }, function() {
	var rocket = launchReference(0, 2, 'balanced', hotBuild).rocket;

	return rocket.throttle * R.rocket.activeStage(rocket).thrustMax / R.rocket.totalMass(rocket);
});

assert.ok(ignition > 25 && ignition <= 30 + 1e-9, 'an autopilot launch lights the engine at the acceleration it was allowed, not at full throttle');
assert.equal(withLimits({ maxThrustAcceleration: 30 }, function() {
	var game = harness.createGame(R.world.pads[0], R.world.pads[2].id);

	R.autopilot.setEnabled(false);
	R.mission.launch(game, hotBuild);
	return game.rocket.throttle;
}), 1, 'a player launch still lights the engine at full throttle');

var cappedFlight = withLimits({ maxThrustAcceleration: 30 }, function() {
	return harness.fly(launchReference(0, 2, 'balanced', hotBuild), step);
});

assert.equal(cappedFlight.status, 'delivered', 'a capped hot build still delivers');
assert.ok(cappedFlight.maxCommandAcceleration <= 30 + 1e-9, 'no command in the flight exceeds the cap');
assert.ok(cappedFlight.flight.peakAppliedThrustAcceleration <= 30 + 1e-9, 'the thrust actually applied, stage ignitions included, stays at the cap');

var stagedGame = launchReference(0, 2, 'balanced');

stagedGame.rocket.stages[0].fuelMass = 0.4;
stagedGame.rocket.throttle = 0.6;
R.controls.update(stagedGame, step);
assert.equal(stagedGame.rocket.currentStage, 1, 'the autopilot stages a dry booster');
assert.ok(stagedGame.rocket.throttle < 0.7, 'and the next stage lights at the throttle the autopilot was holding');

// ---- AoA clamp: a backstop inside the band that cannot starve weight support.
var lateral = Object.assign({ vx: 400 }, cruise);
var angleLimits = { maxDynamicPressure: cap, maxAngleOfAttackDeg: 55 };
var unclamped = probe({ maxDynamicPressure: cap }, lateral);
var clamped = probe(angleLimits, lateral);

assert.ok(Math.abs(unclamped.angleOfAttack - Math.PI / 2) < 1e-6, 'with the forward thrust faded, lift alone flies broadside');
assert.ok(clamped.angleOfAttack < unclamped.angleOfAttack - 0.2, 'the angle limit pulls the axis toward the airflow');
assert.ok(clamped.limiter & flags.AOA, 'the HUD reports the angle limiter');
assert.equal(probe(angleLimits, Object.assign({ vx: 200 }, cruise)).limiter & flags.AOA, 0, 'the angle limit is released below the band');
assert.ok(Math.abs(probe(angleLimits, Object.assign({ vx: 200 }, cruise)).thrust.y - probe({}, Object.assign({ vx: 200 }, cruise)).thrust.y) < 1e-6, 'and then changes nothing');

var tightAngle = probe({ maxDynamicPressure: cap, maxAngleOfAttackDeg: 5 }, lateral);
var liftStage = R.rocket.activeStage(tightAngle.game.rocket);
var liftBudget = settings.thrustReserve * liftStage.thrustMax / R.rocket.totalMass(tightAngle.game.rocket);
var floor = Math.asin(Math.sqrt(settings.weightSupportMargin * R.physics.gravityAtAltitude(800) / liftBudget));

assert.ok(Math.abs(tightAngle.angleOfAttack - floor) < 0.5 * degrees, 'a tighter limit is raised to the angle that still carries the weight');

var noseForward = probe(angleLimits, Object.assign({}, lateral, { heading: Math.PI / 2 }));
var noseBack = probe(angleLimits, Object.assign({}, lateral, { heading: -Math.PI / 2 }));

assert.ok(Math.cos(noseForward.heading - Math.PI / 2) > 0, 'a sideways request keeps a forward-pointing axis on the forward side');
assert.ok(Math.cos(noseBack.heading - Math.PI / 2) < 0, 'and a backward-pointing axis on the backward side, so the axis does not flip');

R.world.initialize('tinmoon');
var airless = probe({ maxDynamicPressure: 1, maxAngleOfAttackDeg: 5 }, Object.assign({ vx: 300 }, cruise));

assert.equal(airless.limiter & (flags.Q | flags.AOA), 0, 'the pressure and angle limits never engage without an atmosphere');
R.world.initialize('verdant');

// ---- Autopilot off: nothing is limited and the command layer stays idle.
R.autopilot.setEnabled(false);
R.autopilot.update(snapshotGame);
assert.equal(R.autopilot.limiter, 0, 'manual flight has no limiter state');
assert.equal(R.autopilot.limiterLabel(), '');
R.autopilot.limiter = flags.Q | flags.ACCEL | flags.AOA;
assert.equal(R.autopilot.limiterLabel(), 'Q + ACCEL + AOA LIMIT');
R.autopilot.limiter = 0;

// A flight keeps the profile it launched with when the choice changes mid-flight.
var midflightState = Object.assign({ vx: 340 }, cruise);
var reference = probe({ maxDynamicPressure: cap }, midflightState, undefined, 'balanced');

withLimits({ maxDynamicPressure: cap }, function() {
	var game = launchReference(0, 2, 'balanced');

	Object.assign(game.rocket, midflightState);
	R.autopilot.setProfile('gentle');
	R.autopilot.update(game);
	assert.ok(Math.abs(thrustOf(game).x - reference.thrust.x) < 1e-9, 'a mid-flight profile change leaves the flight on its snapshot');
	R.autopilot.setProfile('balanced');
});

// ---- Whole flights: delivery, envelope, valid commands, no oscillation.
function fly(planetId, sourceIndex, targetIndex, profileId, frameDt, timeScale, limits) {
	R.world.initialize(planetId);
	return withLimits(limits || R.world.planet.flight, function() {
		var target = R.world.pads[targetIndex];
		var game = harness.launch(R.world.pads[sourceIndex], target.id, harness.referenceBuild(R.world.planet, target.id), profileId, timeScale);

		return harness.fly(game, frameDt);
	});
}

// A short and a long hop from each world's first pad, as pad index pairs.
var routes = {
	verdant: [[0, 1], [0, 2]],
	tinmoon: [[0, 1], [0, 2]],
	cinder: [[0, 1], [0, 2]],
	gossamer: [[0, 1], [0, 2]]
};

planetIds.forEach(function(planetId) {
	routes[planetId].forEach(function(route, routeIndex) {
		var free = fly(planetId, route[0], route[1], 'balanced', step, 1, {});
		var normal = fly(planetId, route[0], route[1], 'balanced', step, 1);
		var soft = fly(planetId, route[0], route[1], 'gentle', step, 1);
		var label = planetId + ' ' + route.join('>');
		var planet = R.world.planet;
		var tuning;

		assert.equal(free.status, 'delivered', label + ' unlimited reference flight delivers');
		assert.equal(normal.status, 'delivered', label + ' balanced delivers');
		assert.equal(soft.status, 'delivered', label + ' gentle lands safely');
		assert.ok(normal.seconds < free.seconds * 1.06 + 1, label + ' balanced keeps the unlimited pacing');
		assert.ok(soft.seconds < free.seconds * 1.15 + 1, label + ' gentle stays within a sane pace');
		assert.ok(soft.flight.peakAppliedThrustAcceleration < normal.flight.peakAppliedThrustAcceleration * 0.95, label + ' gentle accelerates less');
		if (planet.seaLevelDensity > 0) {
			assert.ok(normal.flight.peakDynamicPressure <= free.flight.peakDynamicPressure, label + ' balanced never raises the peak pressure');
			assert.ok(routeIndex === 0 || normal.flight.peakDynamicPressure < free.flight.peakDynamicPressure * 0.9, label + ' balanced trims the long hop');
			assert.ok(soft.flight.peakDynamicPressure < normal.flight.peakDynamicPressure * 0.85, label + ' gentle lowers it measurably further');
			assert.ok(normal.sideFlips <= free.sideFlips + 2 && soft.sideFlips <= free.sideFlips + 2, label + ' the limits add no axis flips');
		}
		[normal, soft].forEach(function(result, index) {
			tuning = R.autopilot.tuningFor(planet, index ? 'gentle' : 'balanced');
			assert.ok(result.commandsValid, label + ' every command is finite and within throttle limits');
			assert.ok(result.limiterToggles.Q <= 2 && result.limiterToggles.AOA <= 2 && result.limiterToggles.ACCEL <= 6, label + ' no limiter flickers on and off');
			assert.ok(result.maxCommandAcceleration <= tuning.accelerationCap + 1e-9, label + ' no command exceeds the acceleration cap');
			assert.ok(result.flight.peakAppliedThrustAcceleration <= tuning.accelerationCap + 1e-9, label + ' applied thrust, ignitions included, stays at the cap');
			assert.ok(result.reclimb < 30, label + ' the landing descends without climbing back');
			assert.equal(result.report.landingPadId, R.world.pads[route[1]].id, label + ' lands on the target pad');
		});
	});
});

// The same flights through the frame loop at other frame rates and time scales.
var frames = [[60, 0.5], [60, 2], [30, 4], [144, 4]];

planetIds.forEach(function(planetId) {
	routes[planetId].forEach(function(route) {
		['balanced', 'gentle'].forEach(function(profileId) {
			var steady = fly(planetId, route[0], route[1], profileId, step, 1);

			frames.forEach(function(frame) {
				var result = fly(planetId, route[0], route[1], profileId, 1 / frame[0], frame[1]);
				var label = planetId + ' ' + route.join('>') + ' ' + profileId + ' at ' + frame[0] + ' fps x' + frame[1];

				assert.equal(result.status, 'delivered', label + ' delivers');
				assert.ok(Math.abs(result.seconds - steady.seconds) < 2, label + ' takes the same time');
				assert.ok(result.flight.peakDynamicPressure < steady.flight.peakDynamicPressure * 1.1 + 100, label + ' keeps the same envelope');
				assert.ok(result.commandsValid, label + ' commands stay valid');
			});
		});
	});
});

console.log('Autopilot envelope tests passed.');
