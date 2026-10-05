'use strict';

// Seeded multi-turn pressure check. Each market advance represents one
// completed player leg; the rival then receives the same bounded turn used by
// the game. This is a behavior measurement, not a second flight model.
//
//   node experiments/competitor-sweep.js [turns] [seed]

var harness = require('./harness.js');
var R = harness.R;
require('../js/competitor.js');

var turns = Number(process.argv[2] || 20);
var seed = Number(process.argv[3] || R.constants.market.seed);
var settings = R.constants.competitor;
var planet;
var game;
var rival;
var eligible = 0;
var accepted = 0;
var before;
var action;
var routeText;
var resultText;
var startDeliveryPrices = [];
var i;
var j;

R.damage.enabled = true;
R.world.initialize('verdant');
planet = R.world.planet;
game = harness.createGame(R.world.pads[0], R.world.pads[1].id, 1, R.constants.economy.startingCash);
R.game = game;
R.operations.initialize();
R.market.initialize(seed);
for (j = 0; j < R.world.pads.length; j += 1) {
	startDeliveryPrices[j] = R.market.price(R.world.pads[j].id, 'delivery');
}
R.competitor.initialize(seed);
rival = R.competitor.state;

console.log('Skybolt Logistics · ' + planet.name + ' · ' + turns + ' market turns · seed ' + seed);
console.log('turn  action                 route                   result      rival cash');
for (i = 0; i < turns; i += 1) {
	R.market.advance();
	before = rival.contractsAccepted;
	R.competitor.takeTurn(game);
	action = rival.lastAction;
	if (action !== 'no-profitable-contract' && action !== 'cannot-rebuild' && action !== 'no-rocket') {
		eligible += 1;
	}
	accepted += rival.contractsAccepted > before ? 1 : 0;
	routeText = rival.contractsAccepted > before ?
		(R.world.findPadById(rival.lastFlight.fromPadId).name + ' → ' +
			R.world.findPadById(rival.lastFlight.toPadId).name) : '—';
	resultText = rival.contractsAccepted > before ? rival.lastFlight.status : '—';
	console.log(String(i + 1).padStart(4) + '  ' + action.padEnd(22) + ' ' + routeText.padEnd(23) + ' ' +
		resultText.padEnd(11) + ' $' + Math.round(rival.cash));
}

console.log('\nAccepted ' + accepted + ' of ' + eligible + ' eligible bids (' +
	(eligible ? (100 * accepted / eligible).toFixed(1) : '0.0') + '%); delivered ' + rival.deliveries +
	', failed ' + rival.failedFlights + ', reputation ' + rival.reputation + ', skill ' + rival.skill.toFixed(2) + '.');
for (j = 0; j < R.world.pads.length; j += 1) {
	console.log(R.world.pads[j].name.padEnd(12) + ' ' +
		R.market.servedBy(R.world.pads[j].id, settings.id) + ' rival deliveries · ' +
		Math.round(R.market.servedKgAt(R.world.pads[j].id)) + ' kg · delivery $' +
		R.market.price(R.world.pads[j].id, 'delivery').toFixed(2) + '/kg (open $' +
		startDeliveryPrices[j].toFixed(2) + ')');
}
