(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var mission = R.mission || (R.mission = {});

	function findLandingPad(rocket) {
		var pads = R.world.pads;
		var circumference = R.world.planet.circumference;
		var nearestPad = null;
		var nearestDistance = Infinity;
		var distance;
		var i;

		for (i = 0; i < pads.length; i += 1) {
			distance = Math.abs(R.util.wrapDelta(rocket.wx - pads[i].wx, circumference));
			if (distance < nearestDistance) {
				nearestDistance = distance;
				nearestPad = pads[i];
			}
		}

		return nearestDistance <= R.world.planet.landingRadius ? nearestPad : null;
	}

	function formatCash(value) {
		return (value < 0 ? '−$' : '+$') + Math.round(Math.abs(value));
	}

	// Where the touchdown sits against the selected pad, signed along the
	// wrap map (+x is east): a missed delivery is only diagnosable if the
	// report says by how much and to which side.
	function formatPadError(error, pad, planet) {
		var distance = Math.abs(error);
		var scale = distance < 1000 ? Math.round(distance) + ' m' : (distance / 1000).toFixed(1) + ' km';

		if (!pad) {
			return 'no target pad';
		}
		if (distance <= planet.landingRadius) {
			return Math.round(distance) + ' m from ' + pad.name + ' centre';
		}
		return scale + (error > 0 ? ' east of ' : ' west of ') + pad.name;
	}

	function padName(padId) {
		var pad = R.world.findPadById(padId);

		return pad ? pad.name : '—';
	}

	function fuelAboard(state) {
		var total = 0;
		var i;

		for (i = 0; i < state.stageCount; i += 1) {
			total += state.stages[i].alive ? state.stages[i].fuelMass : 0;
		}
		return total;
	}

	// One leg of a mission order. The rocket instance, its stage/fuel state and
	// the pad are already prepared by operations.js; this opens the flight record
	// and hands the controls to the autopilot profile the order locked in.
	mission.beginLeg = function(game, order, leg, charges) {
		var state = game.rocket;

		game.currentPadId = leg.fromPadId;
		game.targetPadId = leg.toPadId;
		game.flight = {
			missionId: order.id,
			routeId: order.routeId,
			leg: leg.index,
			legCount: leg.count,
			departedPadId: leg.fromPadId,
			targetPadId: leg.toPadId,
			payloadMass: leg.payloadMass,
			refuel: leg.refuel,
			contractId: charges.contractId,
			// Quoted at dispatch and paid on delivery; a fragile cargo has a
			// lower touchdown limit and is lost above it.
			rewardQuote: charges.rewardQuote,
			rewardPerKg: charges.rewardPerKg,
			fragileSpeed: charges.fragileSpeed,
			launchMass: R.rocket.totalMass(state),
			dryMass: charges.structureMass,
			fuelAboard: fuelAboard(state),
			fuelUsed: 0,
			fuelCost: 0,
			structureCost: 0,
			turnaroundCost: 0,
			overhaulCost: 0,
			// Quoted from 0.4.3, charged from 0.5 when touchdown hardness fills it.
			repairCost: 0,
			cashDelta: 0,
			// 0.5.1: what the flight did to the cargo and to the stack.
			payloadDamage: 0,
			failures: 0,
			cause: '',
			elapsed: 0,
			currentDynamicPressure: 0,
			currentAngleOfAttack: 0,
			peakDynamicPressure: 0,
			peakDynamicPressureAltitude: 0,
			peakDynamicPressureAngleOfAttack: 0,
			peakAngleOfAttack: 0,
			peakAngleOfAttackDynamicPressure: 0,
			peakThrustAcceleration: 0,
			peakAppliedThrustAcceleration: 0,
			usedAutopilot: true,
			autopilotProfile: order.profileId
		};
		game.lastReport = null;
		game.phase = 'flying';
		game.physicsAccumulator = 0;
		// Whether the cargo is rated for a gentler ride decides how much of
		// the flight it can take, and the damage roll is seeded per flight so
		// the same flight fails the same way twice.
		state.fragileCargo = charges.fragileSpeed > 0;
		R.damage.reset(R.operations.nextId());
		R.controls.reset();
		R.economy.beginFlight(game, charges);
		R.autopilot.setProfile(order.profileId);
		R.autopilot.setEnabled(true);
		R.autopilot.reset();
		// An autopilot launch lights the engine at the throttle the guidance
		// wants, so an acceleration cap holds from the first step.
		R.autopilot.update(game);
		state.throttle = R.autopilot.command.throttle;
		return game.flight;
	};

	// Every flight ends through here: what the log and the debrief read is
	// built by the caller, and this is the part that is only about ending it.
	function finish(game, result, landedPad) {
		var state = game.rocket;
		var i;

		for (i = 0; i < state.stageCount; i += 1) {
			result.fuelRemaining += state.stages[i].alive ? state.stages[i].fuelMass : 0;
		}
		state.wy = 0;
		state.onGround = true;
		state.landed = result.status !== 'crashed';
		state.crashed = result.status === 'crashed';
		state.padId = landedPad.id;
		game.currentPadId = landedPad.id;
		game.lastReport = mission.debrief(game, result, game.mission);
		game.flight = null;
		game.phase = 'deck';
		R.input.pointerActive = false;
		game.physicsAccumulator = 0;
		R.autopilot.reset();
		R.autopilot.setEnabled(false);
		R.controls.reset();
		// Fleet, route, log and the pending return leg are operations decisions;
		// the flight only reports what happened. The debrief returned here is
		// generated from the same result that was logged, so the two agree.
		R.operations.applyLegResult(game, result);
		if (game === R.game && !game.competitorSimulation && R.competitor) {
			R.competitor.afterPlayerLeg(game, result);
		}
		return game.lastReport;
	}

	// The record every ending shares: the flight's own numbers, the damage it
	// took and the cash it moved. A landing then measures the touchdown and a
	// rupture the moment it happens.
	function flightResult(game, status, landingPadId) {
		var flight = game.flight;
		var order = game.mission;

		return {
			status: status,
			leg: flight.leg,
			legCount: flight.legCount,
			missionId: order.id,
			departedPadId: flight.departedPadId,
			targetPadId: flight.targetPadId,
			landingPadId: landingPadId,
			payloadMass: flight.payloadMass,
			contractId: flight.contractId,
			rewardPerKg: flight.rewardPerKg,
			fragile: flight.fragileSpeed > 0,
			cargoLost: false,
			// The share of the cargo that did not survive the flight: 0.5.1
			// pays for what arrives, not for what was loaded.
			payloadDamage: Math.min(1, R.damage.payloadStress),
			failures: R.damage.active,
			cause: '',
			elapsed: flight.elapsed,
			fuelStart: flight.fuelAboard,
			fuelUsed: flight.fuelUsed,
			fuelRemaining: 0,
			fuelCost: flight.fuelCost,
			structureCost: flight.structureCost,
			turnaroundCost: flight.turnaroundCost,
			overhaulCost: flight.overhaulCost,
			repairCost: flight.repairCost,
			revenue: 0,
			autopilotFee: 0,
			cashDelta: 0,
			touchdownVerticalSpeed: 0,
			touchdownHorizontalSpeed: 0,
			targetError: 0,
			peakDynamicPressure: flight.peakDynamicPressure,
			peakDynamicPressureAltitude: flight.peakDynamicPressureAltitude,
			peakDynamicPressureAngleOfAttack: flight.peakDynamicPressureAngleOfAttack,
			peakAngleOfAttack: flight.peakAngleOfAttack,
			peakAngleOfAttackDynamicPressure: flight.peakAngleOfAttackDynamicPressure,
			peakThrustAcceleration: flight.peakThrustAcceleration,
			peakAppliedThrustAcceleration: flight.peakAppliedThrustAcceleration,
			stageState: R.rocket.captureStageState(game.rocket, R.rocket.createStageState()),
			completedAt: R.operations.now()
		};
	}

	mission.touchdown = function(game) {
		var state = game.rocket;
		var flight = game.flight;
		var planet = R.world.planet;
		var pad = findLandingPad(state);
		var targetPad = R.world.findPadById(flight.targetPadId);
		var departurePad = R.world.findPadById(flight.departedPadId);
		// Measured, not predicted: the physics step interpolates the ground
		// crossing, so these are the speeds the rocket actually arrived with.
		var targetError = targetPad ? R.util.wrapDelta(state.wx - targetPad.wx, planet.circumference) : 0;
		var safe = !!pad && Math.abs(state.vy) <= planet.landingVerticalSpeed && Math.abs(state.vx) <= planet.landingHorizontalSpeed;
		var onTarget = safe && pad.id === flight.targetPadId;
		// Landing damage is measured against the reference band the autopilot
		// arrives in, not against the crash limits: a soft touchdown costs
		// nothing, a hard one bills the stack and the cargo.
		var landing = R.damage.landing(state, state.vy, state.vx, planet, flight.fragileSpeed > 0);
		// Fragile cargo has a stricter touchdown limit than the rocket does:
		// arriving over the right pad still loses it above that speed.
		var payloadDamage = Math.min(1, R.damage.payloadStress + landing.payloadDamage);
		if (onTarget && flight.fragileSpeed > 0 && Math.abs(state.vy) > flight.fragileSpeed) {
			payloadDamage = 1;
		}
		// A crash delivers nothing, whatever the damage model is switched to.
		if (!safe) {
			payloadDamage = 1;
		}
		var cargoLost = onTarget && payloadDamage >= 1;
		var delivered = onTarget && !cargoLost;
		var reward = delivered ? flight.rewardQuote * (1 - payloadDamage) : 0;
		var fee = delivered && flight.usedAutopilot ? reward * R.autopilot.feeFraction : 0;
		var result;
		var cashDelta;

		// A safe arrival leaves its mark on the stack that came down with it;
		// the landing is measured before the record is taken, so the stage
		// state the log and the repair bill read is the one that landed. A
		// crash is written off instead.
		if (safe) {
			R.damage.applyLanding(state, landing.stress);
		}
		result = flightResult(game, delivered ? 'delivered' : (safe ? 'landed' : 'crashed'), safe ? pad.id : null);
		result.touchdownVerticalSpeed = state.vy;
		result.touchdownHorizontalSpeed = state.vx;
		result.targetError = targetError;
		result.payloadDamage = payloadDamage;
		result.cargoLost = cargoLost;
		result.revenue = reward;
		result.autopilotFee = fee;
		cashDelta = R.economy.finishFlight(game, reward, fee);
		result.cashDelta = cashDelta;
		return finish(game, result, safe ? pad : departurePad);
	};

	// A tank past its rupture limit with propellant aboard does not land: the
	// stack comes apart wherever it is, and the cargo goes with it.
	mission.rupture = function(game) {
		var state = game.rocket;
		var planet = R.world.planet;
		var targetPad = R.world.findPadById(game.flight.targetPadId);
		var result = flightResult(game, 'crashed', null);

		result.cause = 'rupture';
		game.explosion = { wx: state.wx, wy: state.wy, startedAt: game.simTime || 0 };
		result.payloadDamage = 1;
		result.cargoLost = true;
		result.touchdownVerticalSpeed = state.vy;
		result.touchdownHorizontalSpeed = state.vx;
		result.targetError = targetPad ? R.util.wrapDelta(state.wx - targetPad.wx, planet.circumference) : 0;
		result.cashDelta = R.economy.finishFlight(game, 0, 0);
		return finish(game, result, R.world.findPadById(game.flight.departedPadId));
	};

	// A headless rival flight has a fixed compute budget. If guidance ever
	// stalls past it, adjudicate a loss through the ordinary fleet/contract path.
	mission.timeout = function(game) {
		var state = game.rocket;
		var targetPad = R.world.findPadById(game.flight.targetPadId);
		var result = flightResult(game, 'crashed', null);

		result.cause = 'timeout';
		result.payloadDamage = 1;
		result.cargoLost = true;
		result.touchdownVerticalSpeed = state.vy;
		result.touchdownHorizontalSpeed = state.vx;
		result.targetError = targetPad ? R.util.wrapDelta(state.wx - targetPad.wx,
			R.world.planet.circumference) : 0;
		result.cashDelta = R.economy.finishFlight(game, 0, 0);
		return finish(game, result, R.world.findPadById(game.flight.departedPadId));
	};

	// The return leg of a no-refuel mission that cannot light the stack it landed
	// with. Nothing is charged and nothing is added to the rocket.
	mission.returnBlocked = function(order, leg) {
		return {
			status: 'return-blocked',
			leg: leg.index,
			legCount: leg.count,
			missionId: order.id,
			departedPadId: leg.fromPadId,
			targetPadId: leg.toPadId,
			landingPadId: leg.fromPadId,
			payloadMass: leg.payloadMass,
			contractId: null,
			rewardPerKg: 0,
			fragile: false,
			cargoLost: false,
			payloadDamage: 0,
			failures: 0,
			cause: '',
			elapsed: 0,
			fuelStart: 0,
			fuelUsed: 0,
			fuelRemaining: 0,
			fuelCost: 0,
			structureCost: 0,
			turnaroundCost: 0,
			overhaulCost: 0,
			repairCost: 0,
			revenue: 0,
			autopilotFee: 0,
			cashDelta: 0,
			touchdownVerticalSpeed: 0,
			touchdownHorizontalSpeed: 0,
			targetError: 0,
			peakDynamicPressure: 0,
			peakDynamicPressureAltitude: 0,
			peakDynamicPressureAngleOfAttack: 0,
			peakAngleOfAttack: 0,
			peakAngleOfAttackDynamicPressure: 0,
			peakThrustAcceleration: 0,
			peakAppliedThrustAcceleration: 0,
			stageState: R.rocket.createStageState(),
			completedAt: R.operations.now()
		};
	};

	mission.reportReturnBlocked = function(game, result) {
		game.lastReport = mission.debrief(game, result, game.mission || { type: { name: '—' }, profileId: '' });
	};

	var statusCopy = {
		delivered: { title: 'PAYLOAD DELIVERED', lead: 'Soft landing at ' },
		landed: { title: 'SAFE LANDING · NO DELIVERY', lead: 'Landed at ' },
		crashed: { title: 'CRASH · PAYLOAD LOST', lead: 'The rocket missed a safe pad landing and is written off near ' },
		rupture: { title: 'TANK RUPTURE · VEHICLE LOST', lead: 'The stack came apart in the air. ' },
		'return-blocked': { title: 'RETURN BLOCKED', lead: 'The surviving stack cannot lift the return payload from ' }
	};

	mission.debrief = function(game, result, order) {
		var planet = R.world.planet;
		var copy = statusCopy[result.cause === 'rupture' ? 'rupture' : result.status];
		var profile = result.autopilotFee > 0 ? R.autopilot.profileById(order.profileId) : null;
		var repairQuote = 0;
		var detail;

		if (result.status !== 'crashed' && order.type && order.type.stageCount) {
			repairQuote = R.parts.repairValue(order.type, result.stageState, true) *
				R.economy.priceSteel(result.landingPadId || result.departedPadId);
		}
		// A rupture ends the flight wherever the stack happened to be, so
		// there is no pad to name.
		detail = result.cause === 'rupture' ? copy.lead : copy.lead +
			padName(result.status === 'crashed' ? result.departedPadId : (result.landingPadId || result.departedPadId)) + '. ';
		if (result.failures) {
			detail += 'Failures: ' + R.damage.failureText(result.failures).toLowerCase() + '. ';
		}
		if (result.cargoLost) {
			detail += result.fragile ?
				'The fragile cargo was destroyed on touchdown. ' : 'The cargo did not survive the flight. ';
		} else if (result.status === 'delivered' && result.payloadDamage > 0) {
			detail += Math.round((1 - result.payloadDamage) * 100) + ' % of the cargo arrived and was paid for. ';
		}
		if (repairQuote > 0) {
			detail += 'The stack needs $' + Math.round(repairQuote) + ' of repairs before it flies again. ';
		}
		if (result.status === 'return-blocked') {
			detail += 'The outbound leg landed safely; no fuel or structure was added for the return.';
		} else if (result.cause === 'rupture') {
			detail += 'The flight earned nothing and the vehicle is written off.';
		} else {
			detail += 'Flight cash flow ' + formatCash(result.cashDelta) + ' · Balance $' + Math.round(game.cash) + '.';
		}
		if (result.status === 'delivered' && result.contractId) {
			detail += ' Contract delivered: ' + Math.round(result.payloadMass) + ' kg at $' +
				result.rewardPerKg.toFixed(2) + '/kg.';
		}
		if (profile) {
			detail += ' Autopilot fee $' + Math.round(result.autopilotFee) + ' (' + profile.label + ' profile).';
		}
		if (result.cause === 'rupture') {
			detail += ' Lost ' + formatPadError(result.targetError, R.world.findPadById(result.targetPadId), planet) + '.';
		} else {
			detail += ' Touchdown ' + Math.abs(result.touchdownVerticalSpeed).toFixed(1) + ' m/s down and ' +
				Math.abs(result.touchdownHorizontalSpeed).toFixed(1) + ' m/s across, ' +
				formatPadError(result.targetError, R.world.findPadById(result.targetPadId), planet) + '.';
		}
		detail += ' Peak Q ' + (result.peakDynamicPressure / 1000).toFixed(1) + ' kPa at ' +
			Math.round(result.peakDynamicPressureAltitude) + ' m (AoA ' +
			(planet.seaLevelDensity > 0 ? (result.peakDynamicPressureAngleOfAttack * 180 / Math.PI).toFixed(1) + '°' : 'n/a') +
			') · peak AoA ' +
			(planet.seaLevelDensity > 0 ? (result.peakAngleOfAttack * 180 / Math.PI).toFixed(1) + '° at ' +
			(result.peakAngleOfAttackDynamicPressure / 1000).toFixed(1) + ' kPa' : 'n/a') +
			' · peak thrust acceleration ' + result.peakAppliedThrustAcceleration.toFixed(1) + ' m/s².';

		return {
			status: result.status,
			title: result.cause === 'rupture' ? copy.title : (result.cargoLost ? 'CARGO DESTROYED' : copy.title),
			detail: detail,
			leg: result.leg,
			legCount: result.legCount,
			contractId: result.contractId,
			cargoLost: result.cargoLost,
			payloadDamage: result.payloadDamage,
			failures: result.failures,
			cause: result.cause,
			repairQuote: repairQuote,
			reward: result.revenue,
			rewardPerKg: result.rewardPerKg,
			cashDelta: result.cashDelta,
			elapsed: result.elapsed,
			landingPadId: result.landingPadId,
			touchdownVerticalSpeed: result.touchdownVerticalSpeed,
			touchdownHorizontalSpeed: result.touchdownHorizontalSpeed,
			targetError: result.targetError,
			peakDynamicPressure: result.peakDynamicPressure,
			peakDynamicPressureAltitude: result.peakDynamicPressureAltitude,
			peakDynamicPressureAngleOfAttack: result.peakDynamicPressureAngleOfAttack,
			peakAngleOfAttack: result.peakAngleOfAttack,
			peakAngleOfAttackDynamicPressure: result.peakAngleOfAttackDynamicPressure,
			peakThrustAcceleration: result.peakThrustAcceleration,
			peakAppliedThrustAcceleration: result.peakAppliedThrustAcceleration
		};
	};

	mission.findLandingPad = findLandingPad;

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = mission;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
