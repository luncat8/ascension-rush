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

	// Structured first, prose second: the flight log stores these numbers and the
	// debrief is generated from the same record, so the two cannot diverge.
	mission.touchdown = function(game) {
		var state = game.rocket;
		var flight = game.flight;
		var order = game.mission;
		var planet = R.world.planet;
		var pad = findLandingPad(state);
		var targetPad = R.world.findPadById(flight.targetPadId);
		var departurePad = R.world.findPadById(flight.departedPadId);
		// Measured, not predicted: the physics step interpolates the ground
		// crossing, so these are the speeds the rocket actually arrived with.
		var targetError = targetPad ? R.util.wrapDelta(state.wx - targetPad.wx, planet.circumference) : 0;
		var safe = !!pad && Math.abs(state.vy) <= planet.landingVerticalSpeed && Math.abs(state.vx) <= planet.landingHorizontalSpeed;
		var onTarget = safe && pad.id === flight.targetPadId;
		// Fragile cargo has a stricter touchdown limit than the rocket does:
		// arriving over the right pad still loses it above that speed.
		var cargoLost = onTarget && flight.fragileSpeed > 0 && Math.abs(state.vy) > flight.fragileSpeed;
		var delivered = onTarget && !cargoLost;
		var reward = delivered ? flight.rewardQuote : 0;
		var fee = delivered && flight.usedAutopilot ? reward * R.autopilot.feeFraction : 0;
		var cashDelta = R.economy.finishFlight(game, reward, fee);
		var landedPad = safe ? pad : departurePad;
		var result = {
			status: delivered ? 'delivered' : (safe ? 'landed' : 'crashed'),
			leg: flight.leg,
			legCount: flight.legCount,
			missionId: order.id,
			departedPadId: flight.departedPadId,
			targetPadId: flight.targetPadId,
			landingPadId: safe ? pad.id : null,
			payloadMass: flight.payloadMass,
			contractId: flight.contractId,
			rewardPerKg: flight.rewardPerKg,
			cargoLost: cargoLost,
			elapsed: flight.elapsed,
			fuelStart: flight.fuelAboard,
			fuelUsed: flight.fuelUsed,
			fuelRemaining: 0,
			fuelCost: flight.fuelCost,
			structureCost: flight.structureCost,
			turnaroundCost: flight.turnaroundCost,
			overhaulCost: flight.overhaulCost,
			repairCost: flight.repairCost,
			revenue: reward,
			autopilotFee: fee,
			cashDelta: cashDelta,
			touchdownVerticalSpeed: state.vy,
			touchdownHorizontalSpeed: state.vx,
			targetError: targetError,
			peakDynamicPressure: flight.peakDynamicPressure,
			peakDynamicPressureAltitude: flight.peakDynamicPressureAltitude,
			peakDynamicPressureAngleOfAttack: flight.peakDynamicPressureAngleOfAttack,
			peakAngleOfAttack: flight.peakAngleOfAttack,
			peakAngleOfAttackDynamicPressure: flight.peakAngleOfAttackDynamicPressure,
			peakThrustAcceleration: flight.peakThrustAcceleration,
			peakAppliedThrustAcceleration: flight.peakAppliedThrustAcceleration,
			stageState: R.rocket.captureStageState(state, R.rocket.createStageState()),
			completedAt: R.operations.now()
		};
		var i;

		for (i = 0; i < state.stageCount; i += 1) {
			result.fuelRemaining += state.stages[i].alive ? state.stages[i].fuelMass : 0;
		}

		state.wy = 0;
		state.onGround = true;
		state.landed = safe;
		state.crashed = !safe;
		state.padId = landedPad.id;
		game.currentPadId = landedPad.id;
		game.lastReport = mission.debrief(game, result, order);
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
		return game.lastReport;
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
			cargoLost: false,
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
		'return-blocked': { title: 'RETURN BLOCKED', lead: 'The surviving stack cannot lift the return payload from ' }
	};

	mission.debrief = function(game, result, order) {
		var planet = R.world.planet;
		var copy = statusCopy[result.status];
		var profile = result.autopilotFee > 0 ? R.autopilot.profileById(order.profileId) : null;
		var detail;

		detail = copy.lead + padName(result.status === 'crashed' ? result.departedPadId : (result.landingPadId || result.departedPadId)) + '. ';
		if (result.cargoLost) {
			detail += 'The fragile cargo was destroyed on touchdown.';
		}
		if (result.status === 'return-blocked') {
			detail += 'The outbound leg landed safely; no fuel or structure was added for the return.';
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
		detail += ' Touchdown ' + Math.abs(result.touchdownVerticalSpeed).toFixed(1) + ' m/s down and ' +
			Math.abs(result.touchdownHorizontalSpeed).toFixed(1) + ' m/s across, ' +
			formatPadError(result.targetError, R.world.findPadById(result.targetPadId), planet) + '.';
		detail += ' Peak Q ' + (result.peakDynamicPressure / 1000).toFixed(1) + ' kPa at ' +
			Math.round(result.peakDynamicPressureAltitude) + ' m (AoA ' +
			(planet.seaLevelDensity > 0 ? (result.peakDynamicPressureAngleOfAttack * 180 / Math.PI).toFixed(1) + '°' : 'n/a') +
			') · peak AoA ' +
			(planet.seaLevelDensity > 0 ? (result.peakAngleOfAttack * 180 / Math.PI).toFixed(1) + '° at ' +
			(result.peakAngleOfAttackDynamicPressure / 1000).toFixed(1) + ' kPa' : 'n/a') +
			' · peak thrust acceleration ' + result.peakAppliedThrustAcceleration.toFixed(1) + ' m/s².';

		return {
			status: result.status,
			title: result.cargoLost ? 'CARGO DESTROYED' : copy.title,
			detail: detail,
			leg: result.leg,
			legCount: result.legCount,
			contractId: result.contractId,
			cargoLost: result.cargoLost,
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
