'use strict';

// Operations: fleet availability, mission legs, return policies, routes, the
// scheduler and the flight log. Legs that need a real flight use the real
// autopilot and physics; legs that only need an outcome are adjudicated by
// putting the rocket down where the test says it landed.

var assert = require('node:assert/strict');
var R = require('../js/namespaces.js');
require('../js/parts.js');

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
require('../js/damage.js');
require('../js/mission.js');
require('../js/aerodynamics.js');
require('../js/physics.js');
require('../js/trajectory.js');
require('../js/autopilot.js');
require('../js/operations.js');
require('../js/controls.js');
require('../js/input.js');

// Damage and failures are measured by experiments/failure.js; every other
// suite flies the 0.4 model, so a leg here is never at the mercy of a roll.
R.damage.enabled = false;

R.world.initialize('verdant');
R.camera.resize(1280, 720);

var pads = R.world.pads;
var home = pads[0];
var east = pads[1];
var far = pads[2];
var frameDt = 1 / 120;

function createRun(cash) {
	var run = {
		currentPadId: home.id,
		targetPadId: east.id,
		rocket: R.rocket.create(home),
		phase: 'deck',
		cash: cash === undefined ? 1e6 : cash,
		ledger: [],
		flight: null,
		mission: null,
		lastReport: null,
		selection: { sourcePadId: home.id, targetPadId: east.id, mode: 'oneway', visible: true },
		simTime: 0,
		physicsAccumulator: 0,
		timeScaleIndex: R.constants.time.defaultIndex,
		timeScale: 4
	};

	R.game = run;
	R.operations.initialize();
	R.autopilot.setEnabled(false);
	return run;
}

function send(spec) {
	var filled = {
		source: home.id,
		destination: east.id,
		mode: 'oneway',
		fuelPolicy: 'refuel',
		outboundPayload: R.world.planet.defaultPayload,
		returnPayload: 0,
		typeId: R.operations.state.types[0].id,
		rocketId: null,
		profileId: 'balanced'
	};
	var key;

	for (key in spec) {
		filled[key] = spec[key];
	}
	return R.operations.dispatch(filled);
}

// Real flight, frame loop order, at the run's time scale.
function fly(game) {
	var frames = 0;

	while (game.phase === 'flying' && frames < 40000) {
		R.controls.update(game, frameDt * game.timeScale);
		R.physics.advance(game, frameDt);
		frames += 1;
	}
	assert.notEqual(game.phase, 'flying', 'the flight reaches an outcome');
}

// Put the rocket down at a pad with the speeds given, then adjudicate.
function land(game, pad, verticalSpeed) {
	game.rocket.wx = pad.wx;
	game.rocket.wy = 0;
	game.rocket.vx = 0;
	game.rocket.vy = verticalSpeed === undefined ? -2 : verticalSpeed;
	return R.mission.touchdown(game);
}

function rocketOf(game) {
	return R.operations.findRocket(game.mission ? game.mission.rocketId : R.operations.state.fleet[0].id);
}

function fleetFuel(rocket) {
	var total = 0;
	var i;

	for (i = 0; i < rocket.stageCount; i += 1) {
		total += rocket.stageState[i].alive ? rocket.stageState[i].fuelMass : 0;
	}
	return total;
}

function aliveCount(rocket) {
	var count = 0;
	var i;

	for (i = 0; i < rocket.stageCount; i += 1) {
		count += rocket.stageState[i].alive ? 1 : 0;
	}
	return count;
}

// ------------------------------------------------------------ pad distances

var circumference = R.world.planet.circumference;
var i;
var j;

for (i = 0; i < pads.length; i += 1) {
	for (j = 0; j < pads.length; j += 1) {
		if (i === j) {
			assert.equal(R.operations.legDistance(pads[i].id, pads[j].id), 0);
			continue;
		}
		var direct = Math.abs(R.util.wrapDelta(pads[j].wx - pads[i].wx, circumference));
		var shortest = Math.min(direct, circumference - direct);

		assert.ok(Math.abs(R.operations.legDistance(pads[i].id, pads[j].id) - shortest) < 1e-9,
			pads[i].name + ' to ' + pads[j].name + ' quotes the shortest wrapped path');
		assert.equal(R.operations.legDistance(pads[i].id, pads[j].id),
			R.operations.legDistance(pads[j].id, pads[i].id), 'and it is the same both ways round');
	}
}

