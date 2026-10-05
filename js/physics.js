(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var physics = R.physics || (R.physics = {});
	var aeroSample = {
		speed: 0,
		dynamicPressure: 0,
		angleOfAttack: 0,
		dragCoefficient: 0,
		dragAccelX: 0,
		dragAccelY: 0
	};

	physics.gravityAtAltitude = function(altitude) {
		var planet = R.world.planet;
		var distance = planet.radius + Math.max(0, altitude);
		var ratio = planet.radius / distance;

		return planet.surfaceGravity * ratio * ratio;
	};

	physics.densityAtAltitude = function(altitude) {
		var planet = R.world.planet;

		return planet.seaLevelDensity * Math.exp(-Math.max(0, altitude) / planet.atmosphereScaleHeight);
	};

	physics.step = function(game, dt) {
		var state = game.rocket;
		var planet = R.world.planet;
		var settings = R.constants.rocket;
		var stage = R.rocket.activeStage(state);
		var oldWx = state.wx;
		var oldWy = state.wy;
		var oldVx = state.vx;
		var oldVy = state.vy;
		var density = physics.densityAtAltitude(oldWy);
		var gravity = physics.gravityAtAltitude(oldWy);
		var massBefore = R.rocket.totalMass(state);
		var massAfter;
		var mass;
		var thrust = 0;
		var isp;
		var massFlow;
		var burn = 0;
		var thrustFraction = 0;
		var referenceArea;
		var accelerationX;
		var accelerationY;
		var acceleration;
		var newVx;
		var newVy;
		var newWx;
		var newWy;
		var crossingFraction;
		var topStage;
		var load;

		if (game.phase !== 'flying') {
			return false;
		}
		if (stage && stage.fuelMass > 0) {
			game.flight.peakThrustAcceleration = Math.max(
				game.flight.peakThrustAcceleration,
				stage.thrustMax / Math.max(1, massBefore)
			);
		}

		// A fairing rides the top stage: it is shed at the jettison altitude, or
		// goes with the stage if that stage separates first. Either way its mass
		// stops counting and drag returns to the bare reference area.
		if (state.fairingAttached) {
			topStage = state.stages[state.stageCount - 1];
			if (!topStage.alive) {
				state.fairingAttached = false;
				state.fairingMass = 0;
			} else if (oldWy >= R.constants.parts.fairingAltitude) {
				state.fairingAttached = false;
				topStage.dryMass -= state.fairingMass;
				state.fairingMass = 0;
			}
		}

		if (stage && stage.fuelMass > 0 && state.throttle > 0) {
			// Vacuum engines on an airless world, sea-level interpolation only
			// where there is an atmosphere to interpolate against.
			if (planet.seaLevelDensity > 0) {
				isp = stage.ispSea + (stage.ispVac - stage.ispSea) * (1 - density / planet.seaLevelDensity);
				isp = Math.max(stage.ispSea, Math.min(stage.ispVac, isp));
			} else {
				isp = stage.ispVac;
			}
			thrust = stage.thrustMax * state.throttle;
			massFlow = thrust / (isp * settings.standardGravity);
			burn = Math.min(stage.fuelMass, massFlow * dt);
			stage.fuelMass -= burn;
			// Service wear: an engine is rated in seconds at throttle, so the burn
			// is where the seconds are counted. A number, not an allocation.
			stage.engineBurnTimeUsed += dt;
			if (stage.fuelMass < 1e-9) {
				stage.fuelMass = 0;
			}
			thrustFraction = massFlow > 0 ? burn / (massFlow * dt) : 0;
			thrust *= thrustFraction;
			R.economy.burnFuel(game, burn);
		}

		massAfter = R.rocket.totalMass(state);
		mass = Math.max(1, (massBefore + massAfter) * 0.5);
		game.flight.peakAppliedThrustAcceleration = Math.max(game.flight.peakAppliedThrustAcceleration, thrust / Math.max(1, massBefore));
		referenceArea = state.fairingAttached ?
			settings.referenceArea * state.fairingDragFraction :
			settings.referenceArea;
		R.aerodynamics.calculate(density, oldVx, oldVy, state.heading, mass, aeroSample, referenceArea);
		game.flight.currentDynamicPressure = aeroSample.dynamicPressure;
		game.flight.currentAngleOfAttack = aeroSample.angleOfAttack;
		if (aeroSample.dynamicPressure > game.flight.peakDynamicPressure) {
			game.flight.peakDynamicPressure = aeroSample.dynamicPressure;
			game.flight.peakDynamicPressureAltitude = Math.max(0, oldWy);
			game.flight.peakDynamicPressureAngleOfAttack = aeroSample.angleOfAttack;
		}
		if (density > 0 && aeroSample.angleOfAttack > game.flight.peakAngleOfAttack) {
			game.flight.peakAngleOfAttack = aeroSample.angleOfAttack;
			game.flight.peakAngleOfAttackDynamicPressure = aeroSample.dynamicPressure;
		}
		accelerationX = thrust * Math.sin(state.heading) / mass + aeroSample.dragAccelX;
		accelerationY = thrust * Math.cos(state.heading) / mass - gravity + aeroSample.dragAccelY;
		// The load the structure carries is the non-gravitational part:
		// thrust and drag. Weight is not a load a stage has to hold up
		// against itself, so gravity is put back before it is measured.
		load = Math.sqrt(accelerationX * accelerationX +
			(accelerationY + gravity) * (accelerationY + gravity));
		acceleration = Math.sqrt(accelerationX * accelerationX + accelerationY * accelerationY);
		if (acceleration > settings.maxAcceleration) {
			accelerationX *= settings.maxAcceleration / acceleration;
			accelerationY *= settings.maxAcceleration / acceleration;
		}

		newVx = oldVx + accelerationX * dt;
		newVy = oldVy + accelerationY * dt;
		newWx = oldWx + newVx * dt;
		newWy = oldWy + newVy * dt;
		if (newWy <= 0) {
			crossingFraction = oldWy > 0 ? oldWy / (oldWy - newWy) : 0;
			state.wx = oldWx + (newWx - oldWx) * crossingFraction;
			state.vx = oldVx + (newVx - oldVx) * crossingFraction;
			state.vy = oldVy + (newVy - oldVy) * crossingFraction;
			state.wy = 0;
			game.flight.elapsed += dt * crossingFraction;
			R.mission.touchdown(game);
			return true;
		}

		state.wx = newWx;
		state.wy = newWy;
		state.vx = newVx;
		state.vy = newVy;
		game.flight.elapsed += dt;
		// Damage is judged on the step that just flew. A rupture ends the
		// flight here, not at the next ground crossing.
		R.damage.step(game, dt, load, aeroSample.dynamicPressure);
		return false;
	};

	// Frame time is capped so a refocus pause cannot teleport the rocket.
	// Time scale multiplies the simulation budget, not the fixed step, so
	// physics stays deterministic at every multiplier.
	physics.advance = function(game, frameDt) {
		var settings = R.constants.rocket;
		var dt;
		var steps = 0;

		if (game.phase !== 'flying') {
			game.physicsAccumulator = 0;
			return;
		}

		dt = Math.min(Math.max(0, frameDt), settings.maxFrameStep) * (game.timeScale || 1);
		game.physicsAccumulator += dt;
		while (game.physicsAccumulator >= settings.fixedStep && game.phase === 'flying' && steps < settings.maxSubsteps) {
			game.physicsAccumulator -= settings.fixedStep;
			physics.step(game, settings.fixedStep);
			steps += 1;
		}
		if (game.phase !== 'flying' || steps >= settings.maxSubsteps) {
			game.physicsAccumulator = 0;
		}
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = physics;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
