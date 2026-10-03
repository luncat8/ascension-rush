(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var mission = R.mission || (R.mission = {});
	var buildStats = R.rocket.createStats();

	function findLandingPad(rocket) {
		var pads = R.world.pads;
		var circumference = R.constants.world.circumference;
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

		return nearestDistance <= R.constants.world.landingRadius ? nearestPad : null;
	}

	function formatCash(value) {
		var rounded = Math.round(Math.abs(value));
		return (value < 0 ? '−$' : '+$') + rounded;
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
			elapsed: 0
		};

		rocketState = game.rocket;
		R.rocket.applyBuild(rocketState, config);
		rocketState.padId = source.id;
		rocketState.onGround = false;
		rocketState.launched = true;
		game.lastReport = null;
		game.phase = 'flying';
		game.physicsAccumulator = 0;
		R.economy.beginFlight(game);
		return true;
	};

	mission.touchdown = function(game) {
		var state = game.rocket;
		var flight = game.flight;
		var pad = findLandingPad(state);
		var safe = !!pad && Math.abs(state.vy) <= R.constants.world.landingVerticalSpeed && Math.abs(state.vx) <= R.constants.world.landingHorizontalSpeed;
		var delivered = safe && pad.id === flight.targetPadId;
		var departurePad = R.world.findPadById(flight.departedPadId);
		var reward = delivered ? flight.payloadMass * R.economy.priceDeliveryPerKg : 0;
		var cashDelta = R.economy.finishFlight(game, reward);
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

		game.currentPadId = landedPad.id;
		game.targetPadId = game.targetPadId === landedPad.id ? nextTargetId(landedPad.id) : game.targetPadId;
		game.lastReport = {
			status: status,
			title: title,
			detail: detail,
			cashDelta: cashDelta,
			landingPadId: safe ? pad.id : null
		};
		game.rocket = R.rocket.create(landedPad);
		game.flight = null;
		game.phase = 'building';
		R.input.pointerActive = false;
		game.physicsAccumulator = 0;
		if (R.controls && R.controls.reset) {
			R.controls.reset();
		}
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