// --------------------------------------------------------------- one-way leg

// The 10 km route is used wherever a test needs a stage to have been shed: the
// 5 km hop lands on its booster.
var game = createRun();
var referenceType = R.operations.state.types[0];
var firstRocket = R.operations.state.fleet[0];
var cashBefore = game.cash;

assert.equal(firstRocket.status, 'available');
assert.equal(firstRocket.padId, home.id, 'a run starts with one rocket at the home pad');
assert.equal(send({ destination: far.id }).ok, true, 'a validated one-way dispatch launches');
assert.equal(game.phase, 'flying');
assert.equal(firstRocket.status, 'flying', 'the rocket is reserved by the mission');
assert.equal(game.cash, cashBefore, 'a complete, fuelled rocket costs nothing to send');
assert.equal(game.flight.leg, 1);
assert.equal(game.flight.legCount, 1);
assert.equal(game.mission.currentLeg, 1);

fly(game);

assert.equal(game.phase, 'deck', 'the deck comes back after the flight');
assert.equal(game.lastReport.status, 'delivered', 'the reference route delivers on autopilot');
assert.equal(game.currentPadId, far.id);
assert.equal(firstRocket.padId, far.id, 'a one-way rocket stays where it landed');
assert.equal(firstRocket.status, 'available', 'and is ready to fly again from there');
assert.equal(firstRocket.activeMissionId, null, 'the mission released it');
assert.equal(game.mission, null, 'the mission is finished');
assert.ok(aliveCount(firstRocket) < 3, 'the stages it separated did not come back');
assert.equal(R.flightLog.entries.length, 1, 'the leg is logged');
assert.equal(R.flightLog.entries[0].status, 'delivered');
assert.equal(R.flightLog.entries[0].landingPadId, far.id);
assert.ok(R.flightLog.entries[0].fuelUsed > 0, 'with the fuel it actually burned');
assert.ok(game.cash > cashBefore, 'and the delivery paid');

// The next leg from the same pad now has to buy back what the flight spent.
var legTwo = R.operations.evaluateLeg(referenceType.id, far.id, R.world.planet.defaultPayload, true, null);
assert.equal(legTwo.ready, true, 'the landed rocket can fly again from the pad it landed on');
assert.ok(legTwo.cost > 0, 'but only after paying for structure and fuel');
assert.ok(legTwo.dryMass > 0, 'the separated stages are replaced');
assert.ok(legTwo.fuelMass > 0, 'and the tanks are filled');

var preparationCash = game.cash;
assert.equal(send({ source: far.id, destination: home.id }).ok, true);
assert.equal(game.flight.turnaroundCost, legTwo.dryMass * R.economy.priceSteel(far.id),
	'the leg records the structure it bought at the pad it bought it');
assert.equal(game.flight.fuelCost, legTwo.fuelMass * R.economy.priceFuel(far.id), 'and the fuel it loaded');
assert.ok(Math.abs(game.cash - (preparationCash - legTwo.cost)) < 1e-9, 'charged once, at launch');
assert.equal(firstRocket.status, 'flying');
land(game, home);
assert.equal(aliveCount(firstRocket), 3, 'the turnaround restored the full stack for the flight');
assert.equal(R.flightLog.entries.length, 2);

// ------------------------------------------------------ availability reasons

game = createRun();
assert.equal(R.operations.evaluateLeg(referenceType.id, far.id, 80, true, null).reason,
	R.operations.reasons.NO_ROCKET + far.name.toUpperCase(), 'an empty pad names itself');

var buildResult = R.operations.buildRocket(referenceType.id, far.id);
assert.equal(buildResult.ok, true, 'a rocket can be built where one is needed');
assert.equal(R.operations.state.fleet.length, 2);
assert.equal(R.operations.evaluateLeg(referenceType.id, far.id, 80, true, null).ready, true,
	'and the pad is served from then on');

assert.equal(send({ source: far.id, destination: home.id }).ok, true);
assert.equal(send({ source: far.id, destination: home.id }).reason, R.operations.reasons.BUSY,
	'a second dispatch while one flies is refused');
assert.equal(R.operations.evaluateLeg(referenceType.id, far.id, 80, true, null).reason,
	R.operations.reasons.ROCKET_BUSY, 'the only rocket of the type there is in the air');
