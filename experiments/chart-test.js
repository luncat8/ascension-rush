'use strict';

// The chart's gestures, driven the way the page drives them: pointer events on
// the canvas, no renderer and no physics. Drag pans, wheel zooms, a click
// without a drag seats the chart on the body under the pointer, and empty space
// is a no-op. The projection page in experiments/body-hop.html uses exactly
// these handlers, so this is the drag test in test form.

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

function emit(type, x, y, extra) {
	var event = { clientX: x, clientY: y, pointerId: 1, deltaY: 0, deltaMode: 0, preventDefault: function() {} };
	var key;

	for (key in extra || {}) {
		event[key] = extra[key];
	}
	assert.equal(typeof listeners[type], 'function', type + ' is wired');
	listeners[type](event);
}

function settle(seconds) {
	var frames = Math.round(seconds / 0.016);
	var f;

	for (f = 0; f < frames; f += 1) {
		R.sky.update(game, 0.016);
		R.camera.follow(game.rocket.wx, game.rocket.wy, 0.016);
	}
}

R.world.initialize('verdant');
R.game = game;
R.camera.resize(1200, 800);
R.sky.reset();
settle(2);
R.input.initialize(canvas, R.camera);

// ---------------------------------------------------------------------------
// Drag: the chart moves with the pointer, one pixel per pixel.
// ---------------------------------------------------------------------------

R.camera.project(0, 0, screen);
var groundX = screen.x;
var groundY = screen.y;
var pivotBefore = R.sky.pivot.index;

emit('pointerdown', 600, 400);
emit('pointermove', 640, 400);
emit('pointermove', 640, 430);
assert.equal(R.camera.panX, 40, 'a horizontal drag pans by the pointer distance');
assert.equal(R.camera.panY, 30, 'and a vertical drag pans too');
R.camera.project(0, 0, screen);
assert.ok(Math.abs(screen.x - groundX - 40) < 1e-6, 'the ship moves with the drag in x');
assert.ok(Math.abs(screen.y - groundY - 30) < 1e-6, 'and in y');
emit('pointerup', 640, 430);
assert.equal(R.sky.pivot.index, pivotBefore, 'a drag is not a click: the chart stays seated');

// A follow does not undo the drag: the pan is the pointer's, the base is the
// ship's, and they add.
screen.x = 0;
screen.y = 0;
R.camera.follow(game.rocket.wx, game.rocket.wy, 0.016);
R.camera.project(0, 0, screen);
assert.ok(Math.abs(screen.x - groundX - 40) < 1e-6, 'the drag survives a follow');
assert.equal(R.camera.panY, 30);

// A press that barely moves is still a click, not a one-pixel pan.
R.camera.resetPan();
var hoverIndex = R.sky.pick(300, 300, game);
emit('pointerdown', 300, 300);
emit('pointermove', 301, 301);
emit('pointerup', 301, 301);
assert.equal(R.camera.panX, 0, 'a jittery click does not pan');
if (hoverIndex >= -1) {
	assert.equal(R.sky.pivot.index, hoverIndex, 'a click on a body seats the chart there');
}

// Back to the world, so the next picks are made from the deck.
R.sky.seatPivot(-1, game);
while (R.sky.pivot.reseating) {
	R.sky.update(game, 0.016);
	R.camera.follow(game.rocket.wx, game.rocket.wy, 0.016);
}
settle(0.5);
assert.equal(R.sky.pivot.index, -1);

// ---------------------------------------------------------------------------
// Click a body: the chart re-seats on it, and its own lens stops being a pick.
// ---------------------------------------------------------------------------

var lune = 3;
var lens = R.sky.outline(lune, game);
// `sky.shape` is reused for every body, so the pick must be made from read
// values: the lens object itself is the last outline drawn.
var luneX = lens.centerX;
var luneY = lens.centerY;
var picked = R.sky.pick(luneX, luneY, game);
assert.equal(picked, lune, 'the body under the pointer is picked');

