'use strict';

// Inter-planet chart slice: GM / escape speed, the lens projection of every
// catalog body through the chart's own law, the ground curve and the orbits, the
// drag that unwraps the chart onto another body, the hand-over that seats it
// there, coast trace and the flown-trail ring buffer. No physics input is
// changed by any of it.

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
var plane = { x: 0, y: 0 };
var shape;
var orbit;
var game;
var planet;
var mu;
var i;

function close(actual, expected, tolerance, label) {
	assert.ok(Math.abs(actual - expected) <= tolerance, label + ': ' + actual + ' vs ' + expected);
}

function settle(seconds, theGame) {
	var frames = Math.round(seconds / 0.016);
	var f;

	for (f = 0; f < frames; f += 1) {
		R.sky.update(theGame || game, 0.016);
	}
}

// The chart's own Y law, written out independently of coords.js: one log ladder
// above the ladder's start on the live knee, a gentler slope beyond the switch
// altitude, and a single log below it so a cutaway stays shallow.
function ladderOf(height) {
	var q = Math.log1p(Math.max(0, height) / R.camera.logScale);
	var q0 = R.camera.ladderQ0;

	return q <= q0 ? q : q0 + (q - q0) * R.camera.ladderFar;
}

function chartY(distance) {
	var delta = distance - R.camera.ladderRef;

	if (delta >= 0) {
		return R.camera.oy - R.camera.scale * ladderOf(delta);
	}
	return R.camera.oy + R.camera.scale * Math.log(R.camera.ladderRef / Math.max(1e-9, distance));
}

// A hand-over must not cut. The law that guarantees it: the anchor's screen
// place is the place the camera publishes for it every frame, it starts where
// the gesture started, it moves a bounded distance per frame, and the frame
// after it ends reproduces the destination pose with no correction left.
function handOver(from, to, label) {
	var frames = 0;
	var jump = 0;
	var previousX = 0;
	var previousY = 0;
	var startX;
	var startY;
	var endX;
	var endY;

	R.sky.reset();
	settle(3);
	if (from >= -1 && from !== R.sky.pivot.index) {
		assert.ok(R.sky.seatPivot(from, game), label + ': the first seat is accepted');
		while (R.camera.transition.active) {
			R.sky.update(game, 0.016);
		}
		settle(3);
	}
	assert.ok(R.sky.seatPivot(to, game), label + ': the seat is accepted');
	// The anchor is the destination body's surface point nearest the ship: the
	// point that is about to become the ground under the player.
	R.camera.projectPlane(R.sky.anchor.referenceX, R.sky.anchor.referenceY, screen);
	startX = screen.x;
	startY = screen.y;
	close(R.camera.transition.fromSx, startX, 1e-9, label + ': the hand-over starts where the chart is');
	close(R.camera.transition.fromSy, startY, 1e-9, label + ': at the anchor it will hold');
	previousX = startX;
	previousY = startY;
	while (R.camera.transition.active) {
		R.sky.update(game, 0.016);
		R.camera.projectPlane(R.sky.anchor.referenceX, R.sky.anchor.referenceY, screen);
		// On the frame the hand-over ends the pose is the destination pose and
		// there is nothing published to compare with: continuity is what matters
		// there, and the jump below measures it.
		if (R.camera.transition.active) {
			close(R.coords.wrapScreenX(screen.x, R.camera.transition.sx, R.camera.period),
				R.camera.transition.sx, 1e-6, label + ': the anchor is where the camera says it is');
			close(screen.y, R.camera.transition.sy, 1e-6, label + ': at the height it publishes');
		}
		jump = Math.max(jump, Math.hypot(screen.x - previousX, screen.y - previousY));
		previousX = screen.x;
		previousY = screen.y;
		frames += 1;
		assert.ok(frames < 400, label + ': the hand-over ends');
	}
	// One more frame with the transition over: the pose is the destination pose
	// and the anchor must not move, or the last frame is a cut.
	R.sky.update(game, 0.016);
	R.camera.projectPlane(R.sky.anchor.referenceX, R.sky.anchor.referenceY, screen);
	endX = screen.x;
	endY = screen.y;
	assert.ok(frames > 10, label + ': the hand-over takes real frames, not a cut');
	assert.ok(jump < 40, label + ': and the anchor never jumps (' + jump.toFixed(2) + ' px in a frame)');
	close(Math.hypot(endX - previousX, endY - previousY), 0, 1.5,
		label + ': the frame after the hand-over continues the motion');
	return { startX: startX, startY: startY, endX: endX, endY: endY, frames: frames };
}

