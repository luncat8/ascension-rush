'use strict';

// Throwaway tuning probe: the steady state of a standing service (the band the
// plan targets, measured over a chain long enough to pay for maintenance) and
// what the same hop pays at the payload the deck's slider offers.
var harness = require('./harness.js');

var R = harness.R;
var settings = R.constants;
var frameDt = 1 / 120;
var profileId = settings.autopilotProfiles[0].id;
var legs = Number(process.argv[2] || 36);

function buildStages(stageCount, factor) {
	var planet = R.world.planet;

	return planet.defaultFuel.slice(0, stageCount).map(function(fuel, position) {
		return {
			fuelMass: fuel * (factor || 1),
			strength: settings.rocket.defaultStageStrength[position],
			engineId: null,
			tankId: null,
			fairingId: null
		};
	});
}

function service(worldId, stageCount, payloadMass, count, factor) {
	var source;
	var target;
	var game;
	var type;
	var order;
	var entry;
	var margins = [];
	var rebuilds = 0;
	var overhauls = 0;
	var from;
	var to;
	var leg;

	R.world.initialize(worldId);
	source = R.world.pads[0];
	target = R.world.pads[1];
	game = harness.createGame(source, target.id, 4, 1e9);
	R.game = game;
	R.operations.initialize();
	R.market.initialize(20261004);
	R.operations.state.types.length = 0;
	R.operations.state.fleet.length = 0;
	type = R.operations.addType({
		name: 'probe',
		stageCount: stageCount,
		stages: buildStages(stageCount, factor),
		nominalPayload: payloadMass,
		defaultProfileId: profileId
	});
	R.operations.createRocket(type, source);
	from = source;
	to = target;
	for (leg = 0; leg < count; leg += 1) {
		order = R.operations.dispatch({
			source: from.id,
			destination: to.id,
			mode: 'oneway',
			fuelPolicy: 'refuel',
			outboundPayload: payloadMass,
			returnPayload: 0,
			typeId: type.id,
			profileId: profileId,
			overhaul: true
		});
		if (!order.ok) {
			return { refused: order.reason };
		}
		harness.fly(game, frameDt);
		entry = R.flightLog.entries[0];
		if (entry.status !== 'delivered') {
			return { failed: entry.status + ' on leg ' + leg };
		}
		rebuilds += entry.turnaroundCost > 0 ? 1 : 0;
		overhauls += entry.overhaulCost > 0 ? 1 : 0;
		// The granted opener buys no fuel; the service's steady state leaves it out.
		if (leg > 0) {
			margins.push(entry.cashDelta / entry.revenue);
		}
		from = R.world.findPadById(entry.landingPadId) || from;
		to = from.id === source.id ? target : source;
	}
	return {
		mean: margins.reduce(function(sum, value) {
			return sum + value;
		}, 0) / margins.length,
		min: Math.min.apply(null, margins),
		max: Math.max.apply(null, margins),
		rebuilds: rebuilds,
		overhauls: overhauls
	};
}

function percent(value) {
	return (value === undefined ? '—' : (value >= 0 ? '+' : '−') + (Math.abs(value) * 100).toFixed(1) + '%');
}

R.planets.list.forEach(function(world) {
	var planet = null;
	var reference;
	var result;

	R.world.initialize(world.id);
	planet = R.world.planet;
	reference = planet.defaultPayload;
	console.log('=== ' + world.id + ' · delivery ' + planet.prices.delivery + ' · fuel ' + planet.prices.fuel +
		' · reference payload ' + reference + ' kg · ' + legs + ' legs ===');
	[1, 2, 3].forEach(function(stageCount) {
		result = service(world.id, stageCount, reference, legs);
		console.log('  ' + stageCount + 'st @' + reference + 'kg (1x ladder): steady ' +
			(result.mean === undefined ? result.refused || result.failed : percent(result.mean)) +
			' · range ' + percent(result.min) + '…' + percent(result.max) +
			' · rebuilds ' + result.rebuilds + ' · overhauls ' + result.overhauls);
	});
	result = service(world.id, 3, reference, legs, 1.5);
	console.log('  3st @' + reference + 'kg overbuilt x1.5: ' +
		(result.mean === undefined ? result.refused || result.failed : percent(result.mean)) +
		' · rebuilds ' + result.rebuilds);
	[2, 4, 7.5].forEach(function(multiple) {
		var mass = Math.min(settings.rocket.maxPayloadMass, Math.round(reference * multiple / 10) * 10);

		result = service(world.id, 1, mass, legs);
		console.log('  1st @' + mass + 'kg (' + multiple + 'x ladder): ' +
			(result.mean === undefined ? result.refused || result.failed : percent(result.mean)) +
			' · rebuilds ' + result.rebuilds);
	});
});
