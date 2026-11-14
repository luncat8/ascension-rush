'use strict';

// The chart's gestures, driven the way the page drives them: pointer events on
// the canvas, no renderer and no physics. A drag takes hold of a point of the
// plane and unwraps the chart around it — sideways it looks around, downward it
// walks the pole to that point's ground state — the wheel zooms about the camera
// target, and a click without a drag seats the chart on the body under the
// pointer. The projection page in experiments/body-hop.html uses exactly these
// handlers, so this is the drag test in test form.

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
require('../js/input.js');

var listeners = {};
var canvas = {
	width: 1200,
	height: 800,
	style: {},
	addEventListener: function(type, handler) {
		listeners[type] = handler;
	},
	getBoundingClientRect: function() {
		return { left: 0, top: 0, width: 1200, height: 800 };
	},
	setPointerCapture: function() {},
	releasePointerCapture: function() {},
	hasPointerCapture: function() {
		return false;
	}
};

var game = { rocket: { wx: 0, wy: 0 }, simTime: 0 };
var screen = { x: 0, y: 0 };
var plane = { x: 0, y: 0 };
var anchorX = 0;

function emit(type, x, y, extra) {
	var event = { clientX: x, clientY: y, pointerId: 1, deltaY: 0, deltaMode: 0, preventDefault: function() {} };
	var key;

	for (key in extra || {}) {
		event[key] = extra[key];
	}
	assert.equal(typeof listeners[type], 'function', type + ' is wired');
	listeners[type](event);
}

// The gestures write to the hand and the zoom; the chart itself is solved by the
// sky, so a gesture is only on screen after its frames.
function step(frames) {
	var f;

	for (f = 0; f < (frames || 1); f += 1) {
		R.sky.update(game, 0.016);
	}
}

function settle(seconds) {
	step(Math.round(seconds / 0.016));
	while (R.camera.transition.active) {
		step();
	}
}

R.world.initialize('verdant');
R.game = game;
R.camera.resize(1200, 800);
anchorX = R.camera.width * R.constants.view.cameraAnchorFraction;
R.sky.reset();
settle(3);
R.input.initialize(canvas, R.camera);
assert.equal(R.sky.pivot.index, -1, 'the chart starts standing on the world');

// ---------------------------------------------------------------------------
// A drag takes hold: sideways it looks around, and the point it took hold of
// stays under the pointer.
// ---------------------------------------------------------------------------

// A corner of the deck with nothing in it: the anchor there is the ground below
// the grab, and the grab itself is what the pointer holds.
emit('pointerdown', 30, 60);
emit('pointermove', 32, 61);
assert.equal(R.input.dragging, false, 'a move inside the slop is not a drag yet');
assert.equal(R.sky.hand.active, false, 'and the chart is not held');
emit('pointermove', 70, 60);
assert.equal(R.input.dragging, true, 'a move past the slop takes hold');
assert.ok(R.sky.hand.active, 'the chart is held by the hand');
assert.equal(canvas.style.cursor, 'grabbing', 'and the cursor says so');
step();
R.camera.unprojectPlane(30, 60, plane);
assert.equal(R.sky.anchor.ladderRef, 0, 'empty space anchors on the ground below the grab');
R.camera.projectPlane(R.sky.hand.referenceX, R.sky.hand.referenceY, screen);
assert.ok(Math.abs(screen.x - 70) < 1e-6 && Math.abs(screen.y - 60) < 1e-6,
	'the grabbed point is under the pointer');

var oxBefore = R.camera.ox;
emit('pointermove', 130, 60);
step();
assert.equal(R.sky.hand.k, 0, 'a sideways drag does not unwrap');
assert.ok(Math.abs(R.camera.ox - oxBefore - 60) < 1e-6,
	'it looks around instead, one pixel per pixel');
R.camera.projectPlane(R.sky.hand.referenceX, R.sky.hand.referenceY, screen);
assert.ok(Math.abs(screen.x - 130) < 1e-6 && Math.abs(screen.y - 60) < 1e-6,
	'and the grabbed point never leaves the pointer');

