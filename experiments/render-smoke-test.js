'use strict';

var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var dom = require('./dom.js');
var renderCalls = 0;
var drawnText = [];
var frameCallback = null;
var tileContext = {
	fillRect: function() {
		renderCalls += 1;
	}
};
var context = {};
var canvas;
var contextMethods = [
	'clearRect', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'quadraticCurveTo',
	'closePath', 'fill', 'stroke', 'arc', 'fillText', 'save', 'translate',
	'rotate', 'restore', 'clip'
];
var i;

// A real canvas swallows a non-finite coordinate and drops the path with it, so
// the stub refuses one instead: every number the renderer hands the context has
// to be a pixel that exists. That is the whole chart layer's NaN guard, and it
// costs nothing here.
function checkArgs(method, args) {
	var i;

	for (i = 0; i < args.length; i += 1) {
		if (typeof args[i] !== 'number') {
			continue;
		}
		assert.ok(Number.isFinite(args[i]),
			method + ' was handed a non-finite argument at ' + i + ': ' + args[i]);
	}
}

for (i = 0; i < contextMethods.length; i += 1) {
	context[contextMethods[i]] = (function(method) {
		return function() {
			checkArgs(method, arguments);
			renderCalls += 1;
		};
	}(contextMethods[i]));
}
context.fillText = function(text) {
	checkArgs('fillText', arguments);
	drawnText.push(String(text));
	renderCalls += 1;
};
context.setTransform = function() {
	renderCalls += 1;
};
context.createPattern = function() {
	return {};
};
context.createLinearGradient = function() {
	return {
		addColorStop: function() {
			renderCalls += 1;
		}
	};
};
context.setLineDash = function() {
	renderCalls += 1;
};
canvas = {
	width: 300,
	height: 150,
	getContext: function() {
		return context;
	},
	getBoundingClientRect: function() {
		return { left: 0, top: 0, width: 1280, height: 720 };
	},
	addEventListener: function() {}
};

