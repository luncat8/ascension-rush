(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var physics = R.physics || (R.physics = {});

	physics.gravityAtAltitude = function(altitude) {
		var world = R.constants.world;
		var radius = world.radius;
		var distance = radius + Math.max(0, altitude);
		var ratio = radius / distance;

		return world.surfaceGravity * ratio * ratio;
	};

	physics.densityAtAltitude = function(altitude) {
		var world = R.constants.world;
		return world.seaLevelDensity * Math.exp(-Math.max(0, altitude) / world.atmosphereScaleHeight);
	};

	physics.step = function(game, dt) {
		var state = game.rocket;
		var world = R.constants.world;
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
		var speed = Math.sqrt(oldVx * oldVx + oldVy * oldVy);
		var dragScale;
		var accelerationX;
		var accelerationY;
		var acceleration;
		var newVx;
		var newVy;
		var newWx;
		var newWy;
		var crossingFraction;

		if (game.phase !== 'flying') {
			return false;
		}

		if (stage && stage.fuelMass > 0 && state.throttle > 0) {
			isp = stage.ispSea + (stage.ispVac - stage.ispSea) * (1 - density / world.seaLevelDensity);
			isp = Math.max(stage.ispSea, Math.min(stage.ispVac, isp));
			thrust = stage.thrustMax * state.throttle;
			massFlow = thrust / (isp * world.surfaceGravity);
			burn = Math.min(stage.fuelMass, massFlow * dt);
			stage.fuelMass -= burn;
			if (stage.fuelMass < 1e-9) {
				stage.fuelMass = 0;
			}
			thrustFraction = massFlow > 0 ? burn / (massFlow * dt) : 0;
			thrust *= thrustFraction;
			R.economy.consumeFuel(game, burn);
		}

		massAfter = R.rocket.totalMass(state);
		mass = Math.max(1, (massBefore + massAfter) * 0.5);
		dragScale = 0.5 * density * world.dragCoefficient * settings.referenceArea * speed / mass;
		accelerationX = thrust * Math.sin(state.heading) / mass - dragScale * oldVx;
		accelerationY = thrust * Math.cos(state.heading) / mass - gravity - dragScale * oldVy;
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
		return false;
	};

	physics.advance = function(game, frameDt) {
		var step = R.constants.rocket.fixedStep;
		var dt = Math.min(Math.max(0, frameDt), R.constants.rocket.maxFrameStep);

		if (game.phase !== 'flying') {
			game.physicsAccumulator = 0;
			return;
		}

		game.physicsAccumulator += dt;
		while (game.physicsAccumulator >= step && game.phase === 'flying') {
			game.physicsAccumulator -= step;
			physics.step(game, step);
		}
		if (game.phase !== 'flying') {
			game.physicsAccumulator = 0;
		}
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = physics;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
