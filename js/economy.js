(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var economy = R.economy || (R.economy = {});

	economy.startingCash = R.constants.economy.startingCash;

	// Prices live on the active planet so each world can have its own market.
	economy.priceFuel = function() {
		return R.world.planet.prices.fuel;
	};

	economy.priceSteel = function() {
		return R.world.planet.prices.steel;
	};

	economy.priceDelivery = function() {
		return R.world.planet.prices.delivery;
	};

	economy.estimateBuildCost = function(stats) {
		return stats.dryMass * economy.priceSteel() + stats.fuelMass * economy.priceFuel();
	};

	economy.beginFlight = function(game) {
		var flight = game.flight;
		var structureCost = flight.dryMass * economy.priceSteel();

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

		if (!flight || fuelMass <= 0) {
			return;
		}

		flight.fuelCost += fuelMass * economy.priceFuel();
		game.cash -= fuelMass * economy.priceFuel();
		flight.fuelUsed += fuelMass;
		flight.cashDelta -= fuelMass * economy.priceFuel();
	};

	economy.finishFlight = function(game, reward, fee) {
		var flight = game.flight;

		if (flight.fuelCost > 0) {
			game.ledger.push({ type: 'fuel', amount: -flight.fuelCost, balance: game.cash });
		}
		if (reward > 0) {
			game.cash += reward;
			flight.cashDelta += reward;
			game.ledger.push({ type: 'delivery', amount: reward, balance: game.cash });
		}
		if (fee > 0) {
			game.cash -= fee;
			flight.cashDelta -= fee;
			game.ledger.push({ type: 'autopilot', amount: -fee, balance: game.cash });
		}
		return flight.cashDelta;
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = economy;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