R.world.initialize('verdant');
R.camera.resize(1440, 900);
planet = R.world.planet;
game = { rocket: { wx: 0, wy: 0 }, simTime: 0 };
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
// Every catalog body is a lens through that one map, and a pick reads the same
// lens the renderer draws.
// ---------------------------------------------------------------------------

R.sky.reset();
settle(3);
assert.equal(R.sky.pivot.index, -1, 'a fresh session is seated on the world');
assert.equal(R.sky.groundBody(), -1, 'the world is the body the ground belongs to');
close(R.sky.pivot.radius, planet.radius, 1e-6, 'the pivot radius is the world radius');

for (i = 0; i < R.constants.sky.bodies.length; i += 1) {
	var body = R.constants.sky.bodies[i];
	var rho = body.radiusRadii * planet.radius;

	shape = R.sky.outline(i, game);
	assert.ok(shape.visible, 'body ' + i + ' is charted');
	assert.ok(shape.nearY > shape.farY, 'body ' + i + ' has its near limb below its far limb');
	assert.ok(shape.halfWidth > 0, 'body ' + i + ' has a finite angular half-width');
	assert.equal(shape.xs.length, shape.farYs.length);
	close(shape.distance, body.distanceRadii * planet.radius, rho * 1e-9,
		'body ' + i + ' is at its catalog distance');
	// The two limbs meet exactly at the two edges of the lens.
	close(shape.nearYs[0], shape.farYs[0], 1e-6, 'body ' + i + ' limbs meet at the left edge');
	close(shape.nearYs[shape.nearYs.length - 1], shape.farYs[shape.farYs.length - 1], 1e-6,
		'body ' + i + ' limbs meet at the right edge');
	// And at psi = 0 the near and far limbs are D - rho and D + rho, through the
	// chart's own depth law and nothing else.
	close(shape.nearY, chartY(shape.distance - rho), 1e-6, 'body ' + i + ' near limb is D - rho');
	close(shape.farY, chartY(shape.distance + rho), 1e-6, 'body ' + i + ' far limb is D + rho');
	close(shape.centerY, (shape.nearY + shape.farY) / 2, 1e-9, 'body ' + i + ' centre is between its limbs');
	// A sphere's silhouette is symmetric about its own centre ray.
	close(shape.nearYs[0], shape.nearYs[shape.nearYs.length - 1], 1e-6,
		'body ' + i + ' near limb is symmetric');
	assert.equal(R.sky.pick(shape.centerX, shape.centerY, game), i,
		'body ' + i + ' is picked at the centre of the lens that draws it');
}

// The body the chart is seated on is the ground, so it is not a lens and not a
// pick: its surface is the ground line and its interior is the strip below it.
shape = R.sky.outline(-1, game);
assert.equal(shape.visible, false, 'the seated body is not drawn as a lens');
assert.equal(R.sky.pick(R.camera.width / 3, R.camera.groundY, game), -2, 'and the ground is not a pick');
assert.equal(R.sky.pick(4, 4, game), -2, 'empty space picks nothing');

// A distant body is still a visible shape rather than a one-pixel line: the
// chart gives it its true lens, and the renderer a floor under it.
shape = R.sky.outline(0, game);
assert.ok(shape.nearY - shape.farY > 2, 'the star is at least two pixels tall');
assert.ok(shape.halfWidth > R.sky.iconRadius(0), 'and wider than its icon');

// ---------------------------------------------------------------------------
// The ground curve and the air shell are the same forward ray root per column.
// ---------------------------------------------------------------------------

assert.ok(R.sky.poleInside(planet.radius), 'the pole is the world centre, so the interior is charted');
for (i = 0; i <= 8; i += 1) {
	var angle = (i * R.camera.width / 8 - R.camera.ox) / R.camera.angularScale;

	close(R.sky.enclosingY(planet.radius, angle), R.camera.groundY, 1e-9,
		'the surface is the ground line at column ' + i);
	assert.ok(R.sky.enclosingY(planet.radius + R.sky.view.atmosphereTop, angle) < R.camera.groundY,
		'the air shell is above it at column ' + i);
}
close(R.sky.enclosingY(planet.radius, 0), R.camera.groundY, 1e-9, 'the surface is at depth zero');
assert.ok(Number.isFinite(R.sky.enclosingY(planet.radius * 0.35, 0)), 'and so is the interior band');
R.sky.anchorGround(0, planet.radius * 40);
assert.ok(R.sky.enclosingDistance(planet.radius, 0) > 0 || R.sky.enclosingDistance(planet.radius, 0) === -1,
	'a column either exits the sphere or does not meet it');

