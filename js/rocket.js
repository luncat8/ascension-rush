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

	// Mass of one stage, read from its parts. A missing engine/tank id resolves
	// to the default catalog entry, so a stage with only { fuelMass, strength }
	// still builds and flies. The default engine and tank carry the 0.3 numbers.
	rocket.stageDryMass = function(stage) {
		return R.parts.stageBreakdown(stage).dryMass;
	};

	rocket.evaluateBuild = function(config, out) {
		var settings = R.constants.rocket;
		var planet = R.world.planet;
		var result = out || rocket.createStats();
		var count = R.util.clamp(Math.floor(config.stageCount), 1, stageSlots);
		var payload = Math.max(0, config.payloadMass);
		var mass = payload;
		var initialMassWithoutPayload = 0;
		var stage;
		var fuel;
		var breakdown;
		var engine;
		var finalMass;
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
			breakdown = R.parts.stageBreakdown(stage);
			fuel = Math.max(0, stage.fuelMass);
			result.stageDryMass[i] = breakdown.dryMass;
			result.fuelMass += fuel;
			result.dryMass += breakdown.dryMass;
			result.totalMass += fuel + breakdown.dryMass;
			initialMassWithoutPayload += fuel + breakdown.dryMass;
			if (i === 0) {
				result.thrustMax = breakdown.thrust;
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
			breakdown = R.parts.stageBreakdown(stage);
			engine = R.parts.engine(stage.engineId);
			finalMass = mass - fuel;
			if (fuel > 0 && finalMass > 0) {
				result.deltaV += settings.standardGravity *
					(engine.ispSea + engine.ispVac) * 0.5 * Math.log(mass / finalMass);
			}
			mass = finalMass - result.stageDryMass[i];
			if (mass <= 0) {
				break;
			}
		}

		return result;
	};

	rocket.createStageState = function() {
		return [
			{ alive: false, fuelMass: 0 },
			{ alive: false, fuelMass: 0 },
			{ alive: false, fuelMass: 0 }
		];
	};

	// Snapshot what survived a flight: stages separated in flight do not
	// reappear, so a fleet instance carries this instead of the template.
	rocket.captureStageState = function(state, out) {
		var i;

		for (i = 0; i < stageSlots; i += 1) {
			out[i].alive = i < state.stageCount && state.stages[i].alive;
			out[i].fuelMass = out[i].alive ? state.stages[i].fuelMass : 0;
		}
		return out;
	};

	rocket.stageThrust = function(stage) {
		return R.parts.stageThrust(stage);
	};

	// The stack a fleet instance would launch with: the type's stages, kept only
	// where the instance still has them, at whatever fuel is aboard.
	rocket.stackMass = function(type, stageState, payloadMass) {
		var mass = payloadMass;
		var i;

		for (i = 0; i < type.stageCount; i += 1) {
			if (!stageState[i].alive) {
				continue;
			}
			mass += rocket.stageDryMass(type.stages[i]) + stageState[i].fuelMass;
		}
		return mass;
	};

	// Thrust of the first surviving stage, which is the one that lights.
	rocket.stackThrust = function(type, stageState) {
		var i;

		for (i = 0; i < type.stageCount; i += 1) {
			if (stageState[i].alive) {
				return rocket.stageThrust(type.stages[i]);
			}
		}
		return 0;
	};

	// The ordinary launch gate, judged on the stack that is actually on the pad:
	// a rocket that shed stages has to clear it with what is left.
	rocket.launchTwr = function(type, stageState, payloadMass) {
		var mass = rocket.stackMass(type, stageState, payloadMass);

		return mass > 0 ? rocket.stackThrust(type, stageState) / (mass * R.world.planet.surfaceGravity) : 0;
	};

	// Fuel the instance still has to buy to reach the type's capacities, and the
	// dry mass of the stages it is missing. Both are what a turnaround charges.
	rocket.restorePlan = function(type, stageState, plan) {
		var i;

		plan.fuelMass = 0;
		plan.dryMass = 0;
		for (i = 0; i < type.stageCount; i += 1) {
			if (!stageState[i].alive) {
				plan.dryMass += rocket.stageDryMass(type.stages[i]);
				plan.fuelMass += type.stages[i].fuelMass;
				continue;
			}
			plan.fuelMass += Math.max(0, type.stages[i].fuelMass - stageState[i].fuelMass);
		}
		return plan;
	};

	// Put a fleet instance back on the pad: the type's template for the stages it
	// still has, at the fuel it still has, with the rest gone.
	rocket.applyFleetState = function(state, type, stageState, payloadMass, pad) {
		var settings = R.constants.rocket;
		var count = R.util.clamp(Math.floor(type.stageCount), 1, stageSlots);
		var stage;
		var fuelMax;
		var thrust;
		var firstAlive = -1;
		var i;

		state.stageCount = count;
		state.payloadMass = payloadMass;
		state.throttle = 1;
		state.heading = 0;
		state.vx = 0;
		state.vy = 0;
		state.wx = pad.wx;
		state.wy = 0;
		state.padId = pad.id;
		state.onGround = false;
		state.launched = true;
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

			fuelMax = type.stages[i].fuelMass;
			thrust = rocket.stageThrust(type.stages[i]);
			stage.fuelMax = fuelMax;
			stage.dryMass = rocket.stageDryMass(type.stages[i]);
			stage.thrustMax = thrust;
			stage.ispSea = R.parts.engine(type.stages[i].engineId).ispSea;
			stage.ispVac = R.parts.engine(type.stages[i].engineId).ispVac;
			stage.strength = type.stages[i].strength;
			stage.alive = stageState[i].alive;
			stage.fuelMass = stage.alive ? stageState[i].fuelMass : 0;
			if (stage.alive && firstAlive < 0) {
				firstAlive = i;
			}
		}
		state.currentStage = firstAlive < 0 ? count : firstAlive;
		// A fairing rides the top stage only; it shrinks drag until it is dropped
		// and adds its mass once at build. A type without one keeps these neutral.
		var topStage = type.stages[count - 1];
		var fairing = R.parts.fairing(topStage.fairingId);
		state.fairingAttached = !!fairing;
		state.fairingMass = fairing ? fairing.mass : 0;
		state.fairingDragFraction = fairing ? fairing.dragFraction : 1;
		return state;
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
			crashed: false,
			fairingAttached: false,
			fairingMass: 0,
			fairingDragFraction: 1
		};
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

	// The first stage at or after `from` that is still attached, or -1. A
	// separation leaves the spent stage behind, so never assume currentStage + 1
	// is the one that burns next.
	rocket.nextAliveStageIndex = function(state, from) {
		var i;

		for (i = from; i < state.stageCount; i += 1) {
			if (state.stages[i].alive) {
				return i;
			}
		}
		return -1;
	};

	rocket.activeStage = function(state) {
		var index = rocket.nextAliveStageIndex(state, state.currentStage);

		return index < 0 ? null : state.stages[index];
	};

	// Thrust acceleration the stack would have with the stage at `index` burning
	// and every stage below it gone, with `fuel` of that stage still aboard.
	// Staging sheds dry mass and unburned fuel, so the same engine can hold a much
	// lighter rocket than it does right now — which is what an early separation is
	// judged on. Burning only ever sheds mass too, so a stage is weakest at
	// light-off and strongest at burnout.
	rocket.stackThrustAcceleration = function(state, index, fuel) {
		var stage = state.stages[index];
		var mass = state.payloadMass + stage.dryMass + fuel;
		var i;

		for (i = index + 1; i < state.stageCount; i += 1) {
			if (state.stages[i].alive) {
				mass += state.stages[i].dryMass + state.stages[i].fuelMass;
			}
		}
		return stage.thrustMax / Math.max(1, mass);
	};

	// The next stage ignites at `ignitionThrottle`; a player's staging lights it
	// at full throttle.
	rocket.separateStage = function(state, ignitionThrottle = 1) {
		var stage = rocket.activeStage(state);
		var next;

		if (!stage) {
			return false;
		}

		stage.alive = false;
		next = rocket.nextAliveStageIndex(state, state.currentStage + 1);
		state.currentStage = next < 0 ? state.stageCount : next;
		state.throttle = next < 0 ? 0 : ignitionThrottle;
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
