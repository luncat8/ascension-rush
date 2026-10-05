'use strict';

// Throwaway probe 2: the payload limit the deck offers, and the steady state of
// a standing service on one hop (per-leg margin, destination price, wear).
var harness = require('./harness.js');

var R = harness.R;
var settings = R.constants;
var frameDt = 1 / 120;
var profileId = settings.autopilotProfiles[0].id;

function build(stageCount) {
	var planet = R.world.planet;

	return {
		stageCount: stageCount,
		stages: planet.defaultFuel.slice(0, stageCount).map(function(fuel, position) {
			return { fuelMass: fuel, strength: settings.rocket.defaultStageStrength[position], engineId: null, tankId: null, fairingId: null };
		})
	};
}

function setup(worldId, stageCount, payloadMass) {
	var source = R.world.pads[0];
	var target = R.world.pads[1];
	var game = harness.createGame(source, target.id, 4, 1e9);
	var type;

	R.world.initialize(worldId);
	R.game = game;
	R.operations.initialize();
	R.market.initialize(20261004);
	R.operations.state.types.length = 0;
	R.operations.state.fleet.length = 0;
	type = R.operations.addType({
		name: 'probe',
		stageCount: stageCount,
		stages: build(stageCount).stages,
		nominalPayload: payloadMass,
		defaultProfileId: profileId
	});
	R.operations.createRocket(type, source);
	return { game: game, type: type, source: source, target: target };
}

// 1. The capacity the deck's slider offers.
['verdant', 'tinmoon', 'cinder', 'gossamer'].forEach(function(worldId) {
	R.world.initialize(worldId);
	[1, 2, 3].forEach(function(stageCount) {
		var context = setup(worldId, stageCount, 80);
		var stats = R.operations.typeStats(context.type);

		console.log(worldId + ' ' + stageCount + 'st: payloadLimit ' + Math.floor(stats.payloadLimit) +
			' kg · dryMass ' + Math.round(stats.dryMass) + ' kg · maxPayloadMass ' + settings.rocket.maxPayloadMass);
	});
});

// 2. Steady state of a standing service: verdant near hop, reference build.
var context = setup('verdant', 3, 80);
var legs = 40;
var leg;
var order;
var entry;
var from = context.source;
var to = context.target;

console.log('--- verdant near hop, 3st reference, 80 kg, ' + legs + ' standing legs ---');
for (leg = 0; leg < legs; leg += 1) {
	order = R.operations.dispatch({
		source: from.id,
		destination: to.id,
		mode: 'oneway',
		fuelPolicy: 'refuel',
		outboundPayload: 80,
		returnPayload: 0,
		typeId: context.type.id,
		profileId: profileId,
		overhaul: true
	});
	if (!order.ok) {
		console.log(leg + ': refused ' + order.reason);
		break;
	}
	harness.fly(context.game, frameDt);
	entry = R.flightLog.entries[0];
	console.log(leg + ' ' + entry.status + ' margin ' + (entry.cashDelta / Math.max(1, entry.revenue) * 100).toFixed(1) +
		'% · rev $' + Math.round(entry.revenue) + ' · fuel $' + Math.round(entry.fuelCost) +
		' · turnaround $' + Math.round(entry.turnaroundCost) + ' · overhaul $' + Math.round(entry.overhaulCost) +
		' · dest delivery ' + R.market.price(to.id, 'delivery').toFixed(2) +
		' · served ' + R.market.servedAt(to.id) +
		' · flights ' + context.game.ledger.length);
	from = R.world.findPadById(entry.landingPadId) || from;
	to = from.id === context.source.id ? context.target : context.source;
}
