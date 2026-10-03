'use strict';

// Coast-impact predictor: equivalence with the live integrator, the physics
// invariants it has to respect, wrap-around longitudes, and the horizon.
// Accuracy over many states is measured, not asserted, by
// experiments/impact-accuracy.js.

var assert = require('node:assert/strict');
var harness = require('./harness.js');

var R = harness.R;
var trajectory = R.trajectory;
var step = R.constants.rocket.fixedStep;
var predicted = { wx: 0, vx: 0, vy: 0, seconds: 0, steps: 0, valid: false };
var comparison = { wx: 0, vx: 0, vy: 0, seconds: 0, steps: 0, valid: false };

// A coast state: the rollout reads the position, the velocity, the heading and
// the mass, so the mass rides along as payload and there are no stages.
function coastState(wx, wy, vx, vy, heading, mass) {
	return { wx: wx, wy: wy, vx: vx, vy: vy, heading: heading, payloadMass: mass, stageCount: 0, stages: [] };
}

function rangeOf(state, out) {
	return Math.abs(R.util.wrapDelta(out.wx - state.wx, R.world.planet.circumference));
}

function speedOf(out) {
	return Math.sqrt(out.vx * out.vx + out.vy * out.vy);
}

// ---- The rollout is the live integrator flying with the engine off.
R.world.initialize('verdant');
var liveGame = harness.launch(
	R.world.pads[0],
	R.world.pads[2].id,
	harness.referenceBuild(R.world.planet, R.world.pads[2].id),
	'balanced'
);
var coastRocket;
var elapsedBefore;

assert.ok(liveGame, 'the reference build launches');
while (liveGame.phase === 'flying' && liveGame.rocket.wy < 320) {
	R.controls.update(liveGame, step);
	R.physics.advance(liveGame, step);
}
R.autopilot.setEnabled(false);
coastRocket = liveGame.rocket;
coastRocket.throttle = 0;
elapsedBefore = liveGame.flight.elapsed;
trajectory.rollout(coastRocket, step, trajectory.maxCoastSteps, predicted);
assert.ok(predicted.valid, 'the coast from cruise reaches the ground inside the horizon');
while (liveGame.phase === 'flying') {
	R.physics.advance(liveGame, step);
}
// mission.touchdown replaces game.rocket and clears game.flight, but the flown
// state keeps its interpolated touchdown values and the report keeps the clock:
// together they are what the prediction is compared with.
assert.ok(Math.abs(R.util.wrapDelta(coastRocket.wx - predicted.wx, R.world.planet.circumference)) < 1e-6,
	'the rollout lands where an engine-off flight of the live integrator lands');
assert.ok(Math.abs(coastRocket.vx - predicted.vx) < 1e-9, 'and arrives with the same horizontal speed');
assert.ok(Math.abs(coastRocket.vy - predicted.vy) < 1e-9, 'and the same sink rate');
assert.ok(Math.abs(liveGame.lastReport.elapsed - elapsedBefore - predicted.seconds) < 1e-9, 'after the same time');

// ---- It reads the state and nothing else: no side effects, no allocations.
R.world.initialize('gossamer');
var sideEffectGame = harness.launch(
	R.world.pads[0],
	R.world.pads[1].id,
	harness.referenceBuild(R.world.planet, R.world.pads[1].id),
	'balanced'
);
var watched = sideEffectGame.rocket;
var before = {
	wx: watched.wx,
	wy: watched.wy,
	vx: watched.vx,
	vy: watched.vy,
	heading: watched.heading,
	throttle: watched.throttle,
	fuel: watched.stages[0].fuelMass,
	cash: sideEffectGame.cash,
	phase: sideEffectGame.phase
};

assert.equal(trajectory.predictCoast(watched, predicted), predicted, 'the prediction is written into the caller record');
assert.equal(watched.wx, before.wx, 'a prediction leaves the position alone');
assert.equal(watched.wy, before.wy);
assert.equal(watched.vx, before.vx);
assert.equal(watched.vy, before.vy);
assert.equal(watched.heading, before.heading, 'and the attitude alone');
assert.equal(watched.throttle, before.throttle, 'and the throttle alone');
assert.equal(watched.stages[0].fuelMass, before.fuel, 'a coast burns nothing');
assert.equal(sideEffectGame.cash, before.cash, 'a prediction touches no economy');
assert.equal(sideEffectGame.phase, before.phase, 'and ends no flight');

