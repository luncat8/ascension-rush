(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var planner = R.planner || (R.planner = {});
	var stageSlots = 3;
	var scratchConfig = {
		stageCount: stageSlots,
		payloadMass: 0,
		stages: [
			{ fuelMass: 0, strength: 1, engineId: null, tankId: null, fairingId: null },
			{ fuelMass: 0, strength: 1, engineId: null, tankId: null, fairingId: null },
			{ fuelMass: 0, strength: 1, engineId: null, tankId: null, fairingId: null }
		]
	};
	var scratchStats = R.rocket.createStats();

	// Delta-v of a type at one payload, through the same build evaluation
	// the workshop and the dispatch card use. Returns the shared scratch
	// record; callers copy the numbers they keep.
	function statsAt(type, payloadMass) {
		var i;

		scratchConfig.stageCount = type.stageCount;
		scratchConfig.payloadMass = Math.max(0, payloadMass);
		for (i = 0; i < type.stageCount; i += 1) {
			scratchConfig.stages[i].fuelMass = type.stages[i].fuelMass;
			scratchConfig.stages[i].strength = type.stages[i].strength;
			scratchConfig.stages[i].engineId = type.stages[i].engineId;
			scratchConfig.stages[i].tankId = type.stages[i].tankId;
			scratchConfig.stages[i].fairingId = type.stages[i].fairingId;
		}
		return R.rocket.evaluateBuild(scratchConfig, scratchStats);
	}

	planner.deltaVAt = function(type, payloadMass) {
		return statsAt(type, payloadMass).deltaV;
	};

	planner.payloadLimit = function(type) {
		return statsAt(type, 0).payloadLimit;
	};

	// The curve the workshop plots: delta-v and TWR at stepped payloads
	// from empty to the bay limit. `points` bounds the samples so a wide
	// bay does not become a long loop.
	planner.deltaVCurve = function(type, points) {
		var limit = planner.payloadLimit(type);
		var count = Math.max(2, Math.min(24, points || 12));
		var curve = [];
		var i;
		var payload;
		var stats;

		for (i = 0; i < count; i += 1) {
			payload = limit * i / (count - 1);
			stats = statsAt(type, payload);
			curve.push({ payload: payload, deltaV: stats.deltaV, twr: stats.twr });
		}
		return curve;
	};

	// Predicted leg time in seconds at 1x. A measured average from the log
	// outranks the heuristic, because the log is what this world actually
	// flew; the heuristic is calibrated to the shipped envelope.
	planner.timeEstimate = function(fromPadId, toPadId) {
		var entries = R.flightLog ? R.flightLog.entries : [];
		var total = 0;
		var count = 0;
		var i;

		for (i = 0; i < entries.length; i += 1) {
			if ((entries[i].departedPadId === fromPadId && entries[i].targetPadId === toPadId) ||
				(entries[i].departedPadId === toPadId && entries[i].targetPadId === fromPadId)) {
				if (entries[i].elapsed > 0) {
					total += entries[i].elapsed;
					count += 1;
				}
			}
		}
		if (count > 0) {
			return total / count;
		}
		return Math.max(20, Math.min(120, 27 + R.operations.legDistance(fromPadId, toPadId) * 0.0036));
	};

	// One leg's predicted economics for ranking. The cost is a full fuel
	// load at the departure pad; turnaround, overhaul and repair depend on
	// the instance on the pad and stay on the dispatch card, which is the
	// number that is charged. `manual` drops the autopilot fee.
	planner.legEstimate = function(type, fromPadId, toPadId, payloadMass, contractId, manual) {
		var quote = R.market.quote(fromPadId, toPadId, payloadMass, contractId || null);
		var reward = quote.reward;
		var pricePerKg = quote.pricePerKg;
		var fuelMass = R.parts.typeFuelMass(type);
		var fuelCost = fuelMass * R.economy.priceFuel(fromPadId);
		var fee = manual ? 0 : reward * R.autopilot.feeFraction;
		var profit = reward - fee - fuelCost;
		var seconds = planner.timeEstimate(fromPadId, toPadId);
		var limit = planner.payloadLimit(type);
		var demand = R.market.demand(toPadId);
		var fits = payloadMass <= limit && payloadMass <= demand;

		return {
			fromPadId: fromPadId,
			toPadId: toPadId,
			payloadMass: payloadMass,
			contractId: contractId || null,
			reward: reward,
			pricePerKg: pricePerKg,
			fuelMass: fuelMass,
			fuelCost: fuelCost,
			fee: fee,
			profit: profit,
			margin: reward > 0 ? profit / reward : 0,
			seconds: seconds,
			profitPerMinute: profit / Math.max(1, seconds) * 60,
			fits: fits,
			limit: limit,
			demand: demand
		};
	};

	// Every standing-service route for a type, best profit first. The cargo
	// is the most the bay and the destination will both take.
	planner.opportunities = function(type, manual) {
		var pads = R.world.pads;
		var rows = [];
		var i;
		var j;
		var payload;
		var row;

		for (i = 0; i < pads.length; i += 1) {
			for (j = 0; j < pads.length; j += 1) {
				if (pads[i].id === pads[j].id) {
					continue;
				}
				payload = Math.min(planner.payloadLimit(type), R.market.demand(pads[j].id));
				row = planner.legEstimate(type, pads[i].id, pads[j].id, payload, null, manual);
				row.kind = 'standing';
				rows.push(row);
			}
		}
		rows.sort(function(a, b) {
			return b.profit - a.profit || b.profitPerMinute - a.profitPerMinute;
		});
		return rows;
	};

	// Open contracts ranked for a type. A contract the bay cannot take is
	// kept, flagged, with the smallest other type that can.
	planner.contractOpportunities = function(type, manual) {
		var state = R.market.state;
		var contracts = state ? state.contracts : [];
		var rows = [];
		var i;
		var contract;
		var row;

		for (i = 0; i < contracts.length; i += 1) {
			contract = contracts[i];
			if (contract.status !== 'open') {
				continue;
			}
			row = planner.legEstimate(type, contract.fromPadId, contract.toPadId,
				contract.payloadMass, contract.id, manual);
			row.kind = 'contract';
			row.contract = contract;
			row.fitsType = contract.payloadMass <= planner.payloadLimit(type);
			row.fittingType = row.fitsType ? null : planner.smallestFittingType(contract.payloadMass);
			rows.push(row);
		}
		rows.sort(function(a, b) {
			if (a.fitsType !== b.fitsType) {
				return a.fitsType ? -1 : 1;
			}
			return b.profit - a.profit || b.profitPerMinute - a.profitPerMinute;
		});
		return rows;
	};

	// The smallest-bay type in the fleet that lifts `payloadMass`, or null.
	planner.smallestFittingType = function(payloadMass) {
		var types = R.operations.state.types;
		var best = null;
		var i;

		for (i = 0; i < types.length; i += 1) {
			if (planner.payloadLimit(types[i]) < payloadMass) {
				continue;
			}
			if (!best || planner.payloadLimit(types[i]) < planner.payloadLimit(best)) {
				best = types[i];
			}
		}
		return best;
	};

	// Measured averages for a route from the log: cash per leg and seconds
	// per leg. Null when the route has not flown yet.
	planner.measuredRoute = function(route) {
		var entries = R.flightLog ? R.flightLog.entries : [];
		var cash = 0;
		var seconds = 0;
		var count = 0;
		var i;

		for (i = 0; i < entries.length; i += 1) {
			if (entries[i].routeId !== route.id) {
				continue;
			}
			cash += entries[i].cashDelta;
			seconds += entries[i].elapsed;
			count += 1;
		}
		if (count === 0) {
			return null;
		}
		return { legs: count, cashPerLeg: cash / count, secondsPerLeg: seconds / count };
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = planner;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