global.innerWidth = 1280;
global.innerHeight = 720;
global.devicePixelRatio = 2;
global.addEventListener = function() {};
global.requestAnimationFrame = function(callback) {
	frameCallback = callback;
};
// The deck is tested against the markup it actually ships with, so an id that
// exists in one file and not the other fails here.
var fixture = dom.createDocument(fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8'));
var fixtureGetElementById = fixture.getElementById.bind(fixture);
var fixtureCreateElement = fixture.createElement.bind(fixture);

fixture.getElementById = function(id) {
	return id === 'c' ? canvas : fixtureGetElementById(id);
};
fixture.createElement = function(tagName) {
	var node = fixtureCreateElement(tagName);

	node.width = 0;
	node.height = 0;
	node.getContext = function() {
		return tileContext;
	};
	return node;
};
global.document = fixture;

var R = require('../js/namespaces.js');
require('../js/parts.js');
require('../js/damage.js');
require('../js/util.js');
require('../js/constants.js');
require('../js/planets.js');
require('../js/coords.js');
require('../js/camera.js');
require('../js/world.js');
require('../js/rocket.js');
require('../js/market.js');
require('../js/economy.js');
require('../js/flight-log.js');
require('../js/mission.js');
require('../js/aerodynamics.js');
require('../js/physics.js');
require('../js/trajectory.js');
require('../js/sky.js');
require('../js/flight-path.js');
require('../js/autopilot.js');
require('../js/planner.js');
require('../js/operations.js');
require('../js/competitor.js');
require('../js/campaign.js');
require('../js/builder.js');
require('../js/deck.js');
require('../js/controls.js');
require('../js/input.js');
require('../js/render.js');
require('../js/menu.js');

// Damage and failures are measured by experiments/failure.js; every other
// suite flies the 0.4 model, so a leg here is never at the mercy of a roll.
R.damage.enabled = false;

R.world.initialize();
R.camera.resize(1280, 720);
R.render.initialize(context);
R.render.resize(1280, 720);
// The chart is fitted from the catalog, so the deck is drawn only after a few
// sky frames — the same order main.js uses before its first paint.
var smokeGame = {
	currentPadId: R.world.currentPadId,
	targetPadId: R.world.targetPadId,
	rocket: R.rocket.create(R.world.findPadById(R.world.currentPadId)),
	simTime: 0
};
for (i = 0; i < 40; i += 1) {
	R.sky.update(smokeGame, 0.016);
}
R.render.draw(smokeGame);

// The inter-planet sky is drawn from the same world record: a labelled star,
// the atmosphere ceiling, and a surface escape speed from GM.
assert.ok(drawnText.indexOf('HELIOS') >= 0, 'the star is labelled in the sky');
assert.ok(drawnText.indexOf('LUNE') >= 0, 'a moon is labelled in the sky');
assert.ok(drawnText.some(function(text) {
	return text.indexOf('ATMOSPHERE TOP') >= 0;
}), 'the atmosphere ceiling is labelled');
assert.ok(drawnText.indexOf('ESCAPE SPEED') >= 0, 'the deck quotes surface escape speed');
assert.equal(R.sky.view.planetId, 'verdant', 'the sky view is seeded for the live world');
assert.ok(R.camera.extent > R.world.planet.maxAltitude * 10,
	'the deck charts the whole system, not just the planet\'s altitude band');

// ---------------------------------------------------------------------------
// The chart layer in every state the projection can be in: on the deck, above
// the air with the ship as the centre of the scale, out at a moon's distance,
// seated on a catalog body, mid-drag with the pole walking out to a surface,
// and mid-hand-over. Each is drawn through the stub above, so a curve the chart
// cannot place fails here instead of vanishing in a browser.
// ---------------------------------------------------------------------------

function chartState(label, setup, frames) {
	var f;

	R.world.initialize('verdant');
	R.camera.resize(1280, 720);
	R.render.resize(1280, 720);
	R.sky.reset();
	setup();
	for (f = 0; f < frames; f += 1) {
		R.sky.update(smokeGame, 0.016);
	}
	renderCalls = 0;
	drawnText.length = 0;
	R.render.drawChart(context, smokeGame);
	assert.ok(renderCalls > 200, label + ': the chart drew (' + renderCalls + ' calls)');
	return renderCalls;
}

chartState('the deck', function() {
	smokeGame.rocket.wy = 0;
}, 200);
assert.ok(drawnText.indexOf('HELIOS') >= 0, 'the deck labels the star');
assert.ok(drawnText.some(function(text) {
	return text.indexOf('ATMOSPHERE TOP') >= 0;
}), 'and the ceiling line it is standing under');

chartState('above the air', function() {
	smokeGame.rocket.wy = 200000;
}, 400);
assert.ok(R.camera.originY < R.camera.groundY, 'the ground has sunk below the origin line');
assert.ok(R.render.curves.topY > R.render.height, 'and the ceiling line has sunk with it');
assert.equal(drawnText.some(function(text) {
	return text.indexOf('ATMOSPHERE TOP') >= 0;
}), false, 'so the ceiling is not labelled from up there');

chartState('out at a moon distance', function() {
	smokeGame.rocket.wy = 23 * R.world.planet.radius;
}, 400);

chartState('seated on a moon', function() {
	smokeGame.rocket.wy = 0;
	R.sky.seatPivot(3, smokeGame);
}, 200);
assert.equal(R.sky.groundBody(), 3, 'the moon is the ground there');
assert.ok(drawnText.some(function(text) {
	return text.indexOf('DISTANCE FROM LUNE') >= 0;
}), 'and the ruler says whose distance it is');

chartState('mid-drag onto a body', function() {
	var lens;

	smokeGame.rocket.wy = 0;
	R.sky.update(smokeGame, 0.016);
	lens = R.sky.outline(3, smokeGame);
	R.sky.handBegin(lens.centerX, lens.centerY, smokeGame);
	R.sky.handMove(lens.centerX, (lens.centerY + R.sky.anchor.line) / 2);
}, 4);
assert.ok(R.sky.hand.active && R.sky.hand.k > 0.2 && R.sky.hand.k < 0.9, 'the drag is halfway down');
R.sky.handEnd();

chartState('a pole standing on a surface', function() {
	var free = { x: 0, y: 0 };

	smokeGame.rocket.wy = 0;
	R.sky.update(smokeGame, 0.016);
	R.camera.unprojectPlane(30, 60, free);
	R.sky.handBegin(30, 60, smokeGame);
	R.sky.handMove(30, R.sky.anchor.line);
}, 4);
assert.equal(R.sky.anchor.ladderRef, 0, 'empty space puts the pole on a surface');
assert.equal(R.render.curves.radial, false, 'so there is no interior to chart below the line');
R.sky.handEnd();

chartState('mid-hand-over', function() {
	smokeGame.rocket.wy = 0;
	R.sky.seatPivot(2, smokeGame);
}, 20);
assert.ok(R.camera.transition.active, 'the hand-over is still running');

// Back to the deck for the rest of the suite.
R.world.initialize('verdant');
R.camera.resize(1280, 720);
R.render.resize(1280, 720);
R.sky.reset();
smokeGame.rocket.wy = 0;
for (i = 0; i < 40; i += 1) {
	R.sky.update(smokeGame, 0.016);
}
drawnText.length = 0;

R.input.pointerActive = true;
R.input.pointerX = 620;
R.input.pointerY = 340;
R.input.worldPoint.x = 12600;
R.input.worldPoint.y = 900;
R.input.debugText = 'E 12600 m  ·  ALT 900 m';
R.render.draw({
	currentPadId: R.world.currentPadId,
	targetPadId: R.world.targetPadId,
	rocket: R.rocket.create(R.world.findPadById(R.world.currentPadId))
});

var flightPad = R.world.findPadById(R.world.currentPadId);
var flightRocket = R.rocket.create(flightPad);

// Mid-flight state: stage one burned down, stage two not yet lit.
R.rocket.applyFleetState(flightRocket, {
	stageCount: 2,
	stages: [
		{ fuelMass: 1000, strength: 0.9 },
		{ fuelMass: 500, strength: 0.9 },
		{ fuelMass: 300, strength: 0.9 }
	]
}, [
	{ alive: true, fuelMass: 420 },
	{ alive: true, fuelMass: 500 },
	{ alive: false, fuelMass: 0 }
], 100, flightPad);
flightRocket.wy = 1400;
flightRocket.vx = 240;
flightRocket.vy = 60;
flightRocket.throttle = 0.75;
var flightGame = {
	currentPadId: R.world.currentPadId,
	targetPadId: R.world.targetPadId,
	phase: 'flying',
	flight: { cashDelta: -600, currentDynamicPressure: 24000, currentAngleOfAttack: 0.4, peakDynamicPressure: 28000 },
	cash: 29400,
	timeScaleIndex: R.constants.time.defaultIndex,
	timeScale: R.constants.time.scales[R.constants.time.defaultIndex],
	rocket: flightRocket,
	simTime: 0
};
R.sky.update(flightGame, 0.016);
R.render.draw(flightGame);

// The limiter row is shown in manual flight too, as OFF; with the autopilot on it names the active limits.
assert.ok(drawnText.indexOf('LIMITER') >= 0, 'flight HUD draws the limiter row');
assert.ok(drawnText.indexOf('Q + ACCEL LIMIT') < 0, 'no limiter is named while flying by hand');
assert.ok(drawnText.indexOf('COAST IMPACT') >= 0, 'flight HUD forecasts the coast impact while flying by hand');
assert.ok(drawnText.indexOf('COAST TOUCHDOWN') >= 0, 'and the speeds that coast would arrive with');
assert.ok(drawnText.indexOf('OUT OF HORIZON') >= 0, 'with no forecast yet the row says so instead of showing a stale point');

// The coast forecast is a property of the state, not of the autopilot, so the
// marker and its numbers belong to a hand-flown rocket too.
var coastGame = {
	currentPadId: R.world.currentPadId,
	targetPadId: R.world.targetPadId,
	phase: 'flying',
	flight: { cashDelta: -600, currentDynamicPressure: 24000, currentAngleOfAttack: 0.4, peakDynamicPressure: 28000 },
	cash: 29400,
	timeScaleIndex: R.constants.time.defaultIndex,
	timeScale: R.constants.time.scales[R.constants.time.defaultIndex],
	rocket: flightRocket
};
var coastError = Math.abs(R.trajectory.update(coastGame).targetError);

assert.ok(R.trajectory.impact.valid, 'the cruising state has a coast impact');
coastGame.simTime = 0;
R.sky.update(coastGame, 0.016);
drawnText.length = 0;
R.render.draw(coastGame);
assert.equal(drawnText.indexOf('OUT OF HORIZON'), -1, 'an in-range forecast replaces the horizon notice');
assert.ok(drawnText.indexOf('COAST') >= 0, 'the coast marker is labelled on the ground');
assert.ok(drawnText.indexOf(Math.abs(R.trajectory.impact.vy).toFixed(1)) >= 0, 'the HUD quotes the predicted sink rate');
assert.ok(drawnText.indexOf(Math.abs(R.trajectory.impact.vx).toFixed(1)) >= 0, 'and the predicted horizontal speed');
assert.ok(drawnText.indexOf(coastError >= 1000 ? (coastError / 1000).toFixed(1) : String(Math.round(coastError))) >= 0,
	'and how far the coast impact is from the selected pad');

// Damage: the flight HUD carries the structure the flight is wearing down and
// the failure that has just happened. Damage is off in this suite, so the rows
// are drawn from the model's own record rather than from a live flight.
assert.ok(drawnText.indexOf('STRUCTURE') >= 0, 'flight HUD draws the structure row');
assert.ok(drawnText.indexOf('ALARM') >= 0, 'and the alarm row');
R.damage.stageStress = R.constants.damage.scrapStress;
R.damage.alarm = R.damage.flags.LEAK;
R.damage.alarmTime = 1;
drawnText.length = 0;
R.render.draw(coastGame);
assert.ok(drawnText.indexOf(Math.round(R.damage.stageStress * 100) + ' %') >= 0,
	'a damaged stage is quoted as a share of the scrap threshold');
assert.ok(drawnText.indexOf('TANK LEAK') >= 0, 'a failure is named on the alarm row');
R.damage.stageStress = 0;
R.damage.alarm = 0;
R.damage.alarmTime = 0;
drawnText.length = 0;
R.render.draw(coastGame);
assert.equal(drawnText.indexOf('TANK LEAK'), -1, 'and it clears when the alarm expires');


R.trajectory.impact.valid = false;
drawnText.length = 0;
R.render.draw(coastGame);
assert.ok(drawnText.indexOf('OUT OF HORIZON') >= 0, 'an invalid forecast is announced');
assert.equal(drawnText.indexOf('COAST'), -1, 'and no marker is drawn for it');
R.trajectory.update(coastGame);

// The map shows one whole circumference, so the marker comes from the
// viewport's periodic copy of the impact longitude: a coast that wraps the world
// stays on screen, and at the seam it is drawn on both edges like the pads are.
var viewportLeft = flightRocket.wx - R.world.planet.circumference / 3;

function coastLabels() {
	return drawnText.filter(function(text) {
		return text === 'COAST';
	}).length;
}

R.trajectory.impact.wx = viewportLeft + R.world.planet.circumference + 3000;
drawnText.length = 0;
R.render.draw(coastGame);
assert.equal(coastLabels(), 1, 'a coast a whole world east is the same ground, drawn once inside the viewport');

R.trajectory.impact.wx = viewportLeft + 5;
drawnText.length = 0;
R.render.draw(coastGame);
assert.equal(coastLabels(), 2, 'a coast at the viewport seam is drawn on both edges');
R.trajectory.update(coastGame);

var autopilotFlight = {
	currentPadId: R.world.pads[0].id,
	targetPadId: R.world.pads[1].id,
	phase: 'flying',
	flight: { cashDelta: -600, currentDynamicPressure: 24000, currentAngleOfAttack: 0.4, peakDynamicPressure: 28000, autopilotProfile: 'gentle' },
	cash: 29400,
	timeScaleIndex: R.constants.time.defaultIndex,
	timeScale: R.constants.time.scales[R.constants.time.defaultIndex],
	rocket: flightRocket
};

R.autopilot.setEnabled(true);
R.autopilot.limiter = R.autopilot.limitFlags.Q | R.autopilot.limitFlags.ACCEL;
R.render.draw(autopilotFlight);
assert.ok(drawnText.indexOf('Q + ACCEL LIMIT') >= 0, 'flight HUD names the active limiters');
assert.ok(drawnText.indexOf('Gentle') >= 0, 'flight HUD names the profile the flight launched with');
R.autopilot.limiter = 0;
drawnText.length = 0;
R.render.draw(autopilotFlight);
assert.ok(drawnText.indexOf('—') >= 0, 'flight HUD shows a dash when nothing is limiting');
assert.equal(drawnText.indexOf('Q + ACCEL LIMIT'), -1, 'and no limiter name');
assert.equal(drawnText.indexOf('EARLY'), -1, 'and no staging marker on an ordinary frame');
R.autopilot.stagedEarly = true;
R.render.draw(autopilotFlight);
assert.ok(drawnText.indexOf('EARLY') >= 0, 'the HUD marks the frame an authority separation is commanded');
R.autopilot.stagedEarly = false;
R.autopilot.setEnabled(false);

// The page restores its campaign from storage before the first run; the suite
// hands it an empty store, so a start here is always a fresh company.
var campaignStore = {};

global.localStorage = {
	getItem: function(key) {
		return Object.prototype.hasOwnProperty.call(campaignStore, key) ? campaignStore[key] : null;
	},
	setItem: function(key, value) {
		campaignStore[key] = String(value);
	}
};

var main = require('../js/main.js');
main.start();

assert.ok(renderCalls > 100, 'renderer executed expected drawing operations');
assert.ok(drawnText.indexOf('ANGLE OF ATTACK') >= 0, 'flight HUD draws AoA telemetry');
assert.ok(drawnText.indexOf('PEAK Q') >= 0, 'flight HUD draws peak-Q telemetry');
assert.equal(canvas.width, 2560, 'canvas backing store uses device pixel ratio');
assert.equal(canvas.height, 1440, 'canvas backing store uses device pixel ratio');
assert.equal(typeof frameCallback, 'function', 'main schedules the animation frame');

// Drive the real frame loop: launch through the mission, then measure how much
// simulated time a fixed number of frames buys at two time scales.
var game = R.game;
var pads = R.world.pads;

var frames = 0;
var timestamp = 0;
var elapsedBefore;
var twoTimes;
var fourTimes;

assert.equal(R.operations.state.fleet.length, 1, 'a run starts with one rocket on the home pad');
assert.equal(game.phase, 'deck', 'a run starts at the operations deck');
assert.equal(R.flightLog.entries.length, 0, 'and with an empty flight log');

R.deck.sync(game);

// The dispatch card is live: the reference rocket sits on the home pad, so the
// only thing standing between the player and a flight is the send button.
assert.equal(fixture.getElementById('dispatch-send').disabled, false, 'a validated dispatch can be sent');
assert.equal(fixture.getElementById('dispatch-blocked').hidden, true, 'with no blocking reason to show');
assert.ok(fixture.getElementById('dispatch-summary').textContent.indexOf('ROCKET') >= 0,
	'the summary names the rocket it would use');
assert.ok(fixture.getElementById('dispatch-summary').textContent.indexOf(R.constants.parts.engines[0].label) >= 0,
	'and the parts the type is built from');
assert.ok(/PROFIT[+-]/.test(fixture.getElementById('dispatch-summary').textContent),
	'and the margin the leg books before it is sent');

// The service row reads the clock on the rocket at this pad.
assert.equal(fixture.getElementById('dispatch-maintenance').hidden, false, 'the service row shows the rocket on the pad');
assert.ok(fixture.getElementById('dispatch-maintenance-text').textContent.indexOf('S1 0/' +
	R.constants.parts.engines[0].maxThrottleSeconds + ' s') >= 0, 'with the seconds on its engine');
assert.equal(fixture.getElementById('dispatch-maintenance-buy').hidden, true, 'and nothing to buy yet');

// The milestone strip sits above every tab: the active rung, its progress and
// one dot per rung. Opened, it lists the whole ladder with its rewards.
var milestoneToggle = fixture.getElementById('milestone-toggle');
var milestoneLadder = fixture.getElementById('milestone-ladder');

assert.equal(fixture.getElementById('milestone-label').textContent, 'MILESTONE 1 / 6', 'the strip numbers the active milestone');
assert.equal(fixture.getElementById('milestone-title').textContent, R.constants.campaign.worlds.verdant[0].title,
	'and names it');
assert.equal(fixture.getElementById('milestone-progress').textContent, '0 / 1 delivered', 'with its progress');
assert.equal(fixture.getElementById('milestone-dots').childNodes.length, 6, 'one dot per rung');
assert.equal(milestoneLadder.hidden, true, 'the ladder starts folded');
milestoneToggle.click();
R.deck.sync(game);
assert.equal(milestoneLadder.hidden, false, 'a click on the strip opens it');
assert.equal(milestoneToggle.getAttribute('aria-expanded'), 'true');
assert.equal(milestoneLadder.querySelectorAll('li').length, 6, 'with every milestone of the world');
assert.ok(milestoneLadder.textContent.indexOf('$1,000 grant') >= 0, 'their rewards');
assert.ok(milestoneLadder.textContent.indexOf('Tinmoon opened') >= 0, 'and the world the ladder opens');
milestoneToggle.click();
R.deck.sync(game);
assert.equal(milestoneLadder.hidden, true, 'and a second click folds it');

// Gentle is listed but locked until its milestone, and the hint names it.
var profileOptions = fixture.getElementById('dispatch-profile').options;

assert.equal(profileOptions[0].disabled, false, 'the default profile is always selectable');
assert.equal(profileOptions[1].disabled, true, 'a profile the campaign has not opened is disabled');
assert.ok(profileOptions[1].textContent.indexOf('locked') >= 0, 'and says so');
assert.ok(fixture.getElementById('dispatch-profile-hint').textContent.indexOf('On the board (Verdant)') >= 0,
	'the hint names the milestone that opens it');

// The world menu shows where the company stands, and a locked world cannot be
// started from its card or by any other route into the menu.
var planetCards = fixture.getElementById('planet-list').querySelectorAll('.planet-card');

assert.equal(planetCards.length, R.planets.list.length, 'the menu lists every world');
assert.ok(planetCards[0].textContent.indexOf('0 / 6 MILESTONES') >= 0, 'an open world shows its ladder progress');
assert.equal(planetCards[1].disabled, true, 'a locked world is disabled');
assert.ok(planetCards[1].textContent.indexOf('LOCKED · CLEAR LONG REACH (VERDANT)') >= 0, 'and names the milestone that opens it');
planetCards[1].click();
assert.equal(R.world.planet.id, 'verdant', 'a click that reaches a locked card changes nothing');
assert.equal(R.menu.selectWorld('tinmoon'), false, 'the gate is in the menu, not only on the button');
assert.equal(R.game, game, 'and the run is untouched');

// A worn engine is a decision the card puts in front of the player: the reason,
// the price, and the one button that authorizes this leg to buy it.
var maintenanceRocket = R.operations.state.fleet[0];
maintenanceRocket.stageState[0].engineBurnTimeUsed = R.constants.parts.engines[0].maxThrottleSeconds + 1;
R.operations.touch();
R.deck.sync(game);
assert.equal(fixture.getElementById('dispatch-send').disabled, true, 'a worn engine holds the send button');
assert.equal(fixture.getElementById('dispatch-blocked').textContent, R.operations.reasons.NEEDS_OVERHAUL,
	'and says why');
assert.ok(fixture.getElementById('dispatch-maintenance-text').textContent.indexOf('OVERHAUL DUE $') >= 0,
	'the service row quotes the overhaul');
assert.equal(fixture.getElementById('dispatch-maintenance-buy').hidden, false, 'with a way to buy it');
fixture.getElementById('dispatch-maintenance-buy').click();
R.deck.sync(game);
assert.equal(fixture.getElementById('dispatch-send').disabled, false, 'authorizing it releases the leg');
assert.equal(fixture.getElementById('dispatch-maintenance-buy').hidden, true, 'and the authorization is spent');
assert.ok(fixture.getElementById('dispatch-summary').textContent.indexOf('overhaul $') >= 0,
	'so the leg itemizes the service it will buy');
maintenanceRocket.stageState[0].engineBurnTimeUsed = 0;
R.operations.touch();
R.deck.sync(game);
assert.equal(fixture.getElementById('dispatch-send').disabled, false, 'a serviced rocket needs no authorization');

// The authorization belongs to the pad it was quoted against: moving the leg to
// another pad clears it, so the price is put in front of the player again
// instead of being paid for a rocket that was never evaluated.
var overhaulType = R.operations.findType(maintenanceRocket.typeId);
var farportRocket = R.operations.createRocket(overhaulType, R.world.pads[2]);
farportRocket.stageState[0].engineBurnTimeUsed = R.constants.parts.engines[0].maxThrottleSeconds + 1;
var fromSelect = fixture.getElementById('dispatch-from');
fromSelect.value = R.world.pads[2].id;
fromSelect.dispatch('change', {});
R.deck.sync(game);
assert.equal(fixture.getElementById('dispatch-send').disabled, true, 'leaving the pad drops the authorization');
assert.equal(fixture.getElementById('dispatch-blocked').textContent, R.operations.reasons.NEEDS_OVERHAUL,
	'so the worn engine at the new pad holds the launch again');
assert.equal(fixture.getElementById('dispatch-maintenance-buy').hidden, false, 'with its price to buy again');
fromSelect.value = R.world.pads[0].id;
fromSelect.dispatch('change', {});
R.deck.sync(game);

fixture.getElementById('dispatch-send').click();
assert.equal(game.phase, 'flying', 'one click sends the mission on autopilot');
assert.equal(R.autopilot.enabled, true, 'and hands it to the autopilot');
assert.equal(game.flight.payloadMass, R.world.planet.defaultPayload, 'the mission carries the selected payload');
elapsedBefore = 0;
R.controls.setTimeScaleIndex(4);
while (frames < 12) {
	timestamp += 16.7;
	frameCallback(timestamp);
	frames += 1;
}
twoTimes = game.flight.elapsed - elapsedBefore;
assert.ok(game.rocket.wy > 0, 'frame loop lifts the rocket off the pad');
assert.ok(game.rocket.stages[0].fuelMass < R.world.planet.defaultFuel[0], 'frame loop burns fuel');

elapsedBefore = game.flight.elapsed;
R.controls.setTimeScaleIndex(6);
frames = 0;
while (frames < 12) {
	timestamp += 16.7;
	frameCallback(timestamp);
	frames += 1;
}
fourTimes = game.flight.elapsed - elapsedBefore;
assert.equal(game.timeScale, R.constants.time.scales[6], 'time scale index selects the multiplier');
assert.ok(fourTimes > 0 && fourTimes > twoTimes, 'a higher time scale buys more simulated time per frame');
assert.ok(R.util.mod(game.rocket.wx - pads[0].wx, R.world.planet.circumference) > 0, 'the frame loop flies downrange');

// Fly the leg out to its end: the deck reports it, the log keeps it.
frames = 0;
while (game.phase === 'flying' && frames < 4000) {
	timestamp += 16.7;
	frameCallback(timestamp);
	frames += 1;
}
assert.equal(game.phase, 'deck', 'the frame loop flies the leg to its end');
assert.equal(R.flightLog.entries.length, 1, 'and the finished leg is in the log');

// The delivered leg cleared the first milestone: the award sits under the
// debrief with the next goal, the strip has moved on, and the record is saved.
var awardCard = fixture.getElementById('dispatch-milestones');

assert.equal(game.lastReport.status, 'delivered', 'the reference leg delivers');
assert.equal(awardCard.hidden, false, 'the debrief shows the milestone the leg cleared');
assert.ok(awardCard.textContent.indexOf('MILESTONE 1 REACHED · First receipt') >= 0, 'by number and name');
assert.ok(awardCard.textContent.indexOf('$1,000 grant') >= 0, 'with its reward');
assert.ok(awardCard.textContent.indexOf('Next: On the board') >= 0, 'and the goal that is now active');
assert.equal(fixture.getElementById('milestone-label').textContent, 'MILESTONE 2 / 6', 'the strip moves to the next rung');
assert.ok(fixture.getElementById('deck-announcer').textContent.indexOf('Milestone reached: First receipt') >= 0,
	'and the award is announced');
assert.equal(JSON.parse(campaignStore[R.constants.campaign.storageKey]).completed['verdant:first-receipt'], true,
	'the settled leg saved the campaign record');
R.deck.setTab('log');
R.deck.sync(game);
assert.ok(fixture.getElementById('log-list').textContent.indexOf('NET') >= 0,
	'the log card itemizes the leg that just flew');

// Damage: a stack that came down damaged is repaired by the leg that flies it.
// Damage is off for the rest of this suite, so this block turns it on.
R.damage.enabled = true;
R.deck.setTab('dispatch');
var landedRocket = R.operations.state.fleet[0];
fromSelect.value = landedRocket.padId;
fromSelect.dispatch('change', {});
landedRocket.stageState[0].stress = 0.4;
R.deck.sync(game);
assert.ok(fixture.getElementById('dispatch-maintenance-text').textContent.indexOf('40% DAMAGED') >= 0,
	'the service line names the damage a stage carries');
assert.ok(fixture.getElementById('dispatch-maintenance-text').textContent.indexOf('REPAIR ON THIS LEG $') >= 0,
	'and quotes the repair the leg is about to buy');
assert.ok(fixture.getElementById('dispatch-summary').textContent.indexOf('repair $') >= 0,
	'the dispatch counts the repair in what the leg costs');
fixture.getElementById('dispatch-send').click();
assert.equal(game.phase, 'flying', 'the leg flies');
assert.ok(game.flight.repairCost > 0, 'and the flight record carries the repair it paid');
assert.equal(landedRocket.stageState[0].stress, 0, 'the stack was serviced before it launched');
R.damage.enabled = false;

// The market tab renders the board the project ships with, and a contract can
// be loaded straight into the dispatch card.
R.deck.setTab('market');
R.deck.sync(game);
var marketList = fixture.getElementById('market-list');
var contractLoads = marketList.querySelectorAll('.contract-load');

assert.ok(marketList.textContent.indexOf('DELIVERY') >= 0, 'the market tab quotes every pad');
assert.ok(marketList.textContent.indexOf('/kg') >= 0, 'in money per kilogram');
assert.ok(marketList.textContent.indexOf('served') >= 0, 'and how much each pad has been served');
assert.ok(/rival \d+ · \d+ kg/.test(marketList.textContent), 'including rival delivery count and kilograms');
assert.equal(fixture.getElementById('market-scoreboard').hidden, false, 'the Market tab shows company standings');
assert.equal(fixture.getElementById('score-rival-name').textContent, R.constants.competitor.name.toUpperCase(),
	'the scoreboard names the rival');
assert.ok(fixture.getElementById('score-rival-record').textContent.indexOf('REP') >= 0,
	'and shows its reputation');
assert.ok(contractLoads.length > 0, 'every pad board offers contracts to load');
contractLoads[0].click();
R.deck.sync(game);
assert.equal(R.deck.tab, 'dispatch', 'loading a contract moves to the dispatch card');
assert.equal(fixture.getElementById('dispatch-contract').hidden, false, 'which quotes the contract');
assert.equal(fixture.getElementById('dispatch-outbound').disabled, true, 'with the payload pinned to the posting');
assert.ok(fixture.getElementById('dispatch-summary').textContent.indexOf('PAYS') >= 0,
	'and the card quotes what the leg pays');
fixture.getElementById('dispatch-contract-clear').click();
R.deck.sync(game);
assert.equal(fixture.getElementById('dispatch-contract').hidden, true, 'clearing it drops back to a standing service');

// The self-explained deck: the stepper, the ranked trades, the pad picker,
// the type comparison and the capacity bar all render from the same
// evaluation the send buttons use. First settle the leg the service block
// left in the air, so the deck is free to dispatch again.
var openPad = R.world.findPadById(game.flight.targetPadId);

game.rocket.wx = openPad.wx;
game.rocket.wy = 0;
game.rocket.vx = 0;
game.rocket.vy = -2;
R.mission.touchdown(game);
R.deck.setTab('dispatch');
R.deck.sync(game);
assert.equal(game.phase, 'deck', 'the deck is free again');
assert.equal(fixture.getElementById('dispatch-step-pads').className, 'done', 'the stepper checks off the chosen pads');
assert.equal(fixture.getElementById('dispatch-step-mode').className, 'done', 'and the picked pilot');
var opportunityRows = fixture.getElementById('dispatch-opportunities').querySelectorAll('.opportunity-row');

assert.ok(opportunityRows.length > 0, 'the dispatch opens with ranked trades');
assert.ok(fixture.getElementById('dispatch-opportunities').textContent.indexOf('/min') >= 0,
	'each ranked by profit per minute');
assert.ok(fixture.getElementById('dispatch-compare').querySelectorAll('.compare-row').length ===
	R.operations.state.types.length + 1, 'the comparison lists every type plus the workshop row');
assert.ok(fixture.getElementById('dispatch-capacity').textContent.indexOf('bay') >= 0,
	'the capacity bar names the bay');
assert.ok(fixture.getElementById('dispatch-capacity').textContent.indexOf('wants') >= 0,
	'and what the destination will take');

// A From/To pair from the pad picker writes the same form state the selects do.
var padCards = fixture.getElementById('dispatch-pads').querySelectorAll('.pad-card');
var pickedPad = R.world.pads[2].id === fixture.getElementById('dispatch-from').value ?
	R.world.pads[3] : R.world.pads[2];

assert.equal(padCards.length, R.world.pads.length, 'the picker shows one card per pad');
assert.ok(padCards[0].textContent.indexOf('fuel $') >= 0, 'each card quotes fuel');
assert.ok(padCards[0].textContent.indexOf('served') >= 0, 'and what the pad has served');
padCards[R.world.padIndex(pickedPad.id)].querySelectorAll('button')[1].click();
R.deck.sync(game);
assert.equal(fixture.getElementById('dispatch-to').value, pickedPad.id, 'the To button sets the destination');

// A ranked row loads the same route into the dispatch form.
opportunityRows = fixture.getElementById('dispatch-opportunities').querySelectorAll('.opportunity-row');
opportunityRows[opportunityRows.length - 1].click();
R.deck.sync(game);
assert.notEqual(fixture.getElementById('dispatch-from').value, fixture.getElementById('dispatch-to').value,
	'a clicked trade loads its pads into the form');
assert.equal(fixture.getElementById('dispatch-contract').hidden, true, 'a standing trade loads no contract');

// The workshop plot: the caption quotes the design point, the bay limit and
// the launch TWR, and follows the design payload slider.
var dispatchRocket = R.operations.state.fleet[0];
var manualFrom = dispatchRocket.padId;
var manualTo = manualFrom === R.world.pads[0].id ? R.world.pads[1].id : R.world.pads[0].id;

R.builder.open(game, { typeId: R.operations.state.types[0].id, padId: manualFrom });
assert.equal(fixture.getElementById('workshop').hidden, false, 'the workshop opens from the deck');
assert.ok(fixture.getElementById('workshop-plot-caption').textContent.indexOf('bay limit') >= 0,
	'the plot caption quotes the bay limit');
assert.ok(fixture.getElementById('workshop-plot-caption').textContent.indexOf('design') >= 0,
	'the design payload point');
assert.ok(fixture.getElementById('workshop-plot-caption').textContent.indexOf('launch TWR') >= 0,
	'and the launch TWR');
var workshopPayload = fixture.getElementById('workshop-payload');

workshopPayload.value = '200';
workshopPayload.dispatch('input', {});
assert.ok(fixture.getElementById('workshop-plot-caption').textContent.indexOf('design 200 kg') >= 0,
	'moving the design payload redraws the caption');
fixture.getElementById('workshop-close').click();
assert.equal(fixture.getElementById('workshop').hidden, true, 'and the workshop closes');

// Manual launch: the send button that names it starts the leg cold, with no
// guidance, no throttle and no autopilot fee on the account.
fromSelect.value = manualFrom;
fromSelect.dispatch('change', {});
var toSelect = fixture.getElementById('dispatch-to');

toSelect.value = manualTo;
toSelect.dispatch('change', {});
fixture.getElementById('dispatch-pilot-manual').dispatch('change', {});
R.deck.sync(game);
assert.ok(fixture.getElementById('dispatch-pilot-hint').textContent.indexOf('no 10% fee') >= 0,
	'the pilot choice names what manual flight saves');
assert.equal(fixture.getElementById('dispatch-profile').disabled, true, 'manual flight has no profile to gate');
assert.equal(fixture.getElementById('dispatch-send').className, 'ghost-button wide',
	'the autopilot button stands down');
assert.equal(fixture.getElementById('dispatch-send-manual').className, 'launch-button',
	'and the manual button takes the launch styling');
var ledgerMark = game.ledger.length;

fixture.getElementById('dispatch-send-manual').click();
assert.equal(game.phase, 'flying', 'the manual button sends the leg');
assert.equal(game.flight.manual, true, 'the flight knows it was sent by hand');
assert.equal(game.flight.usedAutopilot, false, 'and that no guidance was bought');
assert.equal(R.autopilot.enabled, false, 'the autopilot stays off');
assert.equal(game.rocket.throttle, 0, 'the rocket starts cold on the pad');
assert.ok(game.ledger.slice(ledgerMark).every(function(entry) {
	return entry.type !== 'autopilot';
}), 'nothing on the ledger paid for guidance');
R.deck.sync(game);
assert.ok(fixture.getElementById('deck-announcer').textContent.indexOf('manual launch') >= 0,
	'the launch procedure is announced');
assert.equal(fixture.getElementById('flight-strip').hidden, false, 'the flight strip is up');
assert.ok(fixture.getElementById('flight-strip-text').textContent.indexOf('MANUAL · YOU FLY') >= 0,
	'and names who is flying');
assert.equal(fixture.getElementById('flight-strip-pilot').textContent, 'Hand back to autopilot (A)',
	'with the button that hands the rocket over');

// The flight HUD answers the pilot's questions while the manual leg sits on
// the pad: who flies, how to launch, where the cargo and delta-v stand, and
// which key stages the next slot.
drawnText.length = 0;
R.render.draw(game);
assert.ok(drawnText.indexOf('HOLD SHIFT TO LIFT OFF') >= 0, 'the pad callout says how to light the engine');
assert.ok(drawnText.indexOf('MANUAL · YOU FLY') >= 0, 'the HUD names the pilot');
assert.ok(drawnText.indexOf('V-SPEED') >= 0, 'the HUD shows vertical speed');
assert.ok(drawnText.indexOf('CARGO') >= 0, 'cargo');
assert.ok(drawnText.indexOf('DELTA-V LEFT') >= 0, 'delta-v remaining');
assert.ok(drawnText.indexOf('TOTAL FUEL') >= 0, 'total fuel');
assert.ok(drawnText.indexOf('BURNING') >= 0, 'the burning stage');
assert.ok(drawnText.indexOf('NEXT · SPACE') >= 0, 'and the key that lights the next one');
assert.ok(drawnText.indexOf('MOUSE CURSOR') >= 0, 'aim names the mouse');
assert.ok(drawnText.indexOf('SHIFT ▲ / CTRL ▼') >= 0, 'thrust names its keys');
assert.ok(drawnText.indexOf('A · HAND TO AUTOPILOT') >= 0, 'and the pilot row names the handoff key');

// The strip button is the autopilot toggle it looks like.
fixture.getElementById('flight-strip-pilot').click();
assert.equal(R.autopilot.enabled, true, 'one click hands the rocket to the autopilot');
assert.equal(game.flight.usedAutopilot, true, 'and the flight records who flies it');
R.deck.sync(game);
assert.equal(fixture.getElementById('flight-strip-pilot').textContent, 'Take over (A)',
	'the button flips to taking over');
assert.ok(fixture.getElementById('flight-strip-text').textContent.indexOf('AUTOPILOT · Balanced') >= 0,
	'the strip names the guidance and profile');
drawnText.length = 0;
R.render.draw(game);
assert.ok(drawnText.indexOf('AUTOPILOT · Balanced') >= 0, 'the HUD header follows the handoff');
assert.ok(drawnText.indexOf('A · TAKE OVER') >= 0, 'the pilot row flips its key hint');
assert.equal(drawnText.indexOf('HOLD SHIFT TO LIFT OFF'), -1, 'and the launch callout is gone');
fixture.getElementById('flight-strip-pilot').click();
assert.equal(R.autopilot.enabled, false, 'a second click hands it back');
assert.equal(game.flight.usedAutopilot, false, 'so the leg ends as the player flew it');

// Adjudicated where it says it landed: a manual delivery pays its quote and
// no guidance fee, whatever the pad was named.
var rewardQuote = game.flight.rewardQuote;
var settlePad = R.world.findPadById(game.flight.targetPadId);

game.rocket.wx = settlePad.wx;
game.rocket.wy = 0;
game.rocket.vx = 0;
game.rocket.vy = -2;
R.mission.touchdown(game);
assert.equal(game.phase, 'deck', 'the manual leg settles at its pad');
assert.equal(game.lastReport.status, 'delivered', 'as a delivery');
assert.equal(game.lastReport.reward, rewardQuote, 'paying the full quote');
assert.ok(game.lastReport.detail.indexOf('Autopilot fee') < 0, 'with no autopilot fee line');
assert.ok(game.ledger.slice(ledgerMark).every(function(entry) {
	return entry.type !== 'autopilot';
}), 'and no guidance spend anywhere on the leg');

// An opened world starts from its card: a fresh run on that world, with the
// deck, the strip and the menu all following it.
R.campaign.record.unlocks['world:tinmoon'] = true;
R.menu.show();
planetCards = fixture.getElementById('planet-list').querySelectorAll('.planet-card');
assert.equal(planetCards[1].disabled, false, 'an opened world is selectable');
assert.ok(planetCards[0].textContent.indexOf('1 / 6 MILESTONES') >= 0, 'and the menu counts what was cleared');
planetCards[1].click();
assert.equal(R.world.planet.id, 'tinmoon', 'its card starts a run there');
assert.notEqual(R.game, game, 'on a new game record');
game = R.game;
assert.equal(game.phase, 'deck', 'at the deck');
assert.equal(game.cash, R.constants.economy.startingCash, 'with the opening balance');
assert.equal(fixture.getElementById('planet-menu').hidden, true, 'the menu closes');
R.deck.sync(game);
assert.equal(fixture.getElementById('deck-world').textContent, 'Tinmoon', 'the deck header follows the world');
assert.equal(fixture.getElementById('milestone-title').textContent, R.constants.campaign.worlds.tinmoon[0].title,
	'and the strip shows the new world\'s ladder');

// A world won in flight opens the settlement card at the deck: the standing it
// was won on, and a way straight to the world menu.
R.deck.onMilestones([{
	milestone: R.constants.campaign.worlds.tinmoon[5],
	number: 6,
	rewardText: 'Dominant courier of Tinmoon',
	settlement: { cashLead: 4321, deliveries: 20, deliveryLead: 12, reputation: 80, legs: 20 },
	arcComplete: false
}]);
R.operations.touch();
R.deck.sync(game);
assert.equal(R.deck.dialog, 'settlement', 'a settlement opens its card');
assert.equal(fixture.getElementById('settlement-dialog').hidden, false);
assert.equal(fixture.getElementById('settlement-title').textContent, 'Dominant courier — Tinmoon', 'naming the world');
assert.ok(fixture.getElementById('settlement-summary').textContent.indexOf('$4,321') >= 0, 'the cash lead');
assert.ok(fixture.getElementById('settlement-detail').textContent.indexOf('REP 80') >= 0, 'and the reputation at the finish');
assert.equal(R.operations.blocked, true, 'automation holds while the card is up');
fixture.getElementById('settlement-worlds').click();
assert.equal(R.deck.dialog, null, 'the card closes');
assert.equal(fixture.getElementById('planet-menu').hidden, false, 'onto the world menu');
R.menu.hide();
R.deck.sync(game);
assert.equal(R.deck.dialog, null, 'and it is shown once, not on every render');

// Starting over asks twice, then erases the record and returns to the first world.
var resetButton = fixture.getElementById('planet-menu-reset');

R.menu.show();
resetButton.click();
assert.equal(R.campaign.worldUnlocked('tinmoon'), true, 'one click only arms the reset');
assert.ok(resetButton.textContent.indexOf('Erase') >= 0, 'and says what a second one does');
resetButton.click();
assert.equal(R.campaign.worldUnlocked('tinmoon'), false, 'the second click erases the campaign');
assert.equal(R.campaign.completedCount('verdant'), 0);
assert.equal(R.world.planet.id, R.planets.defaultId, 'and starts again on the first world');

delete global.localStorage;
delete global.document;
console.log('Render and app startup smoke test passed.');
