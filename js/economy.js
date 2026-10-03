(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var economy = R.economy || (R.economy = {});

	economy.startingCash = R.constants.economy.startingCash;
	economy.priceFuelPerKg = R.constants.economy.priceFuelPerKg;
	economy.priceSteelPerKg = R.constants.economy.priceSteelPerKg;
	economy.priceDeliveryPerKg = R.constants.economy.priceDeliveryPerKg;

	economy.estimateBuildCost = function(stats) {
		return stats.dryMass * economy.priceSteelPerKg + stats.fuelMass * economy.priceFuelPerKg;
	};

	economy.beginFlight = function(game) {
		var flight = game.flight;
		var structureCost = flight.dryMass * economy.priceSteelPerKg;

		game.cash -= structureCost;
		flight.structureCost = structureCost;
		flight.fuelUsed = 0;
		flight.fuelCost = 0;
		flight.cashDelta = -structureCost;
		if (!game.ledger) {
			game.ledger = [];
		}
		game.ledger.push({ type: 'structure', amount: -structureCost, balance: game.cash });
	};

	economy.consumeFuel = function(game, fuelMass) {
		var flight = game.flight;
		var cost;

		if (!flight || fuelMass <= 0) {
			return;
		}

		cost = fuelMass * economy.priceFuelPerKg;
		game.cash -= cost;
		flight.fuelUsed += fuelMass;
		flight.fuelCost += cost;
		flight.cashDelta -= cost;
	};

	economy.finishFlight = function(game, reward) {
		var flight = game.flight;

		if (flight.fuelCost > 0) {
			game.ledger.push({ type: 'fuel', amount: -flight.fuelCost, balance: game.cash });
		}
		if (reward > 0) {
			game.cash += reward;
			flight.cashDelta += reward;
			game.ledger.push({ type: 'delivery', amount: reward, balance: game.cash });
		}
		return flight.cashDelta;
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = economy;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
