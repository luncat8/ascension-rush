(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var autopilot = R.autopilot || (R.autopilot = {});

	// The autopilot is a command layer, not a second physics model: it fills
	// `command` with a heading, a throttle and a staging pulse, and controls.js
	// applies them through the same rate limits the player's input obeys.
	autopilot.enabled = false;
	autopilot.feeFraction = 0.1;
	autopilot.phase = 'PAD';
	autopilot.command = { heading: 0, throttle: 0, stage: false };
	autopilot.landing = { wx: 0, valid: false };

	var labels = {
		PAD: 'PAD',
		LIFT: 'CLIMB',
		CRUISE: 'CRUISE',
		APPROACH: 'APPROACH',
		ABORT: 'NO FUEL'
	};
	var flight = {
		cruiseAltitude: 0,
		distance: 0,
		lowFuel: false
	};
	var tuningCache = { planetId: '', values: {} };

	function tuningFor(planet) {
		var base = R.constants.autopilot;
		var values = tuningCache.values;
		var key;

		if (tuningCache.planetId === planet.id) {
			return values;
		}
		for (key in base) {
			values[key] = base[key];
		}
		if (planet.flight) {
			for (key in planet.flight) {
				if (values[key] !== undefined) {
					values[key] = planet.flight[key];
				}
			}
		}
		tuningCache.planetId = planet.id;
		return values;
	}

	// Ideal staged delta-v left in the stack, used only as a safety budget:
	// when it drops under the impulse needed to null the current velocity the
	// autopilot stops adding horizontal speed and saves everything for braking.
	function remainingDeltaV(rocket) {
		var settings = R.constants.rocket;
		var mass = R.rocket.totalMass(rocket);
		var deltaV = 0;
		var stage;
		var finalMass;
		var i;

		for (i = rocket.currentStage; i < rocket.stageCount; i += 1) {
			stage = rocket.stages[i];
			if (!stage.alive) {
				continue;
			}
			finalMass = mass - stage.fuelMass;
			if (stage.fuelMass > 0 && finalMass > 0) {
				deltaV += settings.standardGravity * settings.ispVacuum * Math.log(mass / finalMass);
			}
			mass = finalMass - stage.dryMass;
			if (mass <= 0) {
				break;
			}
		}
		return deltaV;
	}

	autopilot.reset = function() {
		autopilot.phase = 'PAD';
		flight.cruiseAltitude = 0;
		flight.distance = 0;
		autopilot.command.heading = 0;
		autopilot.command.throttle = 0;
		autopilot.command.stage = false;
		autopilot.landing.valid = false;
	};

	autopilot.setEnabled = function(enabled) {
		autopilot.enabled = !!enabled;
		if (!autopilot.enabled) {
			autopilot.command.throttle = 0;
			autopilot.command.stage = false;
		}
	};

	autopilot.toggle = function() {
		autopilot.setEnabled(!autopilot.enabled);
		return autopilot.enabled;
	};

	autopilot.label = function() {
		return labels[autopilot.phase] || autopilot.phase;
	};

	autopilot.update = function(game) {
		var command = autopilot.command;
		var rocket = game.rocket;
		var planet = R.world.planet;
		var tuning = tuningFor(planet);
		var target = R.world.findPadById(game.targetPadId);
		var stage;
		var mass;
		var thrustAccel;
		var budget;
		var gravity;
		var horizontalCapability;
		var brakeAccel;
		var deltaV;
		var need;
		var dx;
		var adx;
		var dir;
		var cruise;
		var altitudeTarget;
		var brakeProfileSpeed;
		var climbRate;
		var descentRate;
		var stoppingAccel;
		var vxDesired;
		var vyDesired;
		var brakeFeedForward;
		var verticalAuthority;
		var vectorX;
		var vectorY;
		var vectorMax;
		var vectorLength;

		command.stage = false;
		if (!autopilot.enabled || game.phase !== 'flying' || !target) {
			autopilot.phase = 'PAD';
			command.throttle = 0;
			return;
		}

		dx = R.util.wrapDelta(target.wx - rocket.wx, planet.circumference);
		adx = Math.abs(dx);
		if (autopilot.phase === 'PAD') {
			flight.distance = Math.max(adx, 1);
			flight.cruiseAltitude = R.util.clamp(
				tuning.cruiseAltitudeFraction * flight.distance,
				tuning.cruiseAltitudeMin,
				tuning.cruiseAltitudeMax
			);
		}
		dir = dx >= 0 ? 1 : -1;
		stage = R.rocket.activeStage(rocket);
		mass = R.rocket.totalMass(rocket);
		thrustAccel = stage && stage.fuelMass > 0 ? stage.thrustMax / mass : 0;
		budget = tuning.thrustReserve * thrustAccel;
		gravity = R.physics.gravityAtAltitude(rocket.wy);
		horizontalCapability = Math.sqrt(Math.max(0, budget * budget - gravity * gravity));
		horizontalCapability = Math.max(horizontalCapability, 0.12 * budget);
		brakeAccel = Math.max(0.3, horizontalCapability / tuning.brakeMargin);

		if (autopilot.phase === 'PAD') {
			autopilot.phase = 'LIFT';
		}

		if (stage && stage.fuelMass <= 0.5 && rocket.currentStage + 1 < rocket.stageCount) {
			command.stage = true;
		}
		if (thrustAccel <= 0) {
			autopilot.phase = 'ABORT';
			command.throttle = 0;
			return;
		}

		// Vertical profile: hold the cruise altitude, then ride the glide slope
		// down onto an arrival floor and finish with a committed descent whose
		// rate is always something the thrust can still cancel.
		cruise = flight.cruiseAltitude;
		altitudeTarget = Math.min(cruise, Math.max(
			tuning.arrivalAltitude * Math.min(1, adx / tuning.arrivalDistance),
			adx * tuning.glideSlope
		));
		if (rocket.wy < tuning.liftAltitude) {
			autopilot.phase = 'LIFT';
		} else {
			autopilot.phase = altitudeTarget < cruise ? 'APPROACH' : 'CRUISE';
		}
		verticalAuthority = tuning.verticalThrustShare * budget;
		stoppingAccel = Math.max(0.5, 0.7 * verticalAuthority);
		climbRate = Math.min(tuning.climbVelocity, tuning.climbMargin * Math.sqrt(2 * gravity * Math.max(0, altitudeTarget - rocket.wy)) + 1);
		descentRate = tuning.descentMargin * Math.sqrt(2 * stoppingAccel * Math.max(0, rocket.wy)) + 1;
		if (rocket.wy < tuning.terminalAltitude) {
			descentRate = Math.min(descentRate, tuning.touchdownVelocity);
		}
		vyDesired = R.util.clamp(tuning.velocityGain * (altitudeTarget - rocket.wy), -descentRate, climbRate);
		// Final: never climb back, and start descending as soon as the horizontal
		// is settled instead of hovering on the arrival floor.
		if (adx < tuning.arrivalDistance && Math.abs(rocket.vx) < tuning.commitVelocity) {
			vyDesired = Math.min(vyDesired, -tuning.minimumDescent);
		}

		// Horizontal profile: the brake limit far out, a position term near the
		// pad. The position term converges exponentially instead of overshooting.
		brakeProfileSpeed = Math.sqrt(2 * brakeAccel * adx) + 1.5;
		vxDesired = dir * Math.min(
			tuning.speedCap,
			brakeProfileSpeed,
			Math.abs(dx) * tuning.arrivalGain + 2
		);
		// While the brake profile is what limits the speed, feed its own
		// deceleration forward: a proportional tracker lags a moving profile by
		// a/gain m/s, which is exactly the overshoot that overshot the pad.
		brakeFeedForward = 0;
		if (brakeProfileSpeed <= Math.abs(dx) * tuning.arrivalGain + 2) {
			brakeFeedForward = brakeAccel * R.util.clamp(rocket.vx / Math.max(1, Math.abs(vxDesired)), -1, 1);
		}
		deltaV = remainingDeltaV(rocket);
		need = Math.abs(rocket.vx) + Math.sqrt(2 * gravity * Math.max(0, rocket.wy)) + 20;
		flight.lowFuel = deltaV < need;
		if (flight.lowFuel) {
			// Brake only: never trade the landing reserve for speed.
			vxDesired = R.util.clamp(vxDesired, -Math.abs(rocket.vx), Math.abs(rocket.vx));
		}

		// Thrust vector. Both axes draw on one budget, so the vertical command
		// is capped to a share of it: gravity plus a bounded climb/descent
		// correction. Whatever budget that leaves goes to the horizontal
		// channel, which is what actually decides whether the rocket reaches
		// the pad instead of overflying it.
		vectorY = gravity + R.util.clamp(
			tuning.velocityGain * (vyDesired - rocket.vy),
			-verticalAuthority,
			verticalAuthority
		);
		vectorY = R.util.clamp(vectorY, 0, budget);
		vectorMax = Math.sqrt(Math.max(0, budget * budget - vectorY * vectorY));
		vectorX = R.util.clamp(tuning.velocityGain * (vxDesired - rocket.vx) - brakeFeedForward, -vectorMax, vectorMax);
		vectorLength = Math.sqrt(vectorX * vectorX + vectorY * vectorY);
		command.heading = vectorLength > 1e-6 ? Math.atan2(vectorX, vectorY) : rocket.heading;
		command.throttle = R.util.clamp(vectorLength / thrustAccel, 0, 1);
	};

	// Vacuum ballistic projection of the impact point, for the ground marker.
	autopilot.updateLandingPrediction = function(game) {
		var rocket = game.rocket;
		var gravity;
		var discriminant;
		var seconds;

		if (game.phase !== 'flying' || rocket.wy <= 0) {
			autopilot.landing.valid = false;
			return;
		}
		gravity = R.physics.gravityAtAltitude(rocket.wy);
		discriminant = rocket.vy * rocket.vy + 2 * gravity * rocket.wy;
		if (discriminant < 0 || gravity <= 0) {
			autopilot.landing.valid = false;
			return;
		}
		seconds = (rocket.vy + Math.sqrt(discriminant)) / gravity;
		autopilot.landing.wx = rocket.wx + rocket.vx * seconds;
		autopilot.landing.valid = true;
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = autopilot;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
