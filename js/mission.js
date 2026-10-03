(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var mission = R.mission || (R.mission = {});
	var buildStats = R.rocket.createStats();

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

	function nextTargetId(padId) {
		var pads = R.world.pads;
		var i;

		for (i = 0; i < pads.length; i += 1) {
			if (pads[i].id !== padId) {
				return pads[i].id;
			}
		}
		return padId;
	}

	mission.estimatedCost = function(config) {
		R.rocket.evaluateBuild(config, buildStats);
		return R.economy.estimateBuildCost(buildStats);
	};

	mission.launch = function(game, config) {
		var target = R.world.findPadById(config.targetPadId);
		var source = R.world.findPadById(game.currentPadId);
		var estimatedCost;
		var rocketState;

		if (game.phase !== 'building' || !source || !target || target.id === source.id) {
			return false;
		}

		R.rocket.evaluateBuild(config, buildStats);
		if (buildStats.twr < R.constants.rocket.minimumLaunchTwr) {
			return false;
		}

		estimatedCost = R.economy.estimateBuildCost(buildStats);
		if (game.cash < estimatedCost) {
			return false;
		}

		game.targetPadId = target.id;
		game.flight = {
			departedPadId: source.id,
			targetPadId: target.id,
			payloadMass: config.payloadMass,
			dryMass: buildStats.dryMass,
			launchMass: buildStats.totalMass,
			fuelMass: buildStats.fuelMass,
			fuelUsed: 0,
			fuelCost: 0,
			structureCost: 0,
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
			usedAutopilot: R.autopilot.enabled,
			autopilotProfile: R.autopilot.profileId
		};

		rocketState = game.rocket;
		R.rocket.applyBuild(rocketState, config);
		rocketState.padId = source.id;
		rocketState.onGround = false;
		rocketState.launched = true;
		game.lastReport = null;
		game.phase = 'flying';
		game.physicsAccumulator = 0;
		R.controls.reset();
		R.economy.beginFlight(game);
		if (R.autopilot.enabled) {
			// An autopilot launch lights the engine at the throttle the guidance
			// wants, so an acceleration cap holds from the first step.
			R.autopilot.update(game);
			rocketState.throttle = R.autopilot.command.throttle;
		}
		return true;
	};

	mission.touchdown = function(game) {
		var state = game.rocket;
		var flight = game.flight;
		var planet = R.world.planet;
		var pad = findLandingPad(state);
		var targetPad = R.world.findPadById(flight.targetPadId);
		// Measured, not predicted: the physics step interpolates the ground
		// crossing, so these are the speeds the rocket actually arrived with.
		var targetError = targetPad ? R.util.wrapDelta(state.wx - targetPad.wx, planet.circumference) : 0;
		var safe = !!pad && Math.abs(state.vy) <= planet.landingVerticalSpeed && Math.abs(state.vx) <= planet.landingHorizontalSpeed;
		var delivered = safe && pad.id === flight.targetPadId;
		var departurePad = R.world.findPadById(flight.departedPadId);
		var reward = delivered ? flight.payloadMass * R.economy.priceDelivery() : 0;
		var fee = delivered && flight.usedAutopilot ? reward * R.autopilot.feeFraction : 0;
		var cashDelta = R.economy.finishFlight(game, reward, fee);
		var landedPad = safe ? pad : departurePad;
		var status;
		var title;
		var detail;

		state.wy = 0;
		state.onGround = true;
		state.landed = safe;
		state.crashed = !safe;

		if (delivered) {
			status = 'delivered';
			title = 'PAYLOAD DELIVERED';
			detail = 'Soft landing at ' + pad.name + '. Flight cash flow ' + formatCash(cashDelta) + ' · Balance $' + Math.round(game.cash) + '.';
		} else if (safe) {
			status = 'landed';
			title = 'SAFE LANDING · NO DELIVERY';
			detail = 'Landed at ' + pad.name + '. Return to the builder to plan another leg. Cash flow ' + formatCash(cashDelta) + ' · Balance $' + Math.round(game.cash) + '.';
		} else {
			status = 'crashed';
			title = 'CRASH · PAYLOAD LOST';
			detail = 'The rocket missed a safe pad landing. Rebuilding at ' + departurePad.name + '. Cash flow ' + formatCash(cashDelta) + ' · Balance $' + Math.round(game.cash) + '.';
		}
		if (fee > 0) {
			detail += ' Autopilot fee $' + Math.round(fee) + ' (' + R.autopilot.profileById(flight.autopilotProfile).label + ' profile).';
		}
		detail += ' Touchdown ' + Math.abs(state.vy).toFixed(1) + ' m/s down and ' + Math.abs(state.vx).toFixed(1) +
			' m/s across, ' + formatPadError(targetError, targetPad, planet) + '.';
		detail += ' Peak Q ' + (flight.peakDynamicPressure / 1000).toFixed(1) + ' kPa at ' +
			Math.round(flight.peakDynamicPressureAltitude) + ' m (AoA ' +
			(R.world.planet.seaLevelDensity > 0 ? (flight.peakDynamicPressureAngleOfAttack * 180 / Math.PI).toFixed(1) + '°' : 'n/a') +
			') · peak AoA ' +
			(R.world.planet.seaLevelDensity > 0 ? (flight.peakAngleOfAttack * 180 / Math.PI).toFixed(1) + '° at ' +
			(flight.peakAngleOfAttackDynamicPressure / 1000).toFixed(1) + ' kPa' : 'n/a') +
			' · peak thrust acceleration ' + flight.peakAppliedThrustAcceleration.toFixed(1) + ' m/s².';

		game.currentPadId = landedPad.id;
		game.targetPadId = game.targetPadId === landedPad.id ? nextTargetId(landedPad.id) : game.targetPadId;
		game.lastReport = {
			status: status,
			title: title,
			detail: detail,
			cashDelta: cashDelta,
			elapsed: flight.elapsed,
			landingPadId: safe ? pad.id : null,
			touchdownVerticalSpeed: state.vy,
			touchdownHorizontalSpeed: state.vx,
			targetError: targetError,
			peakDynamicPressure: flight.peakDynamicPressure,
			peakDynamicPressureAltitude: flight.peakDynamicPressureAltitude,
			peakDynamicPressureAngleOfAttack: flight.peakDynamicPressureAngleOfAttack,
			peakAngleOfAttack: flight.peakAngleOfAttack,
			peakAngleOfAttackDynamicPressure: flight.peakAngleOfAttackDynamicPressure,
			peakThrustAcceleration: flight.peakThrustAcceleration,
			peakAppliedThrustAcceleration: flight.peakAppliedThrustAcceleration
		};
		game.rocket = R.rocket.create(landedPad);
		game.flight = null;
		game.phase = 'building';
		R.input.pointerActive = false;
		game.physicsAccumulator = 0;
		R.autopilot.reset();
		R.controls.reset();
		if (R.builder && R.builder.refresh) {
			R.builder.refresh(game);
		}
		return game.lastReport;
	};

	mission.findLandingPad = findLandingPad;

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = mission;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
