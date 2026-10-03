(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var rocket = R.rocket || (R.rocket = {});
	var stageSlots = 3;

	function createStage() {
		return {
			fuelMass: 0,
			fuelMax: 0,
			dryMass: 0,
			thrustMax: 0,
			ispSea: 0,
			ispVac: 0,
			strength: 1,
			alive: false
		};
	}

	rocket.createStats = function() {
		return {
			totalMass: 0,
			dryMass: 0,
			fuelMass: 0,
			thrustMax: 0,
			twr: 0,
			payloadLimit: 0,
			deltaV: 0,
			stageDryMass: [0, 0, 0]
		};
	};

	rocket.stageDryMass = function(fuelMax, thrustMax, strength) {
		var settings = R.constants.rocket;
		var structureFactor = 0.65 + 0.35 * R.util.clamp(strength, 0.5, 1);
		var tankMass = fuelMax * settings.tankMassPerFuelMass * structureFactor;
		var engineMass = settings.engineBaseMass + thrustMax / settings.engineThrustToMass;

		return tankMass + engineMass;
	};

	rocket.evaluateBuild = function(config, out) {
		var settings = R.constants.rocket;
		var planet = R.constants.world;
		var result = out || rocket.createStats();
		var count = R.util.clamp(Math.floor(config.stageCount), 1, stageSlots);
		var payload = Math.max(0, config.payloadMass);
		var mass = payload;
		var initialMassWithoutPayload = 0;
		var stage;
		var fuel;
		var thrust;
		var dryMass;
		var finalMass;
		var averageIsp = (settings.ispSeaLevel + settings.ispVacuum) * 0.5;
		var i;

		result.totalMass = payload;
		result.dryMass = 0;
		result.fuelMass = 0;
		result.thrustMax = 0;
		result.twr = 0;
		result.payloadLimit = 0;
		result.deltaV = 0;
		for (i = 0; i < stageSlots; i += 1) {
			result.stageDryMass[i] = 0;
		}

		for (i = 0; i < count; i += 1) {
			stage = config.stages[i];
			fuel = Math.max(0, stage.fuelMass);
			thrust = fuel * settings.thrustPerFuelMass;
			dryMass = rocket.stageDryMass(fuel, thrust, stage.strength);
			result.stageDryMass[i] = dryMass;
			result.fuelMass += fuel;
			result.dryMass += dryMass;
			result.totalMass += fuel + dryMass;
			initialMassWithoutPayload += fuel + dryMass;
			if (i === 0) {
				result.thrustMax = thrust;
			}
		}

		result.twr = result.totalMass > 0 ? result.thrustMax / (result.totalMass * planet.surfaceGravity) : 0;
		if (result.thrustMax > 0) {
			result.payloadLimit = Math.max(0, result.thrustMax / (planet.surfaceGravity * settings.minimumLaunchTwr) - initialMassWithoutPayload);
		}
		result.payloadLimit = Math.min(result.payloadLimit, settings.maxPayloadMass);

		mass = result.totalMass;
		for (i = 0; i < count; i += 1) {
			stage = config.stages[i];
			fuel = Math.max(0, stage.fuelMass);
			finalMass = mass - fuel;
			if (fuel > 0 && finalMass > 0) {
				result.deltaV += R.constants.world.surfaceGravity * averageIsp * Math.log(mass / finalMass);
			}
			mass = finalMass - result.stageDryMass[i];
			if (mass <= 0) {
				break;
			}
		}

		return result;
	};

	rocket.create = function(pad) {
		return {
			wx: pad.wx,
			wy: 0,
			vx: 0,
			vy: 0,
			heading: 0,
			onGround: true,
			padId: pad.id,
			stages: [createStage(), createStage(), createStage()],
			stageCount: 0,
			currentStage: 0,
			throttle: 0,
			payloadMass: 0,
			launched: false,
			landed: false,
			crashed: false
		};
	};

	rocket.applyBuild = function(state, config) {
		var settings = R.constants.rocket;
		var count = R.util.clamp(Math.floor(config.stageCount), 1, stageSlots);
		var stage;
		var fuel;
		var thrust;
		var i;

		state.stageCount = count;
		state.currentStage = 0;
		state.payloadMass = config.payloadMass;
		state.throttle = 1;
		state.heading = 0;
		state.vx = 0;
		state.vy = 0;
		state.wy = 0;
		state.landed = false;
		state.crashed = false;

		for (i = 0; i < stageSlots; i += 1) {
			stage = state.stages[i];
			if (i >= count) {
				stage.fuelMass = 0;
				stage.fuelMax = 0;
				stage.dryMass = 0;
				stage.thrustMax = 0;
				stage.strength = 1;
				stage.alive = false;
				continue;
			}

			fuel = config.stages[i].fuelMass;
			thrust = fuel * settings.thrustPerFuelMass;
			stage.fuelMass = fuel;
			stage.fuelMax = fuel;
			stage.dryMass = rocket.stageDryMass(fuel, thrust, config.stages[i].strength);
			stage.thrustMax = thrust;
			stage.ispSea = settings.ispSeaLevel;
			stage.ispVac = settings.ispVacuum;
			stage.strength = config.stages[i].strength;
			stage.alive = true;
		}
	};

	rocket.totalMass = function(state) {
		var mass = state.payloadMass;
		var stage;
		var i;

		for (i = 0; i < state.stageCount; i += 1) {
			stage = state.stages[i];
			if (!stage.alive) {
				continue;
			}
			mass += stage.dryMass + stage.fuelMass;
		}
		return mass;
	};

	rocket.activeStage = function(state) {
		if (state.currentStage >= state.stageCount) {
			return null;
		}
		if (!state.stages[state.currentStage].alive) {
			return null;
		}
		return state.stages[state.currentStage];
	};

	rocket.separateStage = function(state) {
		var stage = rocket.activeStage(state);
		if (!stage) {
			return false;
		}

		stage.alive = false;
		state.currentStage += 1;
		while (state.currentStage < state.stageCount && !state.stages[state.currentStage].alive) {
			state.currentStage += 1;
		}
		state.throttle = state.currentStage < state.stageCount ? 1 : 0;
		return true;
	};

	rocket.draw = function(context, sx, sy, heading, throttle) {
		var flameLength;

		context.save();
		context.translate(sx, sy);
		context.rotate(heading);

		if (throttle > 0.01) {
			flameLength = 7 + throttle * 15;
			context.globalAlpha = 0.55 + throttle * 0.4;
			context.beginPath();
			context.moveTo(-4, 3);
			context.lineTo(0, flameLength);
			context.lineTo(4, 3);
			context.closePath();
			context.fillStyle = '#ff8a55';
			context.fill();
			context.globalAlpha = 1;
		}

		context.beginPath();
		context.moveTo(0, -28);
		context.lineTo(9, 0);
		context.lineTo(0, -4);
		context.lineTo(-9, 0);
		context.closePath();
		context.fillStyle = '#e9f0f2';
		context.fill();
		context.lineWidth = 1.5;
		context.strokeStyle = '#152635';
		context.stroke();

		context.beginPath();
		context.moveTo(0, -28);
		context.lineTo(0, -36);
		context.lineWidth = 2;
		context.strokeStyle = '#f4c76a';
		context.stroke();

		context.beginPath();
		context.moveTo(-3, 0);
		context.lineTo(0, 4);
		context.lineTo(3, 0);
		context.lineWidth = 2;
		context.strokeStyle = '#8498a2';
		context.stroke();

		context.restore();
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = rocket;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