// ---------------------------------------------------------------------------
// Orbits are charted circles, not screen ellipses, and the body the chart stands
// on does not draw its own: a circle through the pole is singular.
// ---------------------------------------------------------------------------

for (i = 0; i < R.constants.sky.bodies.length; i += 1) {
	orbit = R.sky.orbit(i);
	assert.ok(orbit.valid, 'body ' + i + ' has an orbit');
	close(orbit.period, R.camera.period, 1e-9, 'body ' + i + ' orbit repeats with the chart');
	assert.ok(orbit.count > orbit.xs.length * 0.9, 'body ' + i + ' orbit is sampled all the way round');
	R.sky.planePosition(R.constants.sky.bodies[i], game.simTime, plane);
	R.camera.projectPlane(plane.x, plane.y, screen);
	// The body sits on its own orbit: the polyline passes its centre within one
	// sample step, which is the chord budget the sampling was chosen for.
	var nearest = Infinity;
	var step = R.camera.angularScale * Math.PI / R.constants.view.orbitSamples;
	var j;

	for (j = 0; j < orbit.xs.length; j += 1) {
		if (!Number.isFinite(orbit.xs[j])) {
			continue;
		}
		nearest = Math.min(nearest, Math.hypot(R.coords.wrapScreenX(orbit.xs[j], screen.x, orbit.period) - screen.x,
			orbit.ys[j] - screen.y));
	}
	assert.ok(nearest < step * 1.5,
		'body ' + i + ' centre lies on its own orbit (' + nearest.toFixed(2) + ' px of a ' +
		step.toFixed(2) + ' px step)');
}
assert.equal(R.sky.orbit(-1).valid, false, 'the world itself has no orbit to draw');
R.sky.seatPivot(3, game);
while (R.camera.transition.active) {
	R.sky.update(game, 0.016);
}
settle(3);
assert.equal(R.sky.orbit(3).valid, false, 'the body the chart stands on does not draw its own orbit');
assert.ok(R.sky.orbit(4).valid, 'and every other body still does');

// Seated on a moon, the world is a lens like any other.
R.sky.outline(-1, game);
assert.ok(R.sky.shape.visible, 'the world is charted as a body');
assert.ok(R.sky.shape.nearY - R.sky.shape.farY > 1, 'and it has a visible lens');
assert.ok(!R.sky.poleInside(R.sky.pivot.radius) === false, 'its own interior is charted from its centre');
R.camera.project(1234, 567, screen);
R.camera.unproject(screen.x, screen.y, plane);
close(R.util.wrapDelta(plane.x - 1234, planet.circumference), 0, 1e-6, 'the round trip still holds there');
close(plane.y, 567, 1e-6, 'in both axes');

// ---------------------------------------------------------------------------
// The drag: a point of the plane is taken under the pointer and unwrapped toward
// its ground line. The point never slips, the pole walks to its ground state and
// the shared scale widens onto the system.
// ---------------------------------------------------------------------------

R.sky.reset();
settle(3);
R.sky.outline(3, game);
var grabX = R.sky.shape.centerX;
var grabY = R.sky.shape.centerY;
var luneRadius = R.constants.sky.bodies[3].radiusRadii * planet.radius;

R.sky.handBegin(grabX, grabY, game);
assert.ok(R.sky.hand.active, 'a press and a move take hold of the chart');
assert.equal(R.sky.anchor.bodyIndex, 3, 'grabbing a moon anchors on that moon');
R.sky.bodyCentre(3, plane);
close(R.sky.anchor.poleX, plane.x, 1e-6, 'its pole is that body centre');
close(R.sky.anchor.poleY, plane.y, 1e-6, 'in both axes');
close(R.sky.anchor.reference, luneRadius, 1e-6, 'and the point held is on its surface');
close(R.sky.anchor.line, R.camera.baseGroundY, 1e-9, 'ending on the ground line');
close(R.sky.anchor.knee, luneRadius, 1e-6, 'on the ladder of that body');

var dragFrames = 0;
var maxSlip = 0;
var scaleAtStart = R.camera.scale;
var line = R.sky.anchor.line;

