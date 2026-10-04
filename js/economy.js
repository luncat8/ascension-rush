(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var economy = R.economy || (R.economy = {});

	economy.startingCash = R.constants.economy.startingCash;

	// Prices live on the pad (js/market.js): each pad drifts its own fuel,
	// steel and delivery numbers, so where a rocket is bought and fuelled
	// matters. Without a pad the current one is the one being priced.
	function padOf(padId) {
		return padId || R.world.currentPadId;
	}

	economy.priceFuel = function(padId) {
		return R.market.price(padOf(padId), 'fuel');
	};

	economy.priceSteel = function(padId) {
		return R.market.price(padOf(padId), 'steel');
	};

	economy.priceDelivery = function(padId) {
		return R.market.price(padOf(padId), 'delivery');
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

	// Buying a fleet instance: the whole structure, priced through the parts it
	// is built from (`structureValue` is steel-kg, js/parts.js), and a full fuel
	// load. The rocket that starts a run is granted, not bought.
	economy.buyRocket = function(game, structureValue, fuelMass, padId) {
		var structure = structureValue * economy.priceSteel(padId);
		var fuel = fuelMass * economy.priceFuel(padId);

		economy.spend(game, 'structure', structure);
		economy.spend(game, 'fuel', fuel);
		return structure + fuel;
	};

	// Fuel is paid for when it is loaded, not as it burns: a landed rocket keeps
	// whatever is left aboard, and charging the burn as well would bill the same
	// kilogram twice.
	economy.refuel = function(game, fuelMass, padId) {
		return economy.spend(game, 'fuel', fuelMass * economy.priceFuel(padId));
	};

	// 0.3.5 turnaround: replace the separated stages outright, at the parts'
	// value in steel (0.4.2).
	economy.turnaround = function(game, structureValue, padId) {
		return economy.spend(game, 'turnaround', structureValue * economy.priceSteel(padId));
	};

	// 0.4.3 overhaul: buy back the seconds an engine has burned past its rating.
	// A fraction of a new engine, charged on the leg that needs it.
	economy.overhaul = function(game, overhaulValue, padId) {
		return economy.spend(game, 'overhaul', overhaulValue * economy.priceSteel(padId));
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
	// `repairCost` is quoted from 0.4.3 and charged from 0.5, so it is recorded
	// on the flight and in the log without moving cash yet.
	economy.beginFlight = function(game, charges) {
		var flight = game.flight;

		flight.structureCost = charges.structureCost;
		flight.turnaroundCost = charges.turnaroundCost;
		flight.overhaulCost = charges.overhaulCost;
		flight.fuelCost = charges.fuelCost;
		flight.repairCost = charges.repairCost;
		flight.fuelUsed = 0;
		flight.cashDelta = -(charges.turnaroundCost + charges.overhaulCost + charges.fuelCost);
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
