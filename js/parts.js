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

	// What a stage's structure is worth, in steel-kg: every part's mass at its
	// own price. The default parts cost 1 per kg, so for a reference build this
	// is exactly dryMass and the money 0.4.1 moved is unchanged — a part's
	// costPerMass is the only thing that makes an alternative cost more or less
	// than its weight.
	parts.stageStructureValue = function(stage) {
		var breakdown = parts.stageBreakdown(stage);
		var fairing = parts.fairing(stage.fairingId);

		return breakdown.engineMass * parts.engine(stage.engineId).costPerMass +
			breakdown.tankMass * parts.tank(stage.tankId).costPerMass +
			breakdown.fairingMass * (fairing ? fairing.costPerMass : 1);
	};

	parts.typeStructureValue = function(type) {
		var value = 0;
		var i;

		for (i = 0; i < type.stageCount; i += 1) {
			value += parts.stageStructureValue(type.stages[i]);
		}
		return value;
	};

	// The structure a turnaround replaces: the stages the instance no longer has.
	parts.restoreStructureValue = function(type, stageState) {
		var value = 0;
		var i;

		for (i = 0; i < type.stageCount; i += 1) {
			if (!stageState[i].alive) {
				value += parts.stageStructureValue(type.stages[i]);
			}
		}
		return value;
	};

	parts.typeFuelMass = function(type) {
		var fuel = 0;
		var i;

		for (i = 0; i < type.stageCount; i += 1) {
			fuel += Math.max(0, type.stages[i].fuelMass);
		}
		return fuel;
	};

	// The price of building a whole rocket of a type: every stage's structure at
	// steel price plus a full load of fuel. (A turnaround only rebuilds the
	// stages an instance lost, which is restoreStructureValue's job, not this.)
	parts.typeBuildCost = function(type, padId) {
		return parts.typeStructureValue(type) * R.economy.priceSteel(padId) +
			parts.typeFuelMass(type) * R.economy.priceFuel(padId);
	};

	parts.typeStructureCost = function(type, stageState, padId) {
		return parts.restoreStructureValue(type, stageState) * R.economy.priceSteel(padId);
	};

// ------------------------------------------------------------- service life

// Wear lives on the fleet instance's stage (`engineBurnTimeUsed` seconds at
// throttle, `lifeFlights` legs flown, `stress` from 0.5), and a stage the
// turnaround replaces comes back with none of it.

// The stages a leg keeps flying: attached, and not on a stage this leg's
// turnaround is already replacing. A stage that is rebuilt comes back new, so
// nothing spent on the old one — an overhaul, a repair — carries over to it.
function keptStage(stage, slot, refuel) {
	return slot.alive && !(refuel && parts.scrapped(stage, slot));
}

// A tank is flown out on the leg after its rating: the turnaround that
// follows replaces the stage, which is what a life limit costs.
parts.wornOut = function(stage, slot) {
	return slot.lifeFlights >= parts.tank(stage.tankId).maxFlights;
};

// A stage is beyond saving when its tank has flown out its rating or it came
// down too damaged to repair: either way the turnaround that follows replaces
// the whole stage, which is what a life limit and a wreck both cost.
parts.scrapped = function(stage, slot) {
	return parts.wornOut(stage, slot) || slot.stress >= R.constants.damage.scrapStress;
};

	parts.flightsLeft = function(stage, slot) {
		return parts.tank(stage.tankId).maxFlights - slot.lifeFlights;
	};

	// An engine is overdue once it has burned longer than it is rated for, and
	// stays overdue until an overhaul buys the seconds back.
	parts.engineOverdue = function(stage, slot) {
		return slot.engineBurnTimeUsed >= parts.engine(stage.engineId).maxThrottleSeconds;
	};

	parts.burnTimeLeft = function(stage, slot) {
		return parts.engine(stage.engineId).maxThrottleSeconds - slot.engineBurnTimeUsed;
	};

// An overhaul is a fraction of a new engine, in steel-kg.
parts.stageOverhaulValue = function(stage) {
	return parts.stageBreakdown(stage).engineMass * parts.engine(stage.engineId).costPerMass *
		R.constants.parts.overhaulFactor;
};

// What servicing the stack on the pad costs: every engine the leg keeps flying
// that is past its rating. A stage the turnaround is rebuilding is not serviced
// twice — it comes back with a fresh engine.
parts.overhaulValue = function(type, stageState, refuel) {
	var value = 0;
	var i;

	for (i = 0; i < type.stageCount; i += 1) {
		if (keptStage(type.stages[i], stageState[i], refuel) &&
			parts.engineOverdue(type.stages[i], stageState[i])) {
			value += parts.stageOverhaulValue(type.stages[i]);
		}
	}
	return value;
};

// The seconds an authorized overhaul buys back: exactly the engines its price
// covered, so a stage that was not due keeps the clock it has.
parts.applyOverhaul = function(type, stageState, refuel) {
	var i;

	for (i = 0; i < type.stageCount; i += 1) {
		if (keptStage(type.stages[i], stageState[i], refuel) &&
			parts.engineOverdue(type.stages[i], stageState[i])) {
			stageState[i].engineBurnTimeUsed = 0;
		}
	}
	return stageState;
};

	// The repair bill: the stress a stage carries times what its parts cost to
	// put right per kg, plus a whole new engine for one that burned out — a
	// part that failed outright is replaced, not repaired.
	parts.stageRepairValue = function(stage, slot) {
		var breakdown = parts.stageBreakdown(stage);
		var fairing = parts.fairing(stage.fairingId);

		return slot.stress * (breakdown.engineMass * parts.engine(stage.engineId).repairPerKg +
			breakdown.tankMass * parts.tank(stage.tankId).repairPerKg +
			breakdown.fairingMass * (fairing ? fairing.repairPerKg : 0)) +
			(slot.engineOut ? breakdown.engineMass * parts.engine(stage.engineId).costPerMass : 0);
	};

parts.repairValue = function(type, stageState, refuel) {
	var value = 0;
	var i;

	for (i = 0; i < type.stageCount; i += 1) {
		if (keptStage(type.stages[i], stageState[i], refuel)) {
			value += parts.stageRepairValue(type.stages[i], stageState[i]);
		}
	}
	return value;
};

// A repair is what the pad does with the stack before the leg: the damage it
// arrived with is put right, so the leg launches with clean stages. A stage
// the turnaround is rebuilding instead is not repaired — it comes back new.
parts.applyRepair = function(type, stageState, refuel) {
	var i;

	for (i = 0; i < type.stageCount; i += 1) {
		if (keptStage(type.stages[i], stageState[i], refuel)) {
			stageState[i].stress = 0;
			stageState[i].engineOut = false;
		}
	}
	return stageState;
};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = parts;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