// ---- Vacuum: no drag, so heading is irrelevant and energy is conserved.
R.world.initialize('tinmoon');
var tinmoon = R.world.planet;
var vacuumState = coastState(1200, 500, 120, 40, 0.3, 900);
var gravitationalParameter = tinmoon.surfaceGravity * tinmoon.radius * tinmoon.radius;
var startSpeed = Math.sqrt(vacuumState.vx * vacuumState.vx + vacuumState.vy * vacuumState.vy);
var analyticSpeed = Math.sqrt(
	startSpeed * startSpeed +
	2 * gravitationalParameter * (1 / tinmoon.radius - 1 / (tinmoon.radius + vacuumState.wy))
);

trajectory.rollout(vacuumState, trajectory.coastStep, trajectory.maxCoastSteps, predicted);
assert.ok(predicted.valid, 'an airless coast lands inside the horizon');
assert.equal(predicted.vx, vacuumState.vx, 'with no atmosphere the horizontal speed never changes');
assert.ok(Math.abs(speedOf(predicted) - analyticSpeed) / analyticSpeed < 0.01,
	'the vacuum coast conserves energy against the inverse-square field');
vacuumState.heading = 2.4;
trajectory.rollout(vacuumState, trajectory.coastStep, trajectory.maxCoastSteps, comparison);
assert.equal(comparison.wx, predicted.wx, 'and attitude cannot change a drag-free trajectory');

// ---- Drag shortens the coast and slows the arrival.
R.world.initialize('gossamer');
var gossamer = R.world.planet;
var dragState = coastState(2000, 1500, 300, 0, Math.PI / 2, 900);
var savedDensity = gossamer.seaLevelDensity;

trajectory.rollout(dragState, trajectory.coastStep, trajectory.maxCoastSteps, predicted);
gossamer.seaLevelDensity = 0;
trajectory.rollout(dragState, trajectory.coastStep, trajectory.maxCoastSteps, comparison);
gossamer.seaLevelDensity = savedDensity;
assert.ok(predicted.valid && comparison.valid, 'both coasts land');
assert.ok(rangeOf(dragState, predicted) < rangeOf(dragState, comparison) * 0.9,
	'a heavy atmosphere carries the rocket noticeably less far');
assert.ok(speedOf(predicted) < speedOf(comparison), 'and bleeds off arrival speed');
assert.ok(predicted.seconds > comparison.seconds, 'the slower coast takes longer to fall');

// ---- Zero airspeed drops straight down.
R.world.initialize('verdant');
var stillState = coastState(1234, 200, 0, 0, 0.7, 500);

trajectory.predictCoast(stillState, predicted);
assert.ok(predicted.valid, 'a hover state has a coast impact');
assert.equal(predicted.wx, stillState.wx, 'with no airspeed the rocket lands where it is');
assert.equal(predicted.vx, 0);
assert.ok(predicted.vy < 0, 'and it is still descending at touchdown');
assert.ok(predicted.seconds > 0 && predicted.seconds < 60, 'the fall time is finite');

// ---- A ground state has no forecast, and neither does one beyond the horizon.
var grounded = coastState(500, 0, 30, 0, 0, 500);

trajectory.predictCoast(grounded, predicted);
assert.equal(predicted.valid, false, 'a rocket on the ground has no coast impact');
R.world.initialize('tinmoon');
var distant = coastState(500, 12000, 40, 0, 0, 500);

trajectory.predictCoast(distant, predicted);
assert.equal(predicted.valid, false, 'a coast longer than the horizon is reported invalid, not stale');
trajectory.rollout(distant, trajectory.coastStep, trajectory.maxCoastSteps * 8, comparison);
assert.ok(comparison.valid, 'the same state does reach the ground given the steps');
assert.ok(comparison.seconds > trajectory.coastHorizon, 'and it is the horizon that cut the prediction short');

// ---- Wrap-around longitudes and the relation to the selected pad.
R.world.initialize('verdant');
var circumference = R.world.planet.circumference;
var wrapGame = {
	phase: 'flying',
	targetPadId: R.world.pads[0].id,
	rocket: coastState(circumference - 100, 100, 200, -20, Math.PI / 2, 700)
};
var impact = trajectory.update(wrapGame);

