(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var parts = R.parts || (R.parts = {});

	function lookup(id, table) {
		var i;

		if (!id) {
			return null;
		}
		for (i = 0; i < table.length; i += 1) {
			if (table[i].id === id) {
				return table[i];
			}
		}
		return null;
	}

	// The first catalog entry is the default: it carries the 0.3 numbers, so a
	// reference build with no part chosen reproduces the old mass and thrust.
	parts.engine = function(id) {
		return lookup(id, R.constants.parts.engines) || R.constants.parts.engines[0];
	};

	parts.tank = function(id) {
		return lookup(id, R.constants.parts.tanks) || R.constants.parts.tanks[0];
	};

	parts.fairing = function(id) {
		return id ? lookup(id, R.constants.parts.fairings) : null;
	};

	// A stage config may arrive from a type saved before the catalog, or from a
	// test that only set { fuelMass, strength }; fill the part ids so every
	// downstream reader sees a complete stage and resolves to the defaults.
	parts.sanitizeStage = function(stage) {
		return {
			fuelMass: stage.fuelMass,
			strength: stage.strength,
			engineId: stage.engineId || R.constants.parts.defaultEngineId,
			tankId: stage.tankId || R.constants.parts.defaultTankId,
			fairingId: stage.fairingId || null
		};
	};

	// The structure factor every tank shares: a stronger tank is simply heavier.
	parts.structureFactor = function(strength) {
		return R.constants.parts.structureLow + R.constants.parts.structureHigh *
			R.util.clamp(strength == null ? 1 : strength, 0.5, 1);
	};

	// Engine + tank (+ fairing on the top stage) for one stage. Thrust and Isp
	// come from the engine; the tank sets the weight-per-fuel. A fairing adds its
	// mass once and is only ever set on the top stage.
	parts.stageBreakdown = function(stage) {
		var engine = parts.engine(stage.engineId);
		var tank = parts.tank(stage.tankId);
		var fuel = Math.max(0, stage.fuelMass || 0);
		var thrust = fuel * engine.thrustPerFuelMass;
		var fairing = parts.fairing(stage.fairingId);
		var tankMass = fuel * tank.massPerFuelMass * parts.structureFactor(stage.strength);
		var engineMass = engine.baseMass + thrust / engine.thrustToMass;
		var fairingMass = fairing ? fairing.mass : 0;

		return {
			engineMass: engineMass,
			tankMass: tankMass,
			fairingMass: fairingMass,
			dryMass: engineMass + tankMass + fairingMass,
			thrust: thrust
		};
	};

	parts.stageThrust = function(stage) {
		return Math.max(0, stage.fuelMass || 0) * parts.engine(stage.engineId).thrustPerFuelMass;
	};

	// Steel price of the structure a turnaround replaces, folded through each
	// part's costPerMass. The default parts are 1, so this equals
	// dryMass * priceSteel and the 0.4.1 money baseline is untouched.
	parts.typeStructureCost = function(type, stageState, padId) {
		var cost = 0;
		var i;
		var stage;
		var breakdown;
		var engine;
		var tank;
		var fairing;

		for (i = 0; i < type.stageCount; i += 1) {
			if (stageState[i].alive) {
				continue;
			}
			stage = type.stages[i];
			breakdown = parts.stageBreakdown(stage);
			engine = parts.engine(stage.engineId);
			tank = parts.tank(stage.tankId);
			fairing = parts.fairing(stage.fairingId);
			cost += breakdown.engineMass * engine.costPerMass;
			cost += breakdown.tankMass * tank.costPerMass;
			cost += breakdown.fairingMass * (fairing ? fairing.costPerMass : 1);
		}
		return cost * R.economy.priceSteel(padId);
	};

	// The price of building a whole rocket of a type: every stage's structure at
	// steel price plus a full load of fuel. (A turnaround only rebuilds the
	// stages an instance lost, which is restorePlan's job, not this.)
	parts.typeBuildCost = function(type, padId) {
		var structure = 0;
		var fuel = 0;
		var i;
		var breakdown;

		for (i = 0; i < type.stageCount; i += 1) {
			breakdown = parts.stageBreakdown(type.stages[i]);
			structure += breakdown.dryMass;
			fuel += Math.max(0, type.stages[i].fuelMass);
		}
		return structure * R.economy.priceSteel(padId) + fuel * R.economy.priceFuel(padId);
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = parts;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
