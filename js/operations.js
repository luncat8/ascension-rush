(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var operations = R.operations || (R.operations = {});
	var stageSlots = 3;
	var stats = R.rocket.createStats();
	var plan = { fuelMass: 0, dryMass: 0 };
	var scratchStageState = R.rocket.createStageState();
	// A rocket type is measured with no payload aboard so `payloadLimit` is the
	// most it can lift; the payload it is displayed with is a separate number.
	var scratchConfig = {
		stageCount: stageSlots,
		payloadMass: 0,
		stages: [
			{ fuelMass: 0, strength: 1 },
			{ fuelMass: 0, strength: 1 },
			{ fuelMass: 0, strength: 1 }
		]
	};

	// Specific wait reasons. A route never shows a generic disabled state when
	// the cause is known.
	operations.reasons = {
		READY: '',
		PAUSED: 'PAUSED',
		NO_TYPE: 'ROCKET TYPE NO LONGER EXISTS',
		NO_ROCKET: 'NO ROCKET AT ',
		ROCKET_BUSY: 'ROCKET BUSY',
		PAYLOAD_OVER: 'PAYLOAD EXCEEDS CAPACITY',
		NEEDS_REFUEL: 'NEEDS REFUEL',
		INSUFFICIENT_FUNDS: 'INSUFFICIENT FUNDS',
		SAME_PAD: 'CHOOSE TWO DIFFERENT PADS',
		BUSY: 'SIMULATOR BUSY',
		RETURN_BLOCKED: 'RETURN BLOCKED',
		TYPE_FLYING: 'A ROCKET OF THIS TYPE IS FLYING',
		CONTRACT_GONE: 'CONTRACT IS NO LONGER ON THE BOARD',
		CONTRACT_MISMATCH: 'CONTRACT NEEDS ITS OWN PADS AND PAYLOAD'
	};
	operations.autoLaunchSeconds = R.constants.operations.autoLaunchSeconds;
	// Set while a dialog or the workshop is open: automation must never pull the
	// player out of a form they are editing.
	operations.blocked = false;
	operations.state = null;
	operations.now = function() {
		return Date.now();
	};

	// Bumped on every state change so the deck re-renders only when something it
	// shows has actually moved, instead of on every frame.
	operations.touch = function() {
		operations.state.revision += 1;
	};

	// Declining an offer holds it back until the player does something that says
	// otherwise: editing the route, changing the fleet, or sending a flight.
	operations.forgetDismissal = function() {
		operations.state.dismissedRouteId = null;
	};

	function reasonText(reason, pad) {
		return reason === operations.reasons.NO_ROCKET ? reason + pad.name.toUpperCase() : reason;
	}

	function snapshotType(type) {
		var stages = [];
		var i;

		for (i = 0; i < type.stageCount; i += 1) {
			stages.push({ fuelMass: type.stages[i].fuelMass, strength: type.stages[i].strength });
		}
		return {
			id: type.id,
			name: type.name,
			stageCount: type.stageCount,
			stages: stages,
			nominalPayload: type.nominalPayload,
			payloadLimit: type.payloadLimit,
			defaultProfileId: type.defaultProfileId
		};
	}

	function copyStageState(from, to) {
		var i;

		for (i = 0; i < stageSlots; i += 1) {
			to[i].alive = from[i].alive;
			to[i].fuelMass = from[i].fuelMass;
		}
		return to;
	}

	function fullStageState(type, out) {
		var i;

		for (i = 0; i < stageSlots; i += 1) {
			out[i].alive = i < type.stageCount;
			out[i].fuelMass = out[i].alive ? type.stages[i].fuelMass : 0;
		}
		return out;
	}

	operations.nextId = function() {
		var id = operations.state.nextId;

		operations.state.nextId += 1;
		return id;
	};

	// 0.3.5 has no contract market, so payload availability is provisional: a
	// mass is available when the rocket type can lift it. 0.4 replaces this one
	// function with contracts and cargo inventory; the scheduler does not change.
	operations.payloadProvider = function(mass, payloadLimit) {
		return mass >= 0 && mass <= payloadLimit ? null : operations.reasons.PAYLOAD_OVER;
	};

	operations.findType = function(id) {
		var types = operations.state.types;
		var i;

		for (i = 0; i < types.length; i += 1) {
			if (types[i].id === id) {
				return types[i];
			}
		}
		return null;
	};

	operations.findRocket = function(id) {
		var fleet = operations.state.fleet;
		var i;

		for (i = 0; i < fleet.length; i += 1) {
			if (fleet[i].id === id) {
				return fleet[i];
			}
		}
		return null;
	};

	operations.findRoute = function(id) {
		var routes = operations.state.routes;
		var i;

		for (i = 0; i < routes.length; i += 1) {
			if (routes[i].id === id) {
				return routes[i];
			}
		}
		return null;
	};

	// Fills the shared scratch record and returns it; callers must not hold it.
	operations.typeStats = function(type) {
		var i;

		scratchConfig.stageCount = type.stageCount;
		for (i = 0; i < type.stageCount; i += 1) {
			scratchConfig.stages[i].fuelMass = type.stages[i].fuelMass;
			scratchConfig.stages[i].strength = type.stages[i].strength;
		}
		R.rocket.evaluateBuild(scratchConfig, stats);
		type.payloadLimit = stats.payloadLimit;
		return stats;
	};

	// The ordinary launch gate for a complete stack of this type.
	operations.typeTwr = function(type, payloadMass) {
		return R.rocket.launchTwr(type, fullStageState(type, scratchStageState), payloadMass);
	};

	operations.addType = function(spec) {
		var type = {
			id: operations.nextId(),
			name: spec.name,
			stageCount: spec.stageCount,
			stages: [],
			nominalPayload: spec.nominalPayload || 0,
			payloadLimit: 0,
			defaultProfileId: spec.defaultProfileId,
			createdAt: operations.now(),
			archived: false
		};
		var i;

		for (i = 0; i < spec.stageCount; i += 1) {
			type.stages.push({ fuelMass: spec.stages[i].fuelMass, strength: spec.stages[i].strength });
		}
		operations.typeStats(type);
		type.nominalPayload = Math.min(type.nominalPayload, Math.floor(type.payloadLimit));
		operations.state.types.push(type);
		operations.touch();
		return type;
	};

	// The one validated write to an existing type. A template whose instance is
	// in the air is frozen: the mission was dispatched against this build, the
	// rocket is flying it and the return leg is priced from it.
	operations.saveType = function(typeId, spec) {
		var type = operations.findType(typeId);
		var fleet = operations.state.fleet;
		var i;

		if (!type) {
			return { ok: false, reason: operations.reasons.NO_TYPE };
		}
		for (i = 0; i < fleet.length; i += 1) {
			if (fleet[i].typeId === typeId && fleet[i].status === 'flying') {
				return { ok: false, reason: operations.reasons.TYPE_FLYING };
			}
		}
		type.name = spec.name;
		type.stageCount = spec.stageCount;
		type.nominalPayload = spec.nominalPayload;
		// Rebuilt rather than overwritten in place: a type saved with more
		// stages than it had must grow.
		type.stages.length = 0;
		for (i = 0; i < spec.stageCount; i += 1) {
			type.stages.push({ fuelMass: spec.stages[i].fuelMass, strength: spec.stages[i].strength });
		}
		operations.typeStats(type);
		type.nominalPayload = Math.min(type.nominalPayload, Math.floor(type.payloadLimit));
		operations.forgetDismissal();
		operations.touch();
		return { ok: true, type: type };
	};

	operations.referenceType = function() {
		var planet = R.world.planet;
		var fuel = planet.defaultFuel;
		var strength = R.constants.rocket.defaultStageStrength;

		return operations.addType({
			name: planet.name + ' reference',
			stageCount: fuel.length,
			stages: fuel.map(function(mass, index) {
				return { fuelMass: mass, strength: strength[index] };
			}),
			nominalPayload: planet.defaultPayload,
			defaultProfileId: R.constants.autopilotProfiles[0].id
		});
	};

	operations.createRocket = function(type, pad) {
		var rocket = {
			id: operations.nextId(),
			typeId: type.id,
			padId: pad.id,
			status: 'available',
			stageCount: type.stageCount,
			stageState: R.rocket.createStageState(),
			assignedRouteId: null,
			activeMissionId: null,
			createdAt: operations.now()
		};

		fullStageState(type, rocket.stageState);
		operations.state.fleet.push(rocket);
		return rocket;
	};

	// Explicit and priced: a route never creates a rocket as a side effect.
	operations.buildRocket = function(typeId, padId) {
		var type = operations.findType(typeId);
		var pad = R.world.findPadById(padId);
		var game = R.game;
		var rocketId;
		var cost;

		if (!type || !pad || !game) {
			return { ok: false, reason: operations.reasons.NO_TYPE };
		}
		cost = R.economy.estimateBuildCost(operations.typeStats(type), pad.id);
		if (game.cash < cost) {
			return { ok: false, reason: operations.reasons.INSUFFICIENT_FUNDS, cost: cost };
		}
		R.economy.buyRocket(game, stats, pad.id);
		rocketId = operations.createRocket(type, pad).id;
		operations.forgetDismissal();
		operations.touch();
		return { ok: true, rocketId: rocketId, cost: cost };
	};

	// Deterministic matching: the oldest available compatible rocket, so route
	// behavior can be tested and explained.
	operations.pickRocket = function(typeId, padId) {
		var fleet = operations.state.fleet;
		var best = null;
		var i;

		for (i = 0; i < fleet.length; i += 1) {
			if (fleet[i].typeId !== typeId || fleet[i].padId !== padId || fleet[i].status !== 'available') {
				continue;
			}
			if (!best || fleet[i].createdAt < best.createdAt ||
				(fleet[i].createdAt === best.createdAt && fleet[i].id < best.id)) {
				best = fleet[i];
			}
		}
		return best;
	};

	// A wreck is not a rocket that is merely busy: a pad whose only instance is
	// lost has no rocket at all.
	operations.hasRocketAt = function(typeId, padId) {
		var fleet = operations.state.fleet;
		var i;

		for (i = 0; i < fleet.length; i += 1) {
			if (fleet[i].typeId === typeId && fleet[i].padId === padId && fleet[i].status !== 'lost') {
				return true;
			}
		}
		return false;
	};

	// What a leg has to buy before it can fly: fuel up to the type's capacities
	// and the structure of any stage the instance is missing. A no-refuel return
	// buys nothing and flies on exactly what landed.
	operations.preparePlan = function(type, rocket, refuel) {
		if (!refuel) {
			plan.fuelMass = 0;
			plan.dryMass = 0;
			return plan;
		}
		return R.rocket.restorePlan(type, rocket.stageState, plan);
	};

	operations.planCost = function(preparation, padId) {
		return preparation.fuelMass * R.economy.priceFuel(padId) + preparation.dryMass * R.economy.priceSteel(padId);
	};

	// The one place that decides whether a leg can fly. The dispatch card, the
	// route cards and the scheduler all quote this, so a reason is never
	// invented twice.
	operations.evaluateLeg = function(typeId, fromPadId, payloadMass, refuel, rocketId) {
		var type = operations.findType(typeId);
		var pad = R.world.findPadById(fromPadId);
		var rocket = rocketId ? operations.findRocket(rocketId) : null;
		var preparation;
		var result = { ready: false, reason: '', rocket: null, cost: 0, fuelMass: 0, dryMass: 0, twr: 0 };

		if (!type || type.archived) {
			result.reason = operations.reasons.NO_TYPE;
			return result;
		}
		operations.typeStats(type);
		result.reason = operations.payloadProvider(payloadMass, stats.payloadLimit) || '';
		if (result.reason) {
			return result;
		}
		if (!rocket) {
			rocket = operations.pickRocket(typeId, fromPadId);
		}
		if (!rocket || rocket.status !== 'available' || rocket.padId !== fromPadId) {
			result.reason = pad && operations.hasRocketAt(typeId, fromPadId) ?
				operations.reasons.ROCKET_BUSY :
				(pad ? reasonText(operations.reasons.NO_ROCKET, pad) : operations.reasons.NO_TYPE);
			return result;
		}
		preparation = operations.preparePlan(type, rocket, refuel);
		result.rocket = rocket;
		result.fuelMass = preparation.fuelMass;
		result.dryMass = preparation.dryMass;
		result.cost = operations.planCost(preparation, fromPadId);
		result.twr = R.rocket.launchTwr(type, rocket.stageState, payloadMass);
		if (result.twr < R.constants.rocket.minimumLaunchTwr) {
			result.reason = refuel ? operations.reasons.PAYLOAD_OVER : operations.reasons.NEEDS_REFUEL;
			return result;
		}
		if (R.game && R.game.cash < result.cost) {
			result.reason = operations.reasons.INSUFFICIENT_FUNDS;
			return result;
		}
		result.ready = true;
		return result;
	};

	operations.legOf = function(order, legIndex) {
		var outbound = legIndex === 1;

		return {
			index: legIndex,
			count: order.mode === 'return' ? 2 : 1,
			fromPadId: outbound ? order.source : order.destination,
			toPadId: outbound ? order.destination : order.source,
			payloadMass: outbound ? order.outboundPayload : order.returnPayload,
			refuel: outbound || order.fuelPolicy === 'refuel',
			// A contract is carried out, and is delivered (or lost) there: the
			// leg back is an ordinary standing service.
			contractId: outbound ? order.contractId || null : null
		};
	};

	operations.legDistance = function(fromPadId, toPadId) {
		var from = R.world.findPadById(fromPadId);
		var to = R.world.findPadById(toPadId);

		if (!from || !to) {
			return 0;
		}
		return Math.abs(R.util.wrapDelta(to.wx - from.wx, R.world.planet.circumference));
	};

	// Charges for the leg, restores the instance to the state it launches in and
	// hands the flight to mission.js. All validation happens before anything is
	// mutated, so a rejected launch leaves cash and fleet untouched.
	operations.beginLeg = function(game, order, leg) {
		var type = order.type;
		var rocket = operations.findRocket(order.rocketId);
		var preparation = operations.preparePlan(type, rocket, leg.refuel);
		var launchStats = { dryMass: 0 };
		var charges;
		var quote;
		var i;

		for (i = 0; i < type.stageCount; i += 1) {
			launchStats.dryMass += rocket.stageState[i].alive ?
				R.rocket.stageDryMass(type.stages[i].fuelMass, R.rocket.stageThrust(type.stages[i].fuelMass), type.stages[i].strength) :
				0;
		}
		quote = R.market.quote(leg.fromPadId, leg.toPadId, leg.payloadMass, leg.contractId);
		charges = {
			structureMass: launchStats.dryMass,
			// Capital the leg puts in the air, recorded for later depreciation.
			structureCost: launchStats.dryMass * R.economy.priceSteel(leg.fromPadId),
			turnaroundCost: R.economy.turnaround(game, preparation.dryMass, leg.fromPadId),
			fuelCost: R.economy.refuel(game, preparation.fuelMass, leg.fromPadId),
			// The payout is quoted now and paid on delivery: a price that moves
			// while the rocket is in the air cannot change the promise.
			rewardQuote: quote.reward,
			rewardPerKg: quote.pricePerKg,
			fragileSpeed: quote.fragileSpeed,
			contractId: quote.contractId
		};
		if (leg.refuel) {
			fullStageState(type, rocket.stageState);
		}
		R.rocket.applyFleetState(game.rocket, type, rocket.stageState, leg.payloadMass, R.world.findPadById(leg.fromPadId));
		rocket.status = 'flying';
		rocket.activeMissionId = order.id;
		order.currentLeg = leg.index;
		order.legFrom = leg.fromPadId;
		order.legTo = leg.toPadId;
		order.status = 'flying';
		R.mission.beginLeg(game, order, leg, charges);
		operations.touch();
		return true;
	};

	operations.dispatch = function(spec) {
		var game = R.game;
		var order;
		var evaluation;
		var contract = spec.contractId ? R.market.find(spec.contractId) : null;
		var leg;

		if (!game || game.phase !== 'deck') {
			return { ok: false, reason: operations.reasons.BUSY };
		}
		if (spec.source === spec.destination) {
			return { ok: false, reason: operations.reasons.SAME_PAD };
		}
		if (operations.state.mission) {
			return { ok: false, reason: operations.reasons.BUSY };
		}
		if (spec.contractId && (!contract || contract.status !== 'open')) {
			return { ok: false, reason: operations.reasons.CONTRACT_GONE };
		}
		if (contract && (contract.fromPadId !== spec.source || contract.toPadId !== spec.destination ||
			contract.payloadMass !== spec.outboundPayload)) {
			return { ok: false, reason: operations.reasons.CONTRACT_MISMATCH };
		}
		operations.forgetDismissal();
		evaluation = operations.evaluateLeg(spec.typeId, spec.source, spec.outboundPayload, true, spec.rocketId);
		if (!evaluation.ready) {
			return { ok: false, reason: evaluation.reason };
		}
		if (spec.mode === 'return') {
			operations.typeStats(operations.findType(spec.typeId));
			if (operations.payloadProvider(spec.returnPayload, stats.payloadLimit)) {
				return { ok: false, reason: operations.reasons.PAYLOAD_OVER };
			}
		}
		order = {
			id: operations.nextId(),
			routeId: spec.routeId || null,
			source: spec.source,
			destination: spec.destination,
			mode: spec.mode,
			fuelPolicy: spec.fuelPolicy,
			outboundPayload: spec.outboundPayload,
			returnPayload: spec.returnPayload,
			typeId: spec.typeId,
			type: snapshotType(operations.findType(spec.typeId)),
			rocketId: evaluation.rocket.id,
			profileId: spec.profileId,
			contractId: contract ? contract.id : null,
			currentLeg: 0,
			status: 'active',
			createdAt: operations.now()
		};
		operations.state.mission = order;
		game.mission = order;
		if (order.routeId) {
			evaluation.rocket.assignedRouteId = order.routeId;
		}
		if (contract) {
			R.market.assign(contract.id);
		}
		leg = operations.legOf(order, 1);
		operations.beginLeg(game, order, leg);
		return { ok: true, mission: order };
	};

	operations.logEntry = function(order, result) {
		return R.flightLog.append({
			id: operations.nextId(),
			missionId: order.id,
			routeId: order.routeId,
			leg: result.leg,
			legCount: result.legCount,
			status: result.status,
			departedPadId: result.departedPadId,
			targetPadId: result.targetPadId,
			landingPadId: result.landingPadId,
			rocketId: order.rocketId,
			rocketTypeId: order.typeId,
			rocketTypeSnapshot: order.type,
			payloadMass: result.payloadMass,
			profileId: order.profileId,
			contractId: result.contractId,
			rewardPerKg: result.rewardPerKg,
			cargoLost: result.cargoLost,
			elapsed: result.elapsed,
			fuelStart: result.fuelStart,
			fuelUsed: result.fuelUsed,
			fuelRemaining: result.fuelRemaining,
			revenue: result.revenue,
			fuelCost: result.fuelCost,
			structureCost: result.structureCost,
			turnaroundCost: result.turnaroundCost,
			autopilotFee: result.autopilotFee,
			cashDelta: result.cashDelta,
			touchdownVerticalSpeed: result.touchdownVerticalSpeed,
			touchdownHorizontalSpeed: result.touchdownHorizontalSpeed,
			targetError: result.targetError,
			peakDynamicPressure: result.peakDynamicPressure,
			peakAngleOfAttack: result.peakAngleOfAttack,
			peakAppliedThrustAcceleration: result.peakAppliedThrustAcceleration,
			completedAt: result.completedAt
		});
	};

	// A return leg that cannot light the stack it landed with is a mission
	// failure, not a wait: the rocket is parked safely and the log says why.
	function blockReturn(game, order, rocket) {
		var leg = operations.legOf(order, 2);
		var result = R.mission.returnBlocked(order, leg);

		order.status = operations.reasons.RETURN_BLOCKED;
		order.currentLeg = 2;
		operations.logEntry(order, result);
		rocket.assignedRouteId = null;
		rocket.activeMissionId = null;
		operations.state.mission = null;
		game.mission = null;
		R.mission.reportReturnBlocked(game, result);
		operations.countRouteLeg(order, result);
		return result;
	};

	operations.countRouteLeg = function(order, result) {
		var route = order.routeId ? operations.findRoute(order.routeId) : null;

		if (!route) {
			return;
		}
		if (result.status === 'delivered') {
			route.completedLegs += 1;
			route.nextDirection = order.mode === 'return' && result.leg === 1 ? 'return' : 'outbound';
		} else {
			route.failedLegs += 1;
		}
		route.lastRunAt = result.completedAt;
	};

	operations.applyLegResult = function(game, result) {
		var state = operations.state;
		var order = game.mission;
		var rocket = operations.findRocket(order.rocketId);
		var lastLeg = result.leg >= result.legCount;
		var complete = lastLeg || result.status !== 'delivered';
		var returnLeg;

		operations.logEntry(order, result);
		operations.countRouteLeg(order, result);
		// A finished leg is one dispatch turn: prices drift, open contracts
		// age and expire, boards refill. Then the leg settles the contract it
		// carried: delivered fulfils it, anything else puts it back on the
		// board with the turns it has left.
		R.market.advance();
		if (result.contractId) {
			if (result.status === 'delivered') {
				R.market.fulfil(result.contractId);
			} else {
				R.market.release(result.contractId);
			}
		}
		operations.touch();
		rocket.padId = result.landingPadId || rocket.padId;
		copyStageState(result.stageState, rocket.stageState);

		if (result.status === 'crashed') {
			rocket.status = 'lost';
			rocket.assignedRouteId = null;
			rocket.activeMissionId = null;
			order.status = 'failed';
			state.mission = null;
			game.mission = null;
			return;
		}

		rocket.status = 'available';
		if (complete) {
			rocket.assignedRouteId = null;
			rocket.activeMissionId = null;
			order.status = result.status === 'delivered' ? 'complete' : 'failed';
			state.mission = null;
			game.mission = null;
			return;
		}

		// Outbound delivered: the mission is still active and the rocket stays
		// reserved for the leg back.
		order.status = 'awaiting-return';
		returnLeg = operations.legOf(order, 2);
		order.legFrom = returnLeg.fromPadId;
		order.legTo = returnLeg.toPadId;
		order.currentLeg = 2;
		if (!returnLeg.refuel &&
			R.rocket.launchTwr(order.type, rocket.stageState, returnLeg.payloadMass) < R.constants.rocket.minimumLaunchTwr) {
			blockReturn(game, order, rocket);
		}
	};

	// Sending the leg back is an explicit step so the refuel bill is on screen
	// before it is charged.
	operations.sendReturnLeg = function() {
		var state = operations.state;
		var game = R.game;
		var order = state.mission;
		var leg;
		var evaluation;

		if (!game || game.phase !== 'deck' || !order || order.status !== 'awaiting-return') {
			return { ok: false, reason: operations.reasons.BUSY };
		}
		leg = operations.legOf(order, 2);
		evaluation = operations.evaluateLeg(order.typeId, leg.fromPadId, leg.payloadMass, leg.refuel, order.rocketId);
		if (!evaluation.ready) {
			return { ok: false, reason: evaluation.reason };
		}
		operations.beginLeg(game, order, leg);
		return { ok: true };
	};

	operations.createRoute = function(spec) {
		var route = {
			id: operations.nextId(),
			name: spec.name,
			source: spec.source,
			destination: spec.destination,
			mode: spec.mode,
			fuelPolicy: spec.fuelPolicy,
			outboundPayload: spec.outboundPayload,
			returnPayload: spec.returnPayload,
			typeId: spec.typeId,
			profileId: spec.profileId,
			// A new route waits for one review before it can fire.
			enabled: !!spec.enabled,
			autoLaunch: false,
			nextDirection: 'outbound',
			status: 'idle',
			waitReason: '',
			completedLegs: 0,
			failedLegs: 0,
			createdAt: operations.now(),
			lastRunAt: 0
		};

		operations.state.routes.push(route);
		operations.forgetDismissal();
		operations.touch();
		return route;
	};

	operations.routeLeg = function(route) {
		return route.nextDirection === 'return' ?
			{ fromPadId: route.destination, toPadId: route.source } :
			{ fromPadId: route.source, toPadId: route.destination };
	};

	operations.routeReadiness = function(route) {
		var type;

		if (!route.enabled) {
			return { ready: false, reason: operations.reasons.PAUSED };
		}
		type = operations.findType(route.typeId);
		if (!type || type.archived) {
			return { ready: false, reason: operations.reasons.NO_TYPE };
		}
		operations.typeStats(type);
		if (operations.payloadProvider(route.outboundPayload, stats.payloadLimit) ||
			(route.mode === 'return' && operations.payloadProvider(route.returnPayload, stats.payloadLimit))) {
			return { ready: false, reason: operations.reasons.PAYLOAD_OVER };
		}
		return operations.evaluateLeg(route.typeId, route.source, route.outboundPayload, true, null);
	};

	// Refreshes every route's status and wait reason and returns the oldest ready
	// one (`createdAt`, then route id), so FIFO selection is stable and testable.
	operations.refreshRoutes = function(excludeRouteId) {
		var routes = operations.state.routes;
		var best = null;
		var evaluation;
		var i;

		for (i = 0; i < routes.length; i += 1) {
			evaluation = operations.routeReadiness(routes[i]);
			routes[i].status = evaluation.ready ? 'ready' : (routes[i].enabled ? 'waiting' : 'paused');
			routes[i].waitReason = evaluation.ready ? '' : evaluation.reason;
			if (!evaluation.ready) {
				// A dismissed route is worth offering again as soon as it has been
				// out of reach once, so a cancelled launch is not a permanent veto.
				if (routes[i].id === operations.state.dismissedRouteId) {
					operations.state.dismissedRouteId = null;
				}
				continue;
			}
			if (routes[i].id === excludeRouteId) {
				continue;
			}
			if (!best || routes[i].createdAt < best.createdAt ||
				(routes[i].createdAt === best.createdAt && routes[i].id < best.id)) {
				best = routes[i];
			}
		}
		return best;
	};

	operations.dispatchRoute = function(routeId) {
		var state = operations.state;
		var route = operations.findRoute(routeId);
		var order;

		if (!route) {
			return { ok: false, reason: operations.reasons.NO_TYPE };
		}
		// The offer is being acted on, not declined: a route that becomes ready
		// again is offered again, whether this launch takes or not.
		state.offer = null;
		state.countdown = 0;
		order = operations.dispatch({
			source: route.source,
			destination: route.destination,
			mode: route.mode,
			fuelPolicy: route.fuelPolicy,
			outboundPayload: route.outboundPayload,
			returnPayload: route.returnPayload,
			typeId: route.typeId,
			profileId: route.profileId,
			routeId: route.id
		});
		operations.touch();
		return order;
	};

	operations.cancelOffer = function() {
		var state = operations.state;

		if (!state.offer) {
			return;
		}
		state.dismissedRouteId = state.offer.routeId;
		state.offer = null;
		state.countdown = 0;
		operations.touch();
	};

	operations.acceptOffer = function() {
		var offer = operations.state.offer;

		return offer ? operations.dispatchRoute(offer.routeId) : { ok: false, reason: operations.reasons.BUSY };
	};

	// Deterministic readiness plus atomic reservation, evaluated on state changes
	// and at the deck — never inside a physics step. One foreground simulation
	// means one flying route; the rest stay visibly queued.
	operations.run = function(game, dt) {
		var state = operations.state;
		var route;

		if (!state || game.phase !== 'deck' || state.mission) {
			return;
		}
		if (operations.blocked) {
			operations.cancelOffer();
			return;
		}
		if (state.offer) {
			if (!state.offer.autoLaunch) {
				return;
			}
			state.countdown -= dt;
			if (state.countdown > 0) {
				return;
			}
			operations.acceptOffer();
			return;
		}
		// Readiness only moves when operations state moves, so the search runs on
		// a change and never inside the frame loop's steady state.
		if (state.scheduledRevision === state.revision) {
			return;
		}
		state.scheduledRevision = state.revision;
		route = operations.refreshRoutes(state.dismissedRouteId);
		if (!route) {
			return;
		}
		state.offer = {
			routeId: route.id,
			autoLaunch: route.autoLaunch && route.completedLegs > 0
		};
		state.countdown = state.offer.autoLaunch ? operations.autoLaunchSeconds : 0;
		operations.touch();
	};

	operations.changeRouteType = function(routeId, typeId) {
		var route = operations.findRoute(routeId);
		var type = operations.findType(typeId);
		var state = operations.state;

		if (!route || !type) {
			return { ok: false, reason: operations.reasons.NO_TYPE };
		}
		if (state.mission && state.mission.routeId === routeId) {
			return { ok: false, reason: operations.reasons.BUSY };
		}
		operations.typeStats(type);
		if (operations.payloadProvider(route.outboundPayload, stats.payloadLimit) ||
			(route.mode === 'return' && operations.payloadProvider(route.returnPayload, stats.payloadLimit))) {
			return { ok: false, reason: operations.reasons.PAYLOAD_OVER };
		}
		route.typeId = typeId;
		operations.forgetDismissal();
		operations.touch();
		return { ok: true };
	};

	operations.setRouteEnabled = function(routeId, enabled) {
		var route = operations.findRoute(routeId);

		if (!route) {
			return false;
		}
		route.enabled = !!enabled;
		if (!route.enabled) {
			operations.cancelOffer();
		}
		operations.forgetDismissal();
		operations.touch();
		return true;
	};

	// Opt-in, and only once the route has proven itself with one delivered leg.
	operations.setRouteAutoLaunch = function(routeId, autoLaunch) {
		var route = operations.findRoute(routeId);

		if (!route) {
			return false;
		}
		route.autoLaunch = !!autoLaunch;
		operations.forgetDismissal();
		operations.touch();
		return true;
	};

	// One validated write for both the review dialog's save and a route edit: a
	// type change never mutates past log records or an already-dispatched mission.
	operations.saveRoute = function(routeId, spec) {
		var state = operations.state;
		var route = routeId ? operations.findRoute(routeId) : null;
		var type = operations.findType(spec.typeId);

		if (!type || type.archived) {
			return { ok: false, reason: operations.reasons.NO_TYPE };
		}
		if (routeId && state.mission && state.mission.routeId === routeId) {
			return { ok: false, reason: operations.reasons.BUSY };
		}
		operations.typeStats(type);
		if (operations.payloadProvider(spec.outboundPayload, stats.payloadLimit) ||
			(spec.mode === 'return' && operations.payloadProvider(spec.returnPayload, stats.payloadLimit))) {
			return { ok: false, reason: operations.reasons.PAYLOAD_OVER };
		}
		if (!route) {
			return { ok: true, routeId: operations.createRoute(spec).id };
		}
		route.name = spec.name;
		route.source = spec.source;
		route.destination = spec.destination;
		route.mode = spec.mode;
		route.fuelPolicy = spec.fuelPolicy;
		route.outboundPayload = spec.outboundPayload;
		route.returnPayload = spec.returnPayload;
		route.typeId = spec.typeId;
		route.profileId = spec.profileId;
		route.enabled = !!spec.enabled;
		route.autoLaunch = !!spec.autoLaunch;
		operations.forgetDismissal();
		operations.touch();
		return { ok: true, routeId: route.id };
	};

	operations.deleteRoute = function(routeId) {
		var routes = operations.state.routes;
		var i;

		for (i = 0; i < routes.length; i += 1) {
			if (routes[i].id === routeId) {
				routes.splice(i, 1);
				operations.forgetDismissal();
				operations.touch();
				return true;
			}
		}
		return false;
	};

	// A log row keeps its own build snapshot, so a route can be rebuilt from a
	// type that no longer exists instead of guessing another one.
	operations.restoreTypeFromSnapshot = function(snapshot) {
		return operations.addType({
			name: snapshot.name + ' (restored)',
			stageCount: snapshot.stageCount,
			stages: snapshot.stages,
			nominalPayload: snapshot.nominalPayload,
			defaultProfileId: snapshot.defaultProfileId
		});
	};

	// The route a finished leg implies: same pads, same direction, same build.
	operations.routeSpecFromLog = function(entry) {
		var snapshot = entry.rocketTypeSnapshot;

		return {
			name: R.world.findPadById(entry.departedPadId).name + ' ⇄ ' + R.world.findPadById(entry.targetPadId).name,
			source: entry.departedPadId,
			destination: entry.targetPadId,
			mode: entry.legCount === 2 ? 'return' : 'oneway',
			fuelPolicy: 'refuel',
			outboundPayload: entry.payloadMass,
			returnPayload: entry.payloadMass,
			typeId: operations.findType(entry.rocketTypeId) ? entry.rocketTypeId : null,
			typeSnapshot: snapshot,
			profileId: entry.profileId
		};
	};

	operations.initialize = function() {
		var planetId = R.world.planet.id;
		var state = {
			planetId: planetId,
			nextId: 1,
			types: [],
			fleet: [],
			routes: [],
			mission: null,
			offer: null,
			countdown: 0,
			revision: 0,
			scheduledRevision: -1,
			dismissedRouteId: null
		};

		operations.state = state;
		R.flightLog.reset();
		// Prices and contracts are part of the per-world reset: a market never
		// crosses a planet switch.
		R.market.initialize(R.market.seedFor(planetId));
		operations.referenceType();
		operations.createRocket(state.types[0], R.world.pads[0]);
		return state;
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = operations;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