// A release short of the ground line seats nothing: the chart eases back to the
// follow, holding the ship still on the way.
emit('pointerup', 130, 60);
assert.equal(R.input.dragging, false, 'the release lets go');
assert.equal(R.sky.hand.active, false, 'the hand is off the chart');
assert.equal(R.sky.pivot.index, -1, 'a short drag seats nothing');
assert.ok(R.camera.transition.active, 'and the release eases instead of snapping');
settle(3);
R.camera.project(game.rocket.wx, game.rocket.wy, screen);
assert.ok(Math.abs(screen.x - anchorX) < 1e-6, 'the follow puts the ship back on its anchor column');
assert.ok(Math.abs(screen.y - R.camera.originY) < 1e-6, 'and on the origin line');

// ---------------------------------------------------------------------------
// A drag all the way down unwraps the chart onto the body it was aiming at, and
// releasing it there seats that body exactly as a click would.
// ---------------------------------------------------------------------------

R.sky.outline(3, game);
var grabX = R.sky.shape.centerX;
var grabY = R.sky.shape.centerY;
var line;
var dragY;
var f;

emit('pointerdown', grabX, grabY);
emit('pointermove', grabX, grabY + 10);
step();
assert.equal(R.sky.anchor.bodyIndex, 3, 'grabbing a moon anchors on that moon');
line = R.sky.anchor.line;
for (f = 1; f <= 30; f += 1) {
	dragY = grabY + 10 + (line - grabY - 10) * f / 30;
	emit('pointermove', grabX, dragY);
	step();
	R.camera.projectPlane(R.sky.hand.referenceX, R.sky.hand.referenceY, screen);
	assert.ok(Math.abs(screen.x - grabX) < 1e-6 && Math.abs(screen.y - dragY) < 1e-6,
		'the held point follows the pointer down');
}
assert.ok(R.sky.hand.k >= R.constants.sky.handSeatFraction, 'the drag reached its ground line');
emit('pointerup', grabX, line);
assert.equal(R.sky.pivot.index, 3, 'so the release seats the chart on that moon');
settle(3);
assert.equal(R.sky.groundBody(), 3, 'which is now the body the ground belongs to');
assert.equal(R.sky.pick(grabX, grabY, game) === 3, false, 'and the ground is no longer a pick');
R.sky.outline(-1, game);
assert.ok(R.sky.shape.visible, 'the world is a lens from up there');

// ---------------------------------------------------------------------------
// A click seats the body under the pointer; empty space is a no-op, so a stray
// click never throws the view away.
// ---------------------------------------------------------------------------

R.sky.outline(-1, game);
var worldX = R.sky.shape.centerX;
var worldY = R.sky.shape.centerY;

assert.equal(R.sky.pick(worldX, worldY, game), -1, 'the world is picked where its lens is drawn');
emit('pointerdown', worldX, worldY);
emit('pointerup', worldX, worldY);
assert.equal(R.sky.pivot.index, -1, 'a click on the world seats the chart back on it');
assert.equal(R.input.dragging, false, 'a click is not a drag');
assert.equal(R.sky.hand.active, false, 'and never takes hold of the chart');
settle(3);
assert.equal(R.sky.groundBody(), -1, 'the world is the ground again');

emit('pointerdown', 4, 794);
emit('pointerup', 4, 794);
assert.equal(R.sky.pivot.index, -1, 'a click on empty space changes nothing');
assert.equal(R.camera.transition.active, false, 'and starts no hand-over');

// A click while a hand-over is running is refused rather than stacked.
R.sky.outline(3, game);
emit('pointerdown', R.sky.shape.centerX, R.sky.shape.centerY);
emit('pointerup', R.sky.shape.centerX, R.sky.shape.centerY);
assert.equal(R.sky.pivot.index, 3, 'the click is taken');
R.sky.outline(4, game);
emit('pointerdown', R.sky.shape.centerX, R.sky.shape.centerY);
emit('pointerup', R.sky.shape.centerX, R.sky.shape.centerY);
assert.equal(R.sky.pivot.index, 3, 'a click during the hand-over is refused');
settle(3);
assert.equal(R.sky.pivot.index, 3, 'and the accepted seat is the one that stands');
R.sky.seatPivot(-1, game);
// The origin line eases back down with the camera target, so the ground line is
// only exactly the deck line once that ease has run out.
settle(14);