emit('pointerdown', luneX, luneY);
emit('pointerup', luneX, luneY);
assert.equal(R.sky.pivot.index, lune, 'the click seats the chart on that body');
assert.equal(R.camera.flat, false, 'and the general log-polar form takes over');
while (R.sky.pivot.reseating) {
	R.sky.update(game, 0.016);
	R.camera.follow(game.rocket.wx, game.rocket.wy, 0.016);
}
settle(0.5);
assert.equal(R.sky.pick(luneX, luneY, game) === lune, false,
	'the seated body is the ground, so it is not a pick');

// Empty space is a no-op: a stray click never throws the view away.
emit('pointerdown', 4, 794);
emit('pointerup', 4, 794);
assert.equal(R.sky.pivot.index, lune, 'a click on empty space changes nothing');

// And the world is clickable from away, so the deck is one click back.
lens = R.sky.outline(-1, game);
assert.ok(lens.visible, 'the world is charted from Lune');
var worldX = lens.centerX;
var worldY = lens.centerY;
emit('pointerdown', worldX, worldY);
emit('pointerup', worldX, worldY);
assert.equal(R.sky.pivot.index, -1, 'the world is a pick like any other body');

// ---------------------------------------------------------------------------
// Wheel: the zoom is eased, clamped, and keeps the ship on its anchor.
// ---------------------------------------------------------------------------

while (R.sky.pivot.reseating) {
	R.sky.update(game, 0.016);
	R.camera.follow(game.rocket.wx, game.rocket.wy, 0.016);
}
settle(0.5);
emit('wheel', 600, 400, { deltaY: -120 });
assert.ok(R.camera.zoomTarget > 1, 'a wheel notch zooms in');
settle(0.6);
assert.ok(R.camera.zoom > 1.05, 'and the zoom eases in');
R.camera.project(game.rocket.wx, game.rocket.wy, screen);
assert.ok(Math.abs(screen.x - R.camera.width / 3) < 1, 'the ship keeps its anchor through the zoom');
R.camera.project(0, 0, screen);
assert.ok(Math.abs(screen.y - R.camera.groundY) < 1e-6, 'the surface stays on the ground line');

var guard = 0;
while (R.camera.zoomTarget < 40 && guard < 60) {
	emit('wheel', 600, 400, { deltaY: -120 });
	guard += 1;
}
assert.ok(R.camera.zoomTarget <= R.constants.view.zoomMax + 1e-9, 'the zoom is clamped');
emit('wheel', 600, 400, { deltaY: 120 });
emit('wheel', 600, 400, { deltaY: 120 });
assert.ok(R.camera.zoomTarget < R.constants.view.zoomMax, 'and the wheel zooms back out');
R.camera.resetPan();
assert.equal(R.camera.zoom, 1);
assert.equal(R.camera.zoomTarget, 1);

// ---------------------------------------------------------------------------
// The hover that makes a body read as clickable.
// ---------------------------------------------------------------------------

lens = R.sky.outline(lune, game);
emit('pointermove', lens.centerX, lens.centerY);
assert.equal(R.input.hoverIndex, lune, 'hovering a body is reported to the renderer');
assert.equal(canvas.style.cursor, 'pointer', 'and the cursor says so');
emit('pointermove', 4, 794);
assert.equal(R.input.hoverIndex, -2, 'empty space is not a pick');
assert.equal(canvas.style.cursor, 'grab', 'and the cursor goes back');

// ---------------------------------------------------------------------------
// A page can claim a press for its own object (the chart lab grabs the probe):
// the camera ignores that gesture and the page gets the moves.
// ---------------------------------------------------------------------------

var claimedMoves = 0;
var claimedEnds = 0;

R.camera.resetPan();
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
emit('pointermove', 100, 60);
emit('pointerup', 100, 60);
assert.equal(R.camera.panY, 0, 'a claimed press never pans the chart');
assert.equal(claimedMoves, 1, 'the page gets the moves');
assert.equal(claimedEnds, 1, 'and the release');
emit('pointerdown', 900, 400);
emit('pointermove', 900, 430);
assert.equal(R.camera.panY, 30, 'an unclaimed press pans as usual');
emit('pointerup', 900, 430);
R.input.gestureHook = null;
R.input.gestureMove = null;
R.input.gestureEnd = null;

console.log('Chart gesture, seat and zoom tests passed.');