while (dragFrames < 40) {
	var pointerY = grabY + (line - grabY) * (dragFrames + 1) / 40;

	R.sky.handMove(grabX, pointerY);
	R.sky.update(game, 0.016);
	R.camera.projectPlane(R.sky.hand.referenceX, R.sky.hand.referenceY, screen);
	maxSlip = Math.max(maxSlip, Math.hypot(screen.x - grabX, screen.y - pointerY));
	dragFrames += 1;
}
close(R.sky.hand.k, 1, 1e-9, 'the drag reaches its ground line');
assert.ok(maxSlip < 1e-6, 'and the held point never slips from under the pointer (' + maxSlip + ' px)');
assert.ok(R.camera.scale > scaleAtStart, 'the shared scale widened onto the body');
close(R.camera.groundY, R.camera.baseGroundY, 1e-6, 'the ground line is the line the drag was aiming at');
assert.equal(R.sky.groundBody(), 3, 'the moon is now the body the ground belongs to');
close(R.camera.ladderRef, luneRadius, 1e-6, 'and the ladder starts at its surface');
assert.ok(R.sky.poleInside(luneRadius), 'so its interior is charted');

// Releasing there seats the chart, exactly as a click on that body would.
assert.equal(R.sky.handEnd(), 3, 'a drag that reached its line seats its body');
assert.ok(R.sky.seatPivot(3, game) === false || R.sky.pivot.index === 3,
	'the seat is either taken or already held');
settle(3);
assert.equal(R.sky.pivot.index, 3, 'the chart stands on the moon');
close(R.sky.pivot.radius, luneRadius, 1e-6, 'with the moon radius');

// A short drag is not a seat: it eases back to the follow, holding the ship.
R.sky.reset();
settle(3);
R.sky.handBegin(700, 400, game);
R.sky.handMove(700, 460);
R.sky.update(game, 0.016);
assert.ok(R.sky.hand.k < R.constants.sky.handSeatFraction, 'a short drag is short of its line');
assert.equal(R.sky.handEnd(), -2, 'and seats nothing');
assert.ok(R.sky.releaseToFollow(game), 'so the release eases back to the follow');
var backFrames = 0;
var backJump = 0;
var backX = 0;
var backY = 0;

R.camera.project(game.rocket.wx, game.rocket.wy, screen);
backX = screen.x;
backY = screen.y;
while (R.camera.transition.active) {
	R.sky.update(game, 0.016);
	R.camera.project(game.rocket.wx, game.rocket.wy, screen);
	backJump = Math.max(backJump, Math.hypot(screen.x - backX, screen.y - backY));
	backX = screen.x;
	backY = screen.y;
	backFrames += 1;
	assert.ok(backFrames < 400, 'the release ends');
}
assert.ok(backFrames > 10, 'the release takes real frames');
assert.ok(backJump < 40, 'and the ship never jumps (' + backJump.toFixed(2) + ' px in a frame)');
settle(2);
R.camera.project(game.rocket.wx, game.rocket.wy, screen);
close(screen.x, R.camera.width * R.constants.view.cameraAnchorFraction, 1e-6,
	'the ship is back on its anchor column');
close(screen.y, R.camera.originY, 1e-6, 'and on the origin line');

// A drag that starts in empty space anchors on the ground below the grab: the
// pole goes to the nearest surface, the grab itself is what the pointer holds,
// and the view ends on the free-space line.
R.sky.reset();
settle(3);
R.camera.unprojectPlane(1100, 300, plane);
R.sky.handBegin(1100, 300, game);
assert.ok(R.sky.anchor.bodyIndex >= -1, 'empty space anchors on the nearest body');
assert.equal(R.sky.anchor.ladderRef, 0, 'with the ladder starting at the pole itself');
close(R.sky.anchor.referenceX, plane.x, 1e-6, 'holding the point that was grabbed');
close(R.sky.anchor.referenceY, plane.y, 1e-6, 'where it was grabbed');
close(R.sky.anchor.line, R.camera.height * R.constants.view.freeGroundFraction, 1e-9,
	'and ending on the free-space line');
assert.ok(Math.hypot(R.sky.anchor.poleX, R.sky.anchor.poleY) > planet.radius * 0.999,
	'the pole goes out to a surface, not to a centre');
R.sky.handMove(1100, R.sky.anchor.line);
R.sky.update(game, 0.016);
R.camera.projectPlane(R.sky.hand.referenceX, R.sky.hand.referenceY, screen);
close(screen.x, 1100, 1e-6, 'the grabbed point is still under the pointer in x');
close(screen.y, R.sky.anchor.line, 1e-6, 'and on the free-space line in y');
assert.ok(!R.sky.poleInside(R.camera.pivotRadius),
	'a pole standing on a surface charts no interior: below the line is not the map');
R.sky.handEnd();
R.sky.releaseToFollow(game);
while (R.camera.transition.active) {
	R.sky.update(game, 0.016);
}
settle(2);
assert.equal(R.sky.groundBody(), -1, 'and the follow puts the world back under the chart');

// ---------------------------------------------------------------------------
// The pivot hand-over: the chart travels under the anchor, never across it.
// ---------------------------------------------------------------------------