// ---------------------------------------------------------------------------
// Wheel: the zoom is eased, clamped, about the camera target, and a seat returns
// to the fitted view.
// ---------------------------------------------------------------------------

R.camera.project(0, 0, screen);
var groundYBefore = R.camera.groundY;

emit('wheel', 600, 400, { deltaY: -120 });
assert.ok(R.camera.zoomTarget > 1, 'a wheel notch zooms in');
assert.ok(R.camera.zoom === 1, 'and the zoom is eased, not applied at once');
settle(1);
assert.ok(R.camera.zoom > 1.05, 'so it arrives over frames');
R.camera.project(game.rocket.wx, game.rocket.wy, screen);
assert.ok(Math.abs(screen.x - anchorX) < 1e-6, 'the camera target keeps its anchor column');
assert.ok(Math.abs(screen.y - R.camera.originY) < 1e-6, 'and its origin line');
assert.ok(Math.abs(R.camera.groundY - groundYBefore) < 1e-6,
	'and while the ground is the target the ground line does not move');
R.camera.project(0, 1000, screen);
assert.ok(screen.y < R.camera.groundY - 100, 'the zoom magnifies the air column');

var guard = 0;
while (R.camera.zoomTarget < 40 && guard < 60) {
	emit('wheel', 600, 400, { deltaY: -120 });
	guard += 1;
}
assert.ok(R.camera.zoomTarget <= R.constants.view.zoomMax + 1e-9, 'the zoom is clamped');
emit('wheel', 600, 400, { deltaY: 120 });
emit('wheel', 600, 400, { deltaY: 120 });
assert.ok(R.camera.zoomTarget < R.constants.view.zoomMax, 'and the wheel zooms back out');

// A seat returns to the fitted view: landing on a distant body must not land on
// empty space because of the zoom the player dialled in.
settle(1);
assert.ok(R.camera.zoomTarget > 1, 'the zoom is still dialled in');
R.sky.outline(3, game);
emit('pointerdown', R.sky.shape.centerX, R.sky.shape.centerY);
emit('pointerup', R.sky.shape.centerX, R.sky.shape.centerY);
assert.equal(R.camera.zoomTarget, 1, 'a seat asks for the fitted view back');
settle(3);
assert.ok(Math.abs(R.camera.zoom - 1) < 1e-6, 'and the zoom eases back to it');
R.sky.seatPivot(-1, game);
settle(3);

// ---------------------------------------------------------------------------
// The hover that makes a body read as clickable.
// ---------------------------------------------------------------------------

R.sky.outline(3, game);
emit('pointermove', R.sky.shape.centerX, R.sky.shape.centerY);
assert.equal(R.input.hoverIndex, 3, 'hovering a body is reported to the renderer');
assert.equal(canvas.style.cursor, 'pointer', 'and the cursor says so');
emit('pointermove', 4, 794);
assert.equal(R.input.hoverIndex, -2, 'empty space is not a pick');
assert.equal(canvas.style.cursor, 'grab', 'and the cursor goes back to a held chart');
emit('pointerleave', 4, 794);
assert.equal(R.input.pointerActive, false, 'leaving the canvas drops the pointer');
assert.equal(R.input.hoverIndex, -2, 'and its hover');

// ---------------------------------------------------------------------------
// A page can claim a press for its own object (the chart lab grabs the probe):
// the chart ignores that gesture and the page gets the moves.
// ---------------------------------------------------------------------------

var claimedMoves = 0;
var claimedEnds = 0;

