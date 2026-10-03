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

	// Every cash movement goes through these two, so the ledger and the balance
	// cannot drift apart and a leg can itemize what it actually spent.
	economy.spend = function(game, type, amount) {
		if (amount <= 0) {
			return 0;
		}
		game.cash -= amount;
		game.ledger.push({ type: type, amount: -amount, balance: game.cash });
		return amount;
	};

	economy.earn = function(game, type, amount) {
		if (amount <= 0) {
			return 0;
		}
		game.cash += amount;
		game.ledger.push({ type: type, amount: amount, balance: game.cash });
		return amount;
	};

	// Buying a fleet instance: the whole structure and a full fuel load. The
	// rocket that starts a run is granted, not bought.
	economy.buyRocket = function(game, stats) {
		var structure = stats.dryMass * economy.priceSteel();
		var fuel = stats.fuelMass * economy.priceFuel();

		economy.spend(game, 'structure', structure);
		economy.spend(game, 'fuel', fuel);
		return structure + fuel;
	};

	// Fuel is paid for when it is loaded, not as it burns: a landed rocket keeps
	// whatever is left aboard, and charging the burn as well would bill the same
	// kilogram twice.
	economy.refuel = function(game, fuelMass) {
		return economy.spend(game, 'fuel', fuelMass * economy.priceFuel());
	};

	// 0.3.5 turnaround: replace the separated stages outright, at steel price.
	economy.turnaround = function(game, dryMass) {
		return economy.spend(game, 'turnaround', dryMass * economy.priceSteel());
	};

	// Metering only. The propellant was bought at load time.
	economy.burnFuel = function(game, fuelMass) {
		var flight = game.flight;

		if (!flight || fuelMass <= 0) {
			return;
		}
		flight.fuelUsed += fuelMass;
	};

	// Records what preparing the leg cost. `structureCost` is the steel value of
	// the stack that flew — capital at risk for later depreciation, not a charge.
	economy.beginFlight = function(game, charges) {
		var flight = game.flight;

		flight.structureCost = charges.structureCost;
		flight.turnaroundCost = charges.turnaroundCost;
		flight.fuelCost = charges.fuelCost;
		flight.fuelUsed = 0;
		flight.cashDelta = -(charges.turnaroundCost + charges.fuelCost);
	};

	economy.finishFlight = function(game, reward, fee) {
		var flight = game.flight;

		flight.cashDelta += economy.earn(game, 'delivery', reward);
		flight.cashDelta -= economy.spend(game, 'autopilot', fee);
		return flight.cashDelta;
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = economy;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