land(game, far);

game.cash = 0;
R.operations.state.fleet[1].stageState[0].alive = false;
assert.equal(R.operations.evaluateLeg(referenceType.id, far.id, 80, true, null).reason,
	R.operations.reasons.INSUFFICIENT_FUNDS, 'a leg the balance cannot prepare says so');
assert.equal(send({ source: far.id, destination: home.id }).ok, false, 'and cannot be dispatched');
game.cash = 1e6;

assert.equal(R.operations.evaluateLeg(referenceType.id, home.id, 99999, true, null).reason,
	R.operations.reasons.PAYLOAD_OVER, 'a payload the type cannot lift is refused');

// --------------------------------------------------------- return, refuelled

game = createRun();
var returnDispatch = send({
	destination: far.id,
	mode: 'return',
	fuelPolicy: 'refuel',
	outboundPayload: 80,
	returnPayload: 45
});

assert.equal(returnDispatch.ok, true);
assert.equal(game.flight.legCount, 2, 'a return mission has two legs');
assert.equal(game.mission.mode, 'return');
fly(game);

assert.equal(game.lastReport.status, 'delivered', 'the outbound leg delivers');
assert.equal(game.mission.status, 'awaiting-return', 'and the mission stays open for the leg back');
assert.equal(game.mission.currentLeg, 2);
assert.equal(game.mission.legFrom, far.id, 'the deck and the map point at the leg back');
assert.equal(game.mission.legTo, home.id);
assert.equal(game.phase, 'deck', 'the return is an explicit step, so the bill is on screen first');
var outboundRocket = rocketOf(game);
assert.equal(outboundRocket.status, 'available');
assert.equal(outboundRocket.activeMissionId, game.mission.id, 'but it is still reserved for the mission');
assert.equal(outboundRocket.padId, far.id);

var outboundEntry = R.flightLog.entries[0];
var fuelLeftAfterOutbound = fleetFuel(outboundRocket);
var stagesLeftAfterOutbound = aliveCount(outboundRocket);
var returnPlan = R.operations.evaluateLeg(referenceType.id, far.id, 45, true, outboundRocket.id);
assert.ok(returnPlan.fuelMass > 0, 'the return has fuel to buy');
assert.ok(returnPlan.dryMass > 0, 'and stages to replace');

var returnCash = game.cash;
assert.equal(R.operations.sendReturnLeg().ok, true);
assert.equal(game.phase, 'flying');
assert.equal(game.flight.leg, 2, 'the flight HUD knows which leg it is on');
assert.equal(game.flight.legCount, 2);
assert.equal(game.flight.payloadMass, 45, 'the return payload is loaded, not the outbound one');
assert.equal(game.rocket.payloadMass, 45, 'and it is what the rocket carries');
assert.equal(game.currentPadId, far.id);
assert.equal(game.targetPadId, home.id);
assert.equal(game.flight.fuelCost, returnPlan.fuelMass * R.economy.priceFuel(far.id), 'charged for the fuel loaded');
assert.equal(game.flight.turnaroundCost, returnPlan.dryMass * R.economy.priceSteel(far.id), 'and the structure replaced');
assert.ok(Math.abs(game.cash - (returnCash - returnPlan.cost)) < 1e-9, 'once, at the return launch');
assert.ok(game.flight.fuelAboard > fuelLeftAfterOutbound, 'the refuel really filled the tanks');
assert.equal(aliveCount(rocketOf(game)), 3, 'and the refuel policy restores the launch configuration');

fly(game);
assert.equal(game.lastReport.status, 'delivered', 'the return leg delivers home');
assert.equal(game.mission, null, 'the mission completes when the rocket is back');
assert.equal(outboundRocket.padId, home.id, 'where it started');
assert.equal(outboundRocket.status, 'available');
assert.equal(outboundRocket.activeMissionId, null, 'and released');
assert.equal(R.flightLog.entries.length, 2, 'both legs are logged');
assert.equal(R.flightLog.entries[0].leg, 2, 'newest first');
assert.equal(R.flightLog.entries[0].legCount, 2, 'with the leg number of the mission');
assert.equal(R.flightLog.entries[1].leg, 1);
assert.ok(stagesLeftAfterOutbound < 3, 'the outbound leg really did shed stages before the turnaround');