R.input.gestureHook = function(x, y) {
	return x > 90 && x < 110 && y > 90 && y < 110;
};
R.input.gestureMove = function() {
	claimedMoves += 1;
};
R.input.gestureEnd = function() {
	claimedEnds += 1;
};
emit('pointerdown', 100, 100);
emit('pointermove', 100, 400);
emit('pointerup', 100, 400);
assert.equal(R.sky.hand.active, false, 'a claimed press never takes hold of the chart');
assert.equal(R.input.dragging, false, 'and is not reported as a drag');
assert.equal(claimedMoves, 1, 'the page gets the moves');
assert.equal(claimedEnds, 1, 'and the release');
emit('pointerdown', 900, 300);
emit('pointermove', 900, 500);
step();
assert.ok(R.sky.hand.active, 'an unclaimed press takes hold as usual');
emit('pointerup', 900, 500);
settle(3);
R.input.gestureHook = null;
R.input.gestureMove = null;
R.input.gestureEnd = null;

// ---------------------------------------------------------------------------
// A resize keeps the pointer's own reading of the chart, and the chart keeps its
// law: the ground line is where the pose puts it, at any size.
// ---------------------------------------------------------------------------

R.camera.resize(900, 600);
R.input.resize(R.camera);
settle(2);
R.camera.project(0, 0, screen);
assert.ok(Math.abs(screen.x - R.camera.width * R.constants.view.cameraAnchorFraction) < 1e-6,
	'the camera target keeps its anchor fraction at the new size');
assert.ok(Math.abs(screen.y - R.camera.groundY) < 1e-6, 'and the ground is still the ground line');
R.sky.outline(3, game);
assert.ok(Number.isFinite(R.sky.shape.centerX), 'and a body still has a place on it');

// ---------------------------------------------------------------------------
// The chart is the hull's own once the hull is above the air: the pole travels
// out of the world to the ground under it, the hull holds the origin line, the
// catalog is read from that pole by the same map that draws the hull, and
// flying onto a body unwraps that body into flat ground. This is the flight the
// projection lab drives with the mouse, in test form.
// ---------------------------------------------------------------------------

function close(actual, expected, tolerance, label) {
	assert.ok(Math.abs(actual - expected) <= tolerance,
		label + ': ' + actual + ' vs ' + expected);
}

// Screen y of the ground curve at a screen x, through the same forward root the
// renderer solves its columns with: flat ground is a curve with no spread.
function groundYAt(x) {
	return R.sky.enclosingY(R.camera.pivotRadius,
		(x - R.camera.ox) / R.camera.angularScale);
}

function groundSpread() {
	var spread = 0;
	var column;
	var y;

	for (column = 0; column <= 8; column += 1) {
		y = groundYAt(R.camera.width * column / 8);
		if (Number.isFinite(y)) {
			spread = Math.max(spread, Math.abs(y - R.camera.groundY));
		}
	}
	return spread;
}

var direct = { x: 0, y: 0 };
var luneRadius = R.constants.sky.bodies[3].radiusRadii * R.world.planet.radius;
var climbRate = 400;
var jump;
var previousX;
var previousY;
var lens;
var frames;

R.camera.resize(1200, 800);
R.input.resize(R.camera);
R.sky.reset();
game.rocket.wx = 0;
game.rocket.wy = 0;
settle(4);
R.camera.project(0, 0, screen);
close(Math.hypot(R.camera.poleX, R.camera.poleY), 0, 1e-9, 'landed, the pole is the world centre');
close(R.camera.ladderRef, R.world.planet.radius, 1e-9, 'and the ladder starts at its surface');
assert.ok(R.sky.poleInside(R.camera.pivotRadius), 'so its interior is charted');
close(groundSpread(), 0, 1e-9, 'and its surface is the flat ground line');

// Climbing out at a flown rate is one continuous move of the pole, the target
// and the ground line together: no frame of it jumps the hull off the map.
jump = 0;
previousX = screen.x;
previousY = screen.y;
for (frames = 0; frames < 4700; frames += 1) {
	game.rocket.wy = Math.min(30000, game.rocket.wy + climbRate * 0.016);
	step();
	R.camera.project(game.rocket.wx, game.rocket.wy, screen);
	jump = Math.max(jump, Math.hypot(screen.x - previousX, screen.y - previousY));
	previousX = screen.x;
	previousY = screen.y;
}
assert.ok(jump < 12, 'the climb never jumps the hull (' + jump.toFixed(2) + ' px in a frame)');
settle(14);
close(Math.hypot(R.camera.poleX, R.camera.poleY), R.world.planet.radius, 1e-6,
	'above the air the pole stands on the surface under the hull');