assert.equal(impact, trajectory.impact, 'the per-frame prediction writes the shared impact record');
assert.ok(impact.valid, 'a coast across the wrap seam is predicted');
assert.ok(impact.wx > circumference, 'the impact longitude stays unbounded, like the live position');
assert.ok(Math.abs(impact.targetError) < circumference / 2, 'the pad error is the wrap-aware distance');
assert.ok(impact.targetError > 0, 'and east of the pad, not almost a whole world west of it');
assert.equal(impact.onTargetPad, Math.abs(impact.targetError) <= R.world.planet.landingRadius,
	'the pad flag follows the world landing radius');
assert.equal(impact.safeTouchdown,
	Math.abs(impact.vy) <= R.world.planet.landingVerticalSpeed && Math.abs(impact.vx) <= R.world.planet.landingHorizontalSpeed,
	'the safety flag follows the world touchdown limits');

R.camera.resize(1000, 600);
R.camera.follow(circumference - 100);
var markerX = trajectory.markerX(impact);

assert.ok(markerX >= R.camera.leftWx && markerX < R.camera.leftWx + circumference,
	'the marker is drawn from the viewport periodic copy of the impact');
assert.ok(Math.abs(R.util.wrapDelta(markerX - impact.wx, circumference)) < 1e-6,
	'which is the same ground the impact longitude names');

// A long coast to the west lands behind the viewport's left edge: the same
// ground is visible as the periodic copy, so the marker must stay on screen.
R.world.initialize('tinmoon');
var westGame = {
	phase: 'flying',
	targetPadId: R.world.pads[0].id,
	rocket: coastState(R.world.planet.circumference * 0.5, 1200, -320, 0, -Math.PI / 2, 700)
};
var westImpact = trajectory.update(westGame);

R.camera.follow(westGame.rocket.wx);
assert.ok(westImpact.valid, 'the long airless coast is inside the horizon');
assert.ok(westImpact.wx < R.camera.leftWx, 'and its raw longitude falls off the left of the viewport');
markerX = trajectory.markerX(westImpact);
assert.ok(markerX >= R.camera.leftWx && markerX < R.camera.leftWx + R.world.planet.circumference,
	'the periodic copy puts it back inside the viewport');
assert.ok(Math.abs(R.util.wrapDelta(markerX - westImpact.wx, R.world.planet.circumference)) < 1e-6,
	'without moving the ground it names');
R.world.initialize('verdant');

wrapGame.phase = 'building';
assert.equal(trajectory.update(wrapGame).valid, false, 'no forecast is published while not flying');
wrapGame.phase = 'flying';
wrapGame.rocket.wy = 0;
assert.equal(trajectory.update(wrapGame).valid, false, 'or while on the ground');

// ---- A whole flight keeps publishing a forecast the HUD can show.
R.world.initialize('cinder');
var flownGame = harness.launch(
	R.world.pads[0],
	R.world.pads[2].id,
	harness.referenceBuild(R.world.planet, R.world.pads[2].id),
	'balanced'
);
var airborne = 0;
var forecasts = 0;

assert.ok(flownGame, 'the cinder reference build launches');
while (flownGame.phase === 'flying' && flownGame.flight.elapsed < harness.maxSeconds) {
	R.controls.update(flownGame, step);
	R.physics.advance(flownGame, step);
	trajectory.update(flownGame);
	if (flownGame.rocket.wy > 0) {
		airborne += 1;
		forecasts += R.trajectory.impact.valid ? 1 : 0;
		assert.ok(Number.isFinite(R.trajectory.impact.wx), 'every airborne frame has a finite impact longitude');
	}
}
assert.equal(flownGame.lastReport.status, 'delivered', 'the flight the forecast was sampled from delivers');
assert.ok(airborne > 1000, 'the flight spent time airborne');
assert.equal(forecasts, airborne, 'every airborne step of a normal flight has a coast impact');
assert.ok(Math.abs(flownGame.lastReport.touchdownVerticalSpeed) <= R.world.planet.landingVerticalSpeed,
	'the debrief quotes the measured touchdown sink rate');
assert.ok(Math.abs(flownGame.lastReport.targetError) <= R.world.planet.landingRadius,
	'and a delivered flight reports a pad error inside the landing radius');

console.log('Trajectory and coast-impact tests passed.');