// ------------------------------------------------- return on remaining fuel

game = createRun();
send({ destination: far.id, mode: 'return', fuelPolicy: 'none', outboundPayload: 80, returnPayload: 30 });
fly(game);
assert.equal(game.mission.status, 'awaiting-return', 'a no-refuel return is still offered when the stack can lift');

var noRefuelRocket = rocketOf(game);
var fuelAtTouchdown = fleetFuel(noRefuelRocket);
var stagesAtTouchdown = aliveCount(noRefuelRocket);
var noRefuelCash = game.cash;

assert.equal(R.operations.sendReturnLeg().ok, true);
assert.equal(game.flight.fuelAboard, fuelAtTouchdown, 'the return launches on exactly the fuel that landed');
assert.equal(aliveCount(noRefuelRocket), stagesAtTouchdown, 'and on exactly the stages that survived');
assert.equal(game.flight.fuelCost, 0, 'nothing is bought');
assert.equal(game.flight.turnaroundCost, 0, 'and nothing is rebuilt');
assert.equal(game.cash, noRefuelCash, 'so the balance does not move');
assert.equal(game.flight.payloadMass, 30, 'the return payload is still its own number');
fly(game);
assert.equal(R.flightLog.entries.length, 2);
assert.equal(R.flightLog.entries[0].fuelStart, fuelAtTouchdown, 'the log quotes the fuel the return started with');

// A surviving stack that cannot lift the return payload ends the mission where
// it stands instead of inventing delta-v. A leg's cargo is capped by the
// destination's appetite, so this run widens that appetite — through the
// planet's reference load, which is what demand derives from — to put a heavy
// return payload in the air: the guard under test is the launch gate, not the
// market.
var referenceLoad = R.world.planet.defaultPayload;

R.world.planet.defaultPayload = Math.ceil(600 / R.constants.market.demandFactor);
game = createRun();
var weakTop = R.operations.addType({
	name: 'Weak upper stage',
	stageCount: 3,
	stages: [
		{ fuelMass: 1200, strength: 0.9 },
		{ fuelMass: 400, strength: 0.9 },
		{ fuelMass: R.constants.rocket.minFuelMass, strength: 0.9 }
	],
	nominalPayload: 80,
	defaultProfileId: 'balanced'
});
R.operations.createRocket(weakTop, home);
var strandedPayload = 600;
var weakDispatch = send({
	mode: 'return',
	fuelPolicy: 'none',
	outboundPayload: 80,
	returnPayload: strandedPayload,
	typeId: weakTop.id,
	rocketId: R.operations.state.fleet[1].id
});
R.world.planet.defaultPayload = referenceLoad;
assert.equal(weakDispatch.ok, true, 'the full stack lifts a heavy payload');
R.rocket.separateStage(game.rocket);
R.rocket.separateStage(game.rocket);
var stranded = R.rocket.captureStageState(game.rocket, R.rocket.createStageState());

assert.ok(R.rocket.launchTwr(weakTop, stranded, strandedPayload) < R.constants.rocket.minimumLaunchTwr,
	'what survived cannot lift the return payload, so the return must be refused');
land(game, east);

assert.equal(game.lastReport.status, 'return-blocked', 'the mission is refused, not faked');
assert.match(game.lastReport.detail, /no fuel or structure was added/);
assert.equal(game.mission, null, 'and it is over');
assert.equal(R.operations.state.fleet[1].status, 'available', 'the rocket is parked safely');
assert.equal(R.operations.state.fleet[1].padId, east.id, 'where it landed');
assert.equal(R.flightLog.entries.length, 2, 'both legs are in the log');
assert.equal(R.flightLog.entries[0].status, 'return-blocked', 'including the one that never flew');
assert.equal(R.flightLog.entries[0].cashDelta, 0, 'which charged nothing');

// ------------------------------------------------------------ crash and loss

game = createRun();
var crashDispatch = send({});
var crashRocket = R.operations.findRocket(crashDispatch.mission.rocketId);
game.rocket.wx = east.wx - 1200;
game.rocket.wy = 0;
game.rocket.vx = 0;
game.rocket.vy = -60;
R.mission.touchdown(game);