close(R.camera.ladderRef, 0, 1e-9, 'and the ladder starts at that point');
R.camera.project(game.rocket.wx, game.rocket.wy, screen);
close(screen.x, anchorX, 1e-6, 'the hull holds its anchor column');
close(screen.y, R.camera.originY, 1e-6, 'and the origin line');
close(R.camera.groundY,
	R.camera.originY + R.camera.scale * R.coords.depthOf(game.rocket.wy, R.camera), 1e-6,
	'while the ground sinks below it by exactly the climb');
assert.equal(R.sky.outline(-1, game).visible, false,
	'so the world is the ground under the pole, not a lens above the hull');

// One projection for the hull and the catalog: a body's lens centre is its own
// plane point put through the same map that places the hull's marker.
for (f = 0; f < R.constants.sky.bodies.length; f += 1) {
	R.sky.planePosition(R.constants.sky.bodies[f], game.simTime, plane);
	R.camera.projectPlane(plane.x, plane.y, screen);
	lens = R.sky.outline(f, game);
	close(R.coords.wrapScreenX(lens.centerX, screen.x, R.camera.period), screen.x, 1e-9,
		'body ' + f + ' is drawn where the map puts it');
	close(lens.centerY, (lens.nearY + lens.farY) / 2, 1e-9, 'body ' + f + ' between its own limbs');
}
R.sky.shipPlane(game, plane);
R.camera.projectPlane(plane.x, plane.y, screen);
// The hull's own spelling of the same point, from its world coordinates.
R.camera.project(game.rocket.wx, game.rocket.wy, direct);
close(screen.x, direct.x, 1e-9, 'and the hull is charted by that same map');
close(screen.y, direct.y, 1e-9, 'in both axes');

// Flying inside a body unwraps it: the chart hands itself over, the body's
// surface becomes the flat ground line, and it stops being a lens.
R.sky.bodyCentre(3, plane);
game.rocket.wx = Math.atan2(plane.x, plane.y) * R.camera.worldRadius;
game.rocket.wy = Math.hypot(plane.x, plane.y) - R.world.planet.radius + luneRadius * 2;
// The hand-over, and then the pole's own ease back down onto the new centre.
settle(12);
assert.equal(R.sky.pivot.index, 3, 'flying inside a body seats the chart on it');
assert.equal(R.sky.pivot.approach, true, 'as an approach, which a departure can undo');
close(Math.hypot(R.camera.poleX - R.sky.pivot.x, R.camera.poleY - R.sky.pivot.y), 0, 1e-6,
	'the pole is that body centre again');
close(R.camera.ladderRef, luneRadius, 1e-6, 'and its surface is the ladder start');
close(groundSpread(), 0, 1e-6, 'so that surface is unwrapped into flat ground');
assert.ok(R.sky.poleInside(luneRadius), 'with its interior charted below');
assert.equal(R.sky.outline(3, game).visible, false, 'and it is the ground, not a lens');
R.camera.project(game.rocket.wx, game.rocket.wy, screen);
assert.ok(screen.y < R.camera.groundY, 'with the hull above its new ground line');

// Flying clear of it hands the chart back to the world, and the pole goes back
// out to the hull's own ground point there.
game.rocket.wx = R.util.wrapDelta(game.rocket.wx + R.world.planet.circumference * 0.25,
	R.world.planet.circumference);
settle(10);
assert.equal(R.sky.pivot.index, -1, 'flying clear of a body hands the chart back to the world');
assert.equal(R.sky.pivot.approach, false, 'and the seat goes with it');
settle(6);
close(Math.hypot(R.camera.poleX, R.camera.poleY), R.world.planet.radius, 1e-6,
	'so the pole stands on the world under the hull again');

console.log('Chart gesture, seat and zoom tests passed.');
