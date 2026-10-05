'use strict';

var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var dom = require('./dom.js');
var R = require('../js/namespaces.js');
require('../js/parts.js');

var fixture = dom.createDocument(fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8'));

global.document = fixture;
global.addEventListener = function() {};

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
require('../js/builder.js');
require('../js/deck.js');
require('../js/controls.js');

// Damage and failures are measured by experiments/failure.js; every other
// suite flies the 0.4 model, so a leg here is never at the mercy of a roll.
R.damage.enabled = false;

function byId(id) {
	var element = fixture.getElementById(id);

	assert.ok(element, 'the shipped markup has #' + id);
	return element;
}

function number(element) {
	return Number(element.textContent.replace(/,/g, ''));
}

function createRun() {
	var home = R.world.pads[0];
	var run = {
		currentPadId: home.id,
		targetPadId: R.world.pads[1].id,
		rocket: R.rocket.create(home),
		phase: 'deck',
		cash: R.economy.startingCash,
		ledger: [],
		flight: null,
		mission: null,
		lastReport: null,
		selection: { sourcePadId: home.id, targetPadId: R.world.pads[1].id, mode: 'oneway', visible: true },
		simTime: 0,
		physicsAccumulator: 0,
		timeScaleIndex: R.constants.time.defaultIndex,
		timeScale: 1
	};

	R.game = run;
	R.operations.initialize();
	return run;
}

R.world.initialize('verdant');
R.camera.resize(1280, 720);
var game = createRun();
R.builder.initialize(game);
R.deck.initialize(game);
R.deck.sync(game);

var referenceType = R.operations.state.types[0];

assert.equal(R.builder.initialized, true, 'the workshop initialises against the shipped markup');
assert.equal(byId('workshop').hidden, true, 'and stays closed until it is opened');
assert.equal(R.operations.state.fleet.length, 1, 'a run starts with one rocket of the reference type');

// ------------------------------------------------------------ workshop dialog

var sendBefore = fixture.activeElement;

R.builder.open(game, { typeId: referenceType.id, padId: R.world.pads[0].id });
assert.equal(byId('workshop').hidden, false, 'the workshop opens as a dialog');
assert.equal(R.deck.dialog, 'workshop');
assert.equal(R.operations.blocked, true, 'an open dialog pauses automation');
assert.notEqual(fixture.activeElement, sendBefore, 'focus moves into the dialog');
assert.equal(byId('workshop-title').textContent, 'Edit rocket type', 'an existing type is edited, not copied');
assert.equal(byId('workshop-name').value, referenceType.name);
assert.ok(number(byId('workshop-capacity')) > 0, 'the type quotes its payload capacity');
assert.match(byId('workshop-twr').textContent, /: 1$/, 'and its launch TWR on this world');

// A stage edit moves the numbers the player prices against.
var massBefore = number(byId('workshop-mass'));
var costBefore = number(byId('workshop-cost'));
byId('builder-fuel-0').value = '900';
byId('builder-fuel-0').dispatch('input');
assert.ok(number(byId('workshop-mass')) > massBefore, 'booster fuel raises the takeoff mass');
assert.ok(number(byId('workshop-cost')) > costBefore, 'and the price of a new rocket');
byId('builder-fuel-0').value = String(R.world.planet.defaultFuel[0]);
byId('builder-fuel-0').dispatch('input');

// ------------------------------------------------------------- part pickers

assert.equal(byId('builder-engine-0').options.length, R.constants.parts.engines.length,
	'the engine picker lists the catalog');
assert.equal(byId('builder-tank-0').options.length, R.constants.parts.tanks.length, 'and so does the tank picker');
assert.equal(byId('builder-fairing-0').options.length, R.constants.parts.fairings.length + 1,
	'the fairing picker also offers none');
assert.equal(byId('builder-fairing-2').disabled, false, 'the top stage may carry a fairing');
assert.equal(byId('builder-fairing-1').disabled, true, 'a stage below the top may not');
assert.equal(byId('builder-fairing-0').disabled, true, 'and neither may the booster');

// A part is a price as well as a mass: the quoted mass, price and the bill of
// materials all move with the picker.
var partMassBefore = number(byId('workshop-mass'));
var partCostBefore = number(byId('workshop-cost'));
var detailBefore = byId('workshop-structure-detail').textContent;
byId('builder-engine-0').value = 'e-boost';
byId('builder-engine-0').dispatch('change');
assert.equal(R.builder.draft.stages[0].engineId, 'e-boost', 'the picker writes the draft');
assert.ok(number(byId('workshop-mass')) > partMassBefore, 'a booster engine is heavier');
assert.ok(number(byId('workshop-cost')) > partCostBefore, 'and costs more than its weight in steel');
assert.match(byId('workshop-structure-detail').textContent, /^Engines \$[\d,]+ · Tanks \$[\d,]+ · Fuel \$[\d,]+$/,
	'the bill of materials prices engines, tanks and fuel');
assert.notEqual(byId('workshop-structure-detail').textContent, detailBefore, 'and moves with the part chosen');
byId('builder-engine-0').value = R.constants.parts.defaultEngineId;
byId('builder-engine-0').dispatch('change');

// A fairing shows up as mass and as a line of its own.
byId('builder-fairing-2').value = R.constants.parts.fairings[0].id;
byId('builder-fairing-2').dispatch('change');
assert.equal(R.builder.draft.stages[2].fairingId, R.constants.parts.fairings[0].id, 'the top stage takes the fairing');
assert.match(byId('workshop-structure-detail').textContent, /· Fairing \$[\d,]+ ·/, 'and it is priced separately');
byId('builder-fairing-2').value = '';
byId('builder-fairing-2').dispatch('change');
assert.equal(R.builder.draft.stages[2].fairingId, null, 'and can be taken back off');

// Dropping a stage drops the fairing it carried: it cannot hide on a stage that
// is no longer part of the build.
byId('builder-fairing-2').value = R.constants.parts.fairings[0].id;
byId('builder-fairing-2').dispatch('change');
byId('workshop-stage-count').value = '2';
byId('workshop-stage-count').dispatch('change');
assert.equal(R.builder.draft.stages[2].fairingId, null, 'a stage outside the build keeps no fairing');
assert.equal(byId('builder-fairing-1').disabled, false, 'the new top stage may carry one');
byId('workshop-stage-count').value = '3';
byId('workshop-stage-count').dispatch('change');

// The design payload can never exceed what the type can lift.
byId('workshop-payload').value = '99999';
byId('workshop-payload').dispatch('input');
var capacity = Math.floor(R.operations.typeStats(R.builder.draft).payloadLimit);
assert.equal(R.builder.draft.nominalPayload, capacity, 'the design payload is clamped to the type capacity');

byId('workshop-name').value = 'Test hauler';
byId('workshop-save').dispatch('click');
assert.equal(R.operations.state.types.length, 1, 'saving an edited type changes it in place');
assert.equal(referenceType.name, 'Test hauler', 'and renames it');

byId('workshop-name').value = 'Second type';
R.builder.draft.id = null;
R.builder.open(game, { padId: R.world.pads[0].id });
byId('workshop-name').value = 'Second type';
byId('workshop-stage-count').value = '2';
byId('workshop-stage-count').dispatch('change');
assert.equal(byId('builder-stage-2').hidden, true, 'a two-stage type hides the third stage card');
byId('workshop-save').dispatch('click');
assert.equal(R.operations.state.types.length, 2, 'a new name saves a new rocket type');
var secondType = R.operations.state.types[1];
assert.equal(secondType.stageCount, 2);
assert.equal(secondType.stages.length, 2, 'the snapshot keeps only the stages the type has');

// A type can grow: saving it with more stages than it had must add them, not
// write past the end of a shorter template.
R.builder.open(game, { typeId: secondType.id, padId: R.world.pads[0].id });
byId('workshop-stage-count').value = '3';
byId('workshop-stage-count').dispatch('change');
byId('workshop-save').dispatch('click');
assert.equal(secondType.stageCount, 3, 'a type saved with more stages grows');
assert.equal(secondType.stages.length, 3);
assert.equal(secondType.stages[2].fuelMass, R.constants.rocket.minFuelMass, 'the new stage starts at the minimum tank');

// Buying an instance is explicit and priced.
var cashBefore = game.cash;
var ledgerBefore = game.ledger.length;
byId('workshop-build').dispatch('click');
assert.equal(R.operations.state.fleet.length, 2, 'the workshop builds a fleet instance');
assert.equal(R.operations.state.fleet[1].typeId, secondType.id);
assert.equal(R.operations.state.fleet[1].padId, R.world.pads[0].id, 'at the pad it was opened for');
assert.ok(game.cash < cashBefore, 'and charges for it');
assert.equal(game.ledger.length, ledgerBefore + 2, 'structure and fuel are separate ledger entries');
assert.equal(game.ledger[ledgerBefore].type, 'structure');
assert.equal(game.ledger[ledgerBefore + 1].type, 'fuel');
assert.equal(byId('workshop-fleet').textContent, '1 built · 1 available', 'the workshop reports the fleet it made');

// A type the balance cannot afford says so instead of building.
game.cash = 0;
R.builder.update();
assert.equal(byId('workshop-build').disabled, true, 'a build the balance cannot cover is disabled');
byId('workshop-close').dispatch('click');
assert.equal(byId('workshop').hidden, true, 'the dialog closes');
assert.equal(R.operations.blocked, false, 'and automation resumes');
assert.equal(R.deck.dialog, null);

fixture.dispatch('keydown', { key: 'Escape', preventDefault: function() {} });
assert.equal(R.deck.dialog, null, 'Escape with no dialog open changes nothing');

// ------------------------------------------------------- type compatibility

game.cash = R.economy.startingCash;
// A leg's cargo is capped by the destination's appetite as firmly as by the
// rocket's bay, so the cargo a route really flies is what both pads want.
var outboundCargo = R.market.demand(R.world.pads[1].id);
var returnCargo = R.market.demand(R.world.pads[0].id);
var route = R.operations.createRoute({
	name: 'Heavy run',
	source: R.world.pads[0].id,
	destination: R.world.pads[1].id,
	mode: 'return',
	fuelPolicy: 'refuel',
	outboundPayload: outboundCargo,
	returnPayload: returnCargo,
	typeId: referenceType.id,
	profileId: 'balanced',
	enabled: true
});
// One small tank: its bay is a few hundred kilos. Cargo past the bay is refused
// for the rocket and cargo past the pad's appetite for the market, and the gate
// says which of the two it was.
var smallType = R.operations.addType({
	name: 'Tiny hopper',
	stageCount: 1,
	stages: [{ fuelMass: R.constants.rocket.minFuelMass, strength: 0.9 }],
	nominalPayload: 20,
	defaultProfileId: 'balanced'
});
assert.equal(R.operations.payloadProvider(500, smallType.payloadLimit, outboundCargo),
	R.operations.reasons.PAYLOAD_OVER, 'a type that cannot carry the cargo is refused for its bay');
assert.equal(R.operations.payloadProvider(outboundCargo, referenceType.payloadLimit,
	Math.floor(outboundCargo / 2)), R.operations.reasons.NO_DEMAND,
	'and cargo past the destination appetite is refused for the market');
assert.equal(R.operations.payloadProvider(outboundCargo, referenceType.payloadLimit, outboundCargo), null,
	'the cargo a pad wants, in a bay that fits it, goes');

assert.equal(R.operations.changeRouteType(route.id, smallType.id).ok, true, 'a type that carries both directions applies');
assert.equal(R.operations.changeRouteType(route.id, referenceType.id).ok, true, 'and so does the one it had');
assert.equal(route.typeId, referenceType.id, 'the route keeps the type it is given');

// A type change never reaches a mission that is already in the air.
var dispatched = R.operations.dispatch({
	source: route.source,
	destination: route.destination,
	mode: 'return',
	fuelPolicy: 'refuel',
	outboundPayload: outboundCargo,
	returnPayload: returnCargo,
	typeId: referenceType.id,
	rocketId: null,
	profileId: 'balanced',
	routeId: route.id
});
assert.equal(dispatched.ok, true, 'the reference type lifts the route payload');
assert.equal(game.phase, 'flying');
assert.equal(R.operations.changeRouteType(route.id, smallType.id).reason, R.operations.reasons.BUSY,
	'a route with a leg in the air keeps its type');

// The same rule protects the template itself: a type with an instance in the
// air cannot be edited under it. The mission was dispatched against this build
// and its return leg is priced from it.
var saveWhileFlying = R.operations.saveType(referenceType.id, {
	name: 'Edited in flight',
	stageCount: referenceType.stageCount,
	stages: referenceType.stages,
	nominalPayload: referenceType.nominalPayload
});
assert.equal(saveWhileFlying.ok, false, 'editing a type whose rocket is flying is refused');
assert.equal(saveWhileFlying.reason, R.operations.reasons.TYPE_FLYING);
assert.equal(referenceType.name, 'Test hauler', 'and the template is left as it was');

// Deleting a type leaves the log's own snapshot able to rebuild it.
var typeIdBefore = R.operations.state.types.length;
var restored = R.operations.restoreTypeFromSnapshot(dispatched.mission.type);
assert.equal(R.operations.state.types.length, typeIdBefore + 1, 'a snapshot restores a type');
assert.equal(restored.stageCount, dispatched.mission.type.stageCount);
assert.equal(restored.stages[0].fuelMass, dispatched.mission.type.stages[0].fuelMass, 'stage for stage');
assert.match(restored.name, /restored/, 'and says it is a restoration');

// ------------------------------------------------------------- planet switch

R.world.initialize('cinder');
game = createRun();
R.builder.refresh(game);
R.builder.open(game, { padId: R.world.pads[0].id });
assert.equal(byId('builder-fuel-0').value, '1500', 'a world switch loads that world reference booster');
assert.equal(byId('builder-fuel-2').value, '400', 'and its kick stage');
assert.equal(byId('workshop-payload').value, '60', 'and its design payload');
assert.equal(R.operations.state.types.length, 1, 'a new world starts a separate operations save');
assert.equal(R.operations.state.fleet.length, 1, 'with one rocket of its own reference type');
assert.equal(R.operations.state.types[0].name, 'Cinder reference');
byId('workshop-close').dispatch('click');

console.log('Builder and rocket-type tests passed.');
delete global.document;