assert.equal(game.lastReport.status, 'crashed');
assert.equal(crashRocket.status, 'lost', 'a crashed rocket is never reused');
assert.equal(crashRocket.activeMissionId, null);
assert.equal(game.mission, null);
assert.equal(R.operations.evaluateLeg(referenceType.id, home.id, 80, true, null).reason,
	R.operations.reasons.NO_ROCKET + home.name.toUpperCase(), 'and the pad it left is empty');
assert.equal(R.flightLog.entries[0].status, 'crashed', 'a crash is logged like any other leg');
assert.equal(R.flightLog.entries[0].landingPadId, null, 'with no pad to its name');
assert.equal(R.flightLog.entries[0].payloadDamage, 1, 'a crash delivers none of the cargo');
assert.equal(R.flightLog.entries[0].repairCost, 0, 'and a written-off stack is never repaired');

// A rupture is the ending the damage model reaches on its own: the flight
// never lands, so the log has to say what happened to it.
game = createRun();
var ruptureDispatch = send({});
var ruptureRocket = R.operations.findRocket(ruptureDispatch.mission.rocketId);
game.rocket.wy = 900;
game.rocket.vy = 40;
R.mission.rupture(game);

assert.equal(game.lastReport.title, 'TANK RUPTURE · VEHICLE LOST', 'a rupture is its own ending, not a crash on landing');
assert.equal(game.lastReport.status, 'crashed', 'and it is still a loss');
assert.equal(ruptureRocket.status, 'lost', 'the vehicle is gone');
assert.equal(R.flightLog.entries[0].cause, 'rupture', 'the log keeps why the flight ended');
assert.equal(R.flightLog.entries[0].payloadDamage, 1, 'and that no cargo survived it');
assert.equal(R.flightLog.entries[0].landingPadId, null, 'it never reached a pad');
assert.match(game.lastReport.detail, /came apart in the air/, 'and the debrief says so in words');

// ------------------------------------------------------------------- routes

game = createRun();
var route = R.operations.createRoute({
	name: 'Home to east',
	source: home.id,
	destination: east.id,
	mode: 'oneway',
	fuelPolicy: 'refuel',
	outboundPayload: 80,
	returnPayload: 0,
	typeId: referenceType.id,
	profileId: 'balanced',
	enabled: true
});
var laterRoute = R.operations.createRoute({
	name: 'Second claim',
	source: home.id,
	destination: far.id,
	mode: 'oneway',
	fuelPolicy: 'refuel',
	outboundPayload: 80,
	returnPayload: 0,
	typeId: referenceType.id,
	profileId: 'balanced',
	enabled: true
});
laterRoute.createdAt = route.createdAt + 1000;

assert.equal(R.operations.refreshRoutes(null).id, route.id, 'the oldest ready route is offered first');
assert.equal(route.status, 'ready');
assert.equal(route.waitReason, '', 'with no wait reason to show');

R.operations.setRouteEnabled(route.id, false);
assert.equal(R.operations.refreshRoutes(null).id, laterRoute.id, 'a paused route is skipped');
assert.equal(route.status, 'paused');
assert.equal(route.waitReason, R.operations.reasons.PAUSED);
R.operations.setRouteEnabled(route.id, true);

// One foreground simulation: sending the first leaves the second queued.
assert.equal(R.operations.dispatchRoute(route.id).ok, true);
assert.equal(route.status === 'ready', false);
R.operations.refreshRoutes(null);
assert.equal(laterRoute.waitReason, R.operations.reasons.ROCKET_BUSY, 'the competing route says why it waits');
land(game, east);
assert.equal(route.completedLegs, 1, 'a delivered leg counts on the route');
assert.equal(route.failedLegs, 0);
assert.ok(route.lastRunAt > 0, 'and stamps its last run');
R.operations.refreshRoutes(null);
assert.equal(laterRoute.waitReason, R.operations.reasons.NO_ROCKET + home.name.toUpperCase(),
	'a one-way rocket stays at its destination, so the home pad is empty again');

R.operations.buildRocket(referenceType.id, home.id);
R.operations.refreshRoutes(null);
assert.equal(laterRoute.status, 'ready', 'the route becomes ready when a matching rocket arrives');

// A route with a leg in the air keeps its rocket type.
var otherType = R.operations.addType({
	name: 'Alternative',
	stageCount: 3,
	stages: R.world.planet.defaultFuel.map(function(fuelMass, index) {
		return { fuelMass: fuelMass, strength: R.constants.rocket.defaultStageStrength[index] };
	}),
	nominalPayload: 80,
	defaultProfileId: 'gentle'
});

