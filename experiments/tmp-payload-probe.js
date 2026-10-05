'use strict';

// Throwaway probe: what happens when the payload climbs past the ladder toward
// constants.rocket.maxPayloadMass on the reference builds.
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

function probe(worldId, stageCount, far, payloadMass) {
	var build0 = null;
	var game;
	var type;
	var order;
	var entry;
	var quote;
	var source;
	var target;
	var margin;

	R.world.initialize(worldId);
	source = R.world.pads[0];
	target = R.world.pads[far ? R.world.pads.length - 1 : 1];
	game = harness.createGame(source, target.id, 4, 1e9);
	R.game = game;
	R.operations.initialize();
	R.market.initialize(20261004);
	R.operations.state.types.length = 0;
	R.operations.state.fleet.length = 0;
	build0 = build(stageCount);
	type = R.operations.addType({
		name: 'probe',
		stageCount: build0.stageCount,
		stages: build0.stages,
		nominalPayload: payloadMass,
		defaultProfileId: profileId
	});
	R.operations.createRocket(type, source);
	quote = R.market.quote(source.id, target.id, payloadMass, null);
	order = R.operations.dispatch({
		source: source.id,
		destination: target.id,
		mode: 'oneway',
		fuelPolicy: 'refuel',
		outboundPayload: payloadMass,
		returnPayload: 0,
		typeId: type.id,
		profileId: profileId,
		overhaul: true
	});
	if (!order.ok) {
		return 'refused: ' + order.reason + ' · limit ' + Math.floor(type.payloadLimit);
	}
	harness.fly(game, frameDt);
	entry = R.flightLog.entries[0];
	margin = entry.revenue > 0 ? entry.cashDelta / entry.revenue : NaN;
	return entry.status + ' · revenue $' + Math.round(entry.revenue) + ' · cash $' + Math.round(entry.cashDelta) +
		' · margin ' + (isFinite(margin) ? (margin * 100).toFixed(1) + '%' : 'n/a') +
		' · fuel used ' + Math.round(entry.fuelUsed) + ' kg · quote ' + Math.round(quote.reward);
}

['verdant', 'gossamer'].forEach(function(worldId) {
	[1, 3].forEach(function(stageCount) {
		[false, true].forEach(function(far) {
			[80, 120, 200, 300, 450, 600].forEach(function(payloadMass) {
				console.log(worldId + ' ' + stageCount + 'st ' + (far ? 'far ' : 'near') + ' ' + payloadMass + 'kg: ' +
					probe(worldId, stageCount, far, payloadMass));
			});
		});
	});
});