var luneHandOver = handOver(-1, 3, 'world -> Lune');
assert.equal(R.sky.pivot.index, 3);
close(R.sky.pivot.radius, R.constants.sky.bodies[3].radiusRadii * R.world.planet.radius, 1e-6,
	'the pivot radius is Lune\'s');
close(Math.sqrt(R.sky.pivot.x * R.sky.pivot.x + R.sky.pivot.y * R.sky.pivot.y),
	24 * R.world.planet.radius, 1e-3, 'the pivot centre is Lune\'s orbit');
assert.ok(luneHandOver.frames > 10, 'the hand-over is animated');
close(luneHandOver.endX, R.camera.width * R.constants.view.cameraAnchorFraction, 1e-6,
	'the anchor ends on the anchor column');
close(luneHandOver.endY, R.camera.baseGroundY, 1e-6, 'and on the ground line');

handOver(3, -1, 'Lune -> world');
assert.equal(R.sky.pivot.index, -1);
close(R.sky.pivot.radius, R.world.planet.radius, 1e-6, 'the world is the ground again');
close(R.camera.ladderRef, R.world.planet.radius, 1e-6, 'and its surface is the ladder start');

// A seat request while a hand-over is running is refused rather than stacked.
assert.ok(R.sky.seatPivot(3, game));
assert.equal(R.sky.seatPivot(4, game), false, 'a seat during a hand-over is refused');
assert.equal(R.sky.seatPivot(3, game), false, 'and so is a repeat of the same seat');
while (R.camera.transition.active) {
	R.sky.update(game, 0.016);
}
settle(1);
assert.equal(R.sky.pivot.index, 3, 'the refused seats left the accepted one in place');

// ---------------------------------------------------------------------------
// A world switch morphs the view, never the physics.
// ---------------------------------------------------------------------------

R.sky.reset();
R.world.initialize('cinder');
game.rocket = { wx: 0, wy: 0 };
R.sky.update(game, 0);
assert.equal(R.sky.view.planetId, 'cinder');
assert.equal(R.sky.view.morph, 0, 'the morph starts at zero');
settle(3);
assert.equal(R.sky.view.morph, 1, 'the morph completes');
close(R.sky.view.gravity, R.world.planet.surfaceGravity, 1e-9, 'gravity reaches the new world');
close(R.sky.view.radius, R.world.planet.radius, 1e-6, 'radius reaches the new world');
close(R.camera.worldRadius, R.world.planet.radius, 1e-9, 'and so does the plane');
assert.equal(R.sky.pivot.index, -1, 'a world switch stands the chart back on the ground');
R.sky.clearSeat();
R.sky.update(game, 0.016);
assert.equal(R.sky.pivot.index, -1, 'a cleared seat stays cleared');

// ---------------------------------------------------------------------------
// Airless worlds still chart their sky: no ceiling line, and the camera target
// switches from the ground to the ship on a fraction of the radius instead.
// ---------------------------------------------------------------------------

R.sky.reset();
R.world.initialize('gossamer');
settle(3);
assert.ok(R.physics.atmosphereTop() > 0, 'a deep atmosphere has a ceiling line');
assert.ok(R.sky.view.atmosphereTop > 0, 'and the chart draws it');
R.world.initialize('tinmoon');
R.sky.update(game, 0);
assert.equal(R.physics.atmosphereTop(), 0, 'tinmoon is airless');
settle(6);
assert.ok(R.sky.view.atmosphereTop < 1,
	'so the ceiling line eases away (' + R.sky.view.atmosphereTop.toFixed(4) + ' m of air left)');
close(R.sky.view.switchAltitude, R.world.planet.radius * 0.5, 1e-9,
	'and the camera target switches on a fraction of the radius');
assert.ok(Number.isFinite(R.camera.extent) && R.camera.extent > 0, 'the fit still solves');
shape = R.sky.outline(3, game);
assert.ok(Number.isFinite(shape.centerX) && Number.isFinite(shape.nearY), 'and a moon is still charted');
game.rocket.wy = R.world.planet.radius;
settle(8);
close(R.sky.view.fly, 1, 1e-6, 'above the switch altitude the ship becomes the centre of the scale');
close(R.camera.targetDistance, R.world.planet.radius * 2, 1e-3, 'at its own distance from the pole');

// ---------------------------------------------------------------------------
// Coast trace and the flown-trail ring buffer.
// ---------------------------------------------------------------------------

R.world.initialize('verdant');
game = { rocket: { wx: 0, wy: 0 }, simTime: 0 };
R.sky.reset();
settle(3);

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