assert.equal(R.operations.dispatchRoute(laterRoute.id).ok, true);
assert.equal(R.operations.changeRouteType(laterRoute.id, otherType.id).reason, R.operations.reasons.BUSY,
	'a flying route keeps its type');
land(game, far);
assert.ok(R.operations.changeRouteType(laterRoute.id, otherType.id).ok, 'an idle route can change type');
assert.equal(laterRoute.typeId, otherType.id);
assert.equal(R.flightLog.entries[0].rocketTypeId, referenceType.id, 'and history keeps the type it flew');

// A crash on a route counts as a failed leg.
var failedRoute = R.operations.createRoute({
	name: 'Risky',
	source: home.id,
	destination: east.id,
	mode: 'oneway',
	fuelPolicy: 'refuel',
	outboundPayload: 80,
	returnPayload: 0,
	typeId: referenceType.id,
	profileId: 'balanced',
	enabled: true
});
R.operations.buildRocket(referenceType.id, home.id);
assert.equal(R.operations.dispatchRoute(failedRoute.id).ok, true, 'the risky route gets a rocket');
game.rocket.wx = east.wx - 1500;
game.rocket.vy = -80;
game.rocket.wy = 0;
R.mission.touchdown(game);
assert.equal(failedRoute.failedLegs, 1, 'a crash increments the route failures');
assert.equal(failedRoute.completedLegs, 0);

// ------------------------------------------------- log retention and counters

R.flightLog.limit = 4;
R.flightLog.reset();
game = createRun();
var counted = R.operations.createRoute({
	name: 'Shuttle',
	source: home.id,
	destination: east.id,
	mode: 'oneway',
	fuelPolicy: 'refuel',
	outboundPayload: 80,
	returnPayload: 0,
	typeId: referenceType.id,
	profileId: 'balanced',
	enabled: true
});
var legs;

for (legs = 0; legs < 7; legs += 1) {
	R.operations.buildRocket(referenceType.id, home.id);
	assert.equal(R.operations.dispatchRoute(counted.id).ok, true, 'leg ' + legs + ' dispatches');
	land(game, east);
}
assert.equal(R.flightLog.entries.length, 4, 'the log keeps its named limit');
assert.equal(counted.completedLegs, 7, 'while the route counters keep every leg');
assert.equal(R.flightLog.countByRoute(counted.id), 4, 'and only the retained rows are still queryable');
R.flightLog.limit = R.constants.operations.flightLogLimit;

// ------------------------------------------- scheduler, offers and automation

game = createRun();
var autoRoute = R.operations.createRoute({
	name: 'Automatic',
	source: home.id,
	destination: east.id,
	mode: 'oneway',
	fuelPolicy: 'refuel',
	outboundPayload: 80,
	returnPayload: 0,
	typeId: referenceType.id,
	profileId: 'balanced',
	enabled: true
});

R.operations.setRouteAutoLaunch(autoRoute.id, true);
R.operations.run(game, 1 / 60);
assert.ok(R.operations.state.offer, 'a ready route raises an offer');
assert.equal(R.operations.state.offer.autoLaunch, false,
	'but a route that has never delivered still asks, however it is configured');
assert.equal(R.operations.state.offer.routeId, autoRoute.id);
R.operations.run(game, 10);
assert.equal(game.phase, 'deck', 'and waiting does not launch anything');

R.operations.cancelOffer();
assert.equal(R.operations.state.offer, null, 'an offer can be declined');
R.operations.run(game, 1 / 60);
assert.equal(R.operations.state.offer, null, 'a declined route is not re-offered at once');

// One delivered leg is what unlocks automation for the route, and touching the
// route is what makes the scheduler look again: a dismissal is not a permanent
// veto, it lasts until the route's own state moves.
R.operations.setRouteEnabled(autoRoute.id, true);
R.operations.run(game, 1 / 60);
var acceptResult = R.operations.acceptOffer();
assert.equal(acceptResult.ok, true, 'an offer can be accepted: ' + acceptResult.reason);
land(game, east);
assert.equal(autoRoute.completedLegs, 1);
R.operations.buildRocket(referenceType.id, home.id);

R.operations.run(game, 1 / 60);
assert.equal(R.operations.state.offer.autoLaunch, true, 'auto-launch is opt-in and earned');
R.operations.run(game, 0.1);
assert.equal(game.phase, 'deck', 'and counts down before it fires');
assert.ok(R.operations.state.countdown < R.operations.autoLaunchSeconds, 'visibly');
R.operations.cancelOffer();
assert.equal(game.phase, 'deck', 'and the countdown can be cancelled');
R.operations.setRouteEnabled(autoRoute.id, true);
R.operations.run(game, 1 / 60);
R.operations.run(game, R.operations.autoLaunchSeconds + 0.1);
assert.equal(game.phase, 'flying', 'then launches on its own');
assert.equal(game.mission.routeId, autoRoute.id, 'as a leg of that route');
land(game, east);
assert.equal(autoRoute.completedLegs, 2);

// Automation never fires behind an open dialog.
game = createRun();
R.operations.createRoute({
	name: 'Behind a dialog',
	source: home.id,
	destination: east.id,
	mode: 'oneway',
	fuelPolicy: 'refuel',
	outboundPayload: 80,
	returnPayload: 0,
	typeId: referenceType.id,
	profileId: 'balanced',
	enabled: true
});
R.operations.setRouteAutoLaunch(R.operations.state.routes[0].id, true);
R.operations.blocked = true;
R.operations.run(game, 1 / 60);
R.operations.run(game, R.operations.autoLaunchSeconds + 1);
assert.equal(game.phase, 'deck', 'an open dialog pauses automation');
assert.equal(R.operations.state.offer, null);
R.operations.blocked = false;

// ------------------------------------------------------- snapshots and types

game = createRun();
send({});
land(game, east);
var entry = R.flightLog.entries[0];
var snapshot = entry.rocketTypeSnapshot;

assert.equal(snapshot.stageCount, referenceType.stageCount, 'the log keeps its own build snapshot');
assert.equal(snapshot.stages.length, referenceType.stageCount);
R.operations.state.types.length = 0;
R.operations.touch();
var spec = R.operations.routeSpecFromLog(entry);
assert.equal(spec.typeId, null, 'a route from a log row notices a type that is gone');
assert.equal(spec.source, entry.departedPadId, 'and pre-fills the pads it flew');
assert.equal(spec.destination, entry.targetPadId);
assert.equal(spec.outboundPayload, entry.payloadMass, 'and the cargo it carried');
assert.equal(spec.profileId, entry.profileId, 'and the profile that flew it');
var restored = R.operations.restoreTypeFromSnapshot(spec.typeSnapshot);
spec.typeId = restored.id;
var savedRoute = R.operations.saveRoute(null, spec);
assert.equal(savedRoute.ok, true, 'so the route can be saved against the restored type');
assert.equal(R.operations.findRoute(savedRoute.routeId).typeId, restored.id);
assert.equal(R.operations.findRoute(savedRoute.routeId).enabled, false, 'and it waits for review before it runs');

var oversized = {
	name: 'Too heavy',
	source: home.id,
	destination: east.id,
	mode: 'return',
	fuelPolicy: 'refuel',
	outboundPayload: 10,
	returnPayload: 99999,
	typeId: restored.id,
	profileId: 'balanced',
	enabled: true
};
assert.equal(R.operations.saveRoute(null, oversized).reason, R.operations.reasons.PAYLOAD_OVER,
	'a route that cannot carry its own return payload is refused');
assert.equal(R.operations.saveRoute(null, oversized).ok, false);

R.operations.deleteRoute(savedRoute.routeId);
assert.equal(R.operations.findRoute(savedRoute.routeId), null, 'a deleted route is gone');

// A planet change is a separate operations save.
R.world.initialize('cinder');
game = createRun();
assert.equal(R.operations.state.planetId, 'cinder');
assert.equal(R.operations.state.routes.length, 0, 'no route crosses worlds');
assert.equal(R.operations.state.types.length, 1, 'no type crosses worlds');
assert.equal(R.operations.state.types[0].name, 'Cinder reference');
assert.equal(R.operations.state.fleet.length, 1, 'and the fleet starts again');
assert.equal(R.operations.state.fleet[0].padId, R.world.pads[0].id, 'at the new world home pad');
assert.equal(R.flightLog.entries.length, 0, 'with its own log');

console.log('Operations, fleet, route and log tests passed.');
