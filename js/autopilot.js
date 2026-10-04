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
	autopilot.profileId = R.constants.autopilotProfiles[0].id;
	autopilot.command = { heading: 0, throttle: 0, stage: false };
	// Bit flags for the envelope limits that shaped the latest command.
	autopilot.limitFlags = { Q: 1, ACCEL: 2, AOA: 4 };
	autopilot.limiter = 0;
	// Set for the frame an authority separation is commanded, so the HUD can
	// say why the stage number changed.
	autopilot.stagedEarly = false;

	var labels = {
		PAD: 'PAD',
		LIFT: 'CLIMB',
		CRUISE: 'CRUISE',
		APPROACH: 'APPROACH',
		ABORT: 'NO FUEL'
	};
	// Indexed by the limiter bits so the HUD never builds a string per frame.
	var limiterLabels = [
		'', 'Q LIMIT', 'ACCEL LIMIT', 'Q + ACCEL LIMIT',
		'AOA LIMIT', 'Q + AOA LIMIT', 'ACCEL + AOA LIMIT', 'Q + ACCEL + AOA LIMIT'
	];
	// A limiter is reported only when it moves the command by a visible amount.
	var limiterThrustFraction = 0.01;
	var limiterAngle = 0.01;
	// How far past "sideways" a request must be before the axis changes ends.
	var sideHysteresis = 0.35;
	var flight = {
		cruiseAltitude: 0,
		distance: 0,
		lowFuel: false
	};
	var tuningCache = { planetId: '', profileId: '', values: {} };

	function copyKnown(values, overrides) {
		var key;

		for (key in overrides) {
			if (values[key] !== undefined) {
				values[key] = overrides[key];
			}
		}
	}

	// Planet tuning over the shared defaults, then the profile's multipliers
	// folded into solver units once, so the update loop only compares numbers.
	// A limit that is off becomes a value that never binds.
	function resolveTuning(planet, profile) {
		var values = tuningCache.values;

		Object.assign(values, R.constants.autopilot);
		copyKnown(values, planet.flight);
		values.pressureCap = values.maxDynamicPressure > 0 ? values.maxDynamicPressure * profile.dynamicPressure : 0;
		values.pressureFadeStart = values.pressureCap * values.qFadeStartFraction;
		values.accelerationCap = values.maxThrustAcceleration > 0 ? Math.max(
			values.maxThrustAcceleration * profile.thrustAcceleration,
			values.minThrustToWeight * planet.surfaceGravity
		) : Infinity;
		values.angleCap = values.maxAngleOfAttackDeg > 0 ? values.maxAngleOfAttackDeg * profile.angleOfAttack * Math.PI / 180 : Math.PI / 2;
		return values;
	}

	function tuningFor(planet, profileId) {
		if (tuningCache.planetId === planet.id && tuningCache.profileId === profileId) {
			return tuningCache.values;
		}
		tuningCache.planetId = planet.id;
		tuningCache.profileId = profileId;
		return resolveTuning(planet, autopilot.profileById(profileId));
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

	// Where dynamic pressure sits in the fade band: 0 below it or with no cap,
	// 1 at the cap. It is measured from the live state rather than the last
	// physics step's telemetry, so the command reacts to the air the next step
	// will actually fly in, however coarse the frame step is.
	function pressureBand(rocket, tuning, speed) {
		var pressure;

		if (tuning.pressureCap <= 0) {
			return 0;
		}
		pressure = R.aerodynamics.dynamicPressure(R.physics.densityAtAltitude(rocket.wy), speed);
		return R.util.clamp((pressure - tuning.pressureFadeStart) / (tuning.pressureCap - tuning.pressureFadeStart), 0, 1);
	}

	// Signed angle from the end of the airflow axis the thrust axis is nearest
	// to. The rocket is symmetric, so nose-first and tail-first flight share one
	// angle of attack. The axis keeps the end it already points at until the
	// request is clearly on the other side; without that hysteresis a request
	// near "sideways" flips the axis back and forth through broadside.
	function offAxisAngle(angle, noseIntoFlow) {
		var retrograde = Math.abs(angle) > Math.PI / 2 + (noseIntoFlow ? sideHysteresis : -sideHysteresis);

		return retrograde ? angle - Math.sign(angle) * Math.PI : angle;
	}

	// How far the axis may leave the airflow. The configured envelope eases in
	// across the pressure band (a full half-turn is no limit at all), but is
	// never tighter than the angle at which the budget can still hold the
	// rocket's weight: a rocket that cannot fly sideways cannot stay up. Only
	// the part of a request along the axis is burned, so a sideways request
	// delivers budget * sin² of lift at that angle.
	function allowedAngle(tuning, band, budget, gravity) {
		var support = Math.asin(Math.sqrt(Math.min(1, tuning.weightSupportMargin * gravity / budget)));

		return Math.max(R.util.lerp(Math.PI, tuning.angleCap, band), support);
	}

	// Turns the guidance's acceleration request into the heading and throttle
	// commands while holding the flight envelope. The work happens in the
	// airflow frame: `along` is thrust that speeds the rocket into the air (the
	// part that raises Q) and `cross` is thrust sideways to it. Both limits
	// ride the same pressure band, so they ease in together and, with no
	// atmosphere, never engage.
	function commandThrust(rocket, tuning, thrustAccel, budget, gravity, requestX, requestY) {
		var command = autopilot.command;
		var speed = Math.sqrt(rocket.vx * rocket.vx + rocket.vy * rocket.vy);
		var band = pressureBand(rocket, tuning, speed);
		var flowX = 0;
		var flowY = 1;
		var along;
		var cross;
		var faded;
		var magnitude;
		var angle;
		var noseIntoFlow;
		var offAxis;
		var allowed;
		var clamped;

		if (speed > R.aerodynamics.speedEpsilon) {
			flowX = rocket.vx / speed;
			flowY = rocket.vy / speed;
		}
		noseIntoFlow = Math.sin(rocket.heading) * flowX + Math.cos(rocket.heading) * flowY >= 0;
		along = requestX * flowX + requestY * flowY;
		cross = requestX * flowY - requestY * flowX;
		// Forward thrust fades out toward the cap. Braking and sideways thrust
		// stay, so the rocket can still slow down and hold its altitude.
		faded = along > 0 ? along * band : 0;
		along -= faded;
		magnitude = Math.sqrt(along * along + cross * cross);
		angle = Math.atan2(cross, along);
		offAxis = offAxisAngle(angle, noseIntoFlow);
		allowed = allowedAngle(tuning, band, budget, gravity);
		clamped = R.util.clamp(offAxis, -allowed, allowed);
		command.heading = magnitude > 1e-6 ? Math.atan2(flowX, flowY) + angle + clamped - offAxis : rocket.heading;
		// Only the part of the request along the permitted axis is worth burning.
		command.throttle = R.util.clamp(magnitude * Math.cos(clamped - offAxis) / thrustAccel, 0, 1);
		if (faded > limiterThrustFraction * thrustAccel) {
			autopilot.limiter |= autopilot.limitFlags.Q;
		}
		if (Math.abs(clamped - offAxis) > limiterAngle) {
			autopilot.limiter |= autopilot.limitFlags.AOA;
		}
	}

	// Also drops the resolved tuning, so every flight re-reads its limits.
	autopilot.reset = function() {
		autopilot.phase = 'PAD';
		autopilot.limiter = 0;
		autopilot.stagedEarly = false;
		tuningCache.planetId = '';
		flight.cruiseAltitude = 0;
		flight.distance = 0;
		autopilot.command.heading = 0;
		autopilot.command.throttle = 0;
		autopilot.command.stage = false;
	};

	autopilot.setEnabled = function(enabled) {
		autopilot.enabled = !!enabled;
		if (!autopilot.enabled) {
			autopilot.limiter = 0;
			autopilot.command.throttle = 0;
			autopilot.command.stage = false;
		}
	};

	// A leg is an autopilot delivery only while the autopilot flies it. The
	// player who takes over with A flies the rocket; the fee is for the
	// guidance, not for the launch. Programmatic enable/disable (mission
	// start and end) leaves the flag alone.
	autopilot.toggle = function() {
		autopilot.setEnabled(!autopilot.enabled);
		if (!autopilot.enabled && R.game && R.game.flight) {
			R.game.flight.usedAutopilot = false;
		}
		return autopilot.enabled;
	};

	// The limits a flight will fly with: planet tuning, scaled by the profile.
	autopilot.tuningFor = tuningFor;

	autopilot.profileById = function(id) {
		var profiles = R.constants.autopilotProfiles;
		var i;

		for (i = 0; i < profiles.length; i += 1) {
			if (profiles[i].id === id) {
				return profiles[i];
			}
		}
		return null;
	};

	// The profile applies to flights launched after the change; a flight keeps
	// the profile it was launched with.
	autopilot.setProfile = function(id) {
		if (!autopilot.profileById(id)) {
			return false;
		}
		autopilot.profileId = id;
		return true;
	};

	autopilot.label = function() {
		return labels[autopilot.phase] || autopilot.phase;
	};

	autopilot.limiterLabel = function() {
		return limiterLabels[autopilot.limiter];
	};

	autopilot.update = function(game) {
		var command = autopilot.command;
		var rocket = game.rocket;
		var planet = R.world.planet;
		var target = R.world.findPadById(game.targetPadId);
		var tuning;
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
		var descentFeedForward;
		var verticalAuthority;
		var requestX;
		var requestY;
		var vectorX;
		var vectorY;
		var vectorMax;
		var stageIndex;
		var nextStage;
		var hoverAuthority;
		var dryStage;
		var earlyStage;

		command.stage = false;
		autopilot.limiter = 0;
		autopilot.stagedEarly = false;
		if (!autopilot.enabled || game.phase !== 'flying' || !target) {
			autopilot.phase = 'PAD';
			command.throttle = 0;
			return;
		}

		tuning = tuningFor(planet, game.flight.autopilotProfile);
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
		// The index of the stage that burns and of the one behind it, so the
		// staging rule below never has to guess which stage `stage` is.
		stageIndex = R.rocket.nextAliveStageIndex(rocket, rocket.currentStage);
		stage = stageIndex < 0 ? null : rocket.stages[stageIndex];
		nextStage = R.rocket.nextAliveStageIndex(rocket, stageIndex + 1);
		mass = R.rocket.totalMass(rocket);
		thrustAccel = stage && stage.fuelMass > 0 ? stage.thrustMax / mass : 0;
		// The acceleration cap lowers the budget itself, so the climb, brake and
		// descent profiles below plan with thrust the rocket may really use.
		budget = Math.min(tuning.thrustReserve * thrustAccel, tuning.accelerationCap);
		gravity = R.physics.gravityAtAltitude(rocket.wy);
		// The thrust acceleration a stage needs to fly the descent: braking
		// sideways and holding altitude at once. It is the same multiple of
		// gravity the acceleration cap is never allowed to fall below, so a
		// capped flight and an uncapped one judge a stage by one number.
		hoverAuthority = tuning.minThrustToWeight * gravity;
		horizontalCapability = Math.sqrt(Math.max(0, budget * budget - gravity * gravity));
		horizontalCapability = Math.max(horizontalCapability, 0.12 * budget);
		brakeAccel = Math.max(0.3, horizontalCapability / tuning.brakeMargin);

		if (autopilot.phase === 'PAD') {
			autopilot.phase = 'LIFT';
		}

		// Staging. A dry stage has to go, and so does a stage that cannot hold
		// the rocket up at any point in the burn it has left: the descent needs
		// thrust for braking sideways and holding altitude at once, and a stage
		// below that multiple loses the landing however much fuel it still has.
		// Burning only sheds mass, so the burnout figure is the most this stage
		// will ever manage — a stage that clears the multiple later in its burn
		// (a heavy booster lightening as it empties) is left alone. The stage
		// taking over has to carry at least as much fuel as the one it replaces,
		// because the separation throws the rest of this tank away: trading a
		// full tank for a smaller one spends more propellant than the authority
		// it buys. The last stage is never dropped this way, and neither is a
		// stage whose successor cannot take over from it.
		dryStage = !!stage && stage.fuelMass <= 0.5;
		earlyStage = !!stage && tuning.stageOnAuthority && !dryStage && nextStage >= 0 &&
			rocket.stages[nextStage].fuelMass >= stage.fuelMass &&
			R.rocket.stackThrustAcceleration(rocket, stageIndex, 0) < hoverAuthority &&
			R.rocket.stackThrustAcceleration(rocket, nextStage, rocket.stages[nextStage].fuelMass) >= hoverAuthority;
		if (stage && nextStage >= 0 && (dryStage || earlyStage)) {
			command.stage = true;
			autopilot.stagedEarly = earlyStage;
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
		// The descent profile is a moving target: a proportional tracker lags
		// it by roughly accel/gain m/s, and that lag is exactly the sink rate
		// the ground cannot absorb. Feed the profile's own deceleration
		// (descentMargin² * stoppingAccel) forward while the profile is live.
		descentFeedForward = 0;
		if (rocket.vy < 0 && descentRate > 0) {
			descentFeedForward = tuning.descentMargin * tuning.descentMargin * stoppingAccel *
				R.util.clamp(-rocket.vy / descentRate, 0, 1);
		}
		if (rocket.wy < tuning.terminalAltitude) {
			descentRate = Math.min(descentRate, tuning.touchdownVelocity);
			descentFeedForward = 0;
		}
		vyDesired = R.util.clamp(tuning.velocityGain * (altitudeTarget - rocket.wy), -descentRate, climbRate);
		// Final: never climb back, and start descending as soon as the horizontal
		// is settled instead of hovering on the arrival floor.
		if (adx < tuning.arrivalDistance && Math.abs(rocket.vx) < tuning.commitVelocity) {
			vyDesired = Math.min(vyDesired, -tuning.minimumDescent);
		}

		// Horizontal profile: the brake limit far out, a position term near the
		// pad. The position term converges exponentially instead of overshooting,
		// and it has no minimum speed: a floor flips the target's sign across the
		// pad, and the rocket then hunts back and forth above it.
		brakeProfileSpeed = Math.sqrt(2 * brakeAccel * adx) + 1.5;
		vxDesired = dir * Math.min(
			tuning.speedCap,
			brakeProfileSpeed,
			Math.abs(dx) * tuning.arrivalGain
		);
		// While the brake profile is what limits the speed, feed its own
		// deceleration forward: a proportional tracker lags a moving profile by
		// a/gain m/s, which is exactly the overshoot that overshot the pad.
		brakeFeedForward = 0;
		if (brakeProfileSpeed <= Math.abs(dx) * tuning.arrivalGain) {
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
		requestY = gravity + R.util.clamp(
			tuning.velocityGain * (vyDesired - rocket.vy) + descentFeedForward,
			-verticalAuthority,
			verticalAuthority
		);
		vectorY = R.util.clamp(requestY, 0, budget);
		vectorMax = Math.sqrt(Math.max(0, budget * budget - vectorY * vectorY));
		requestX = tuning.velocityGain * (vxDesired - rocket.vx) - brakeFeedForward;
		vectorX = R.util.clamp(requestX, -vectorMax, vectorMax);
		if (tuning.accelerationCap < tuning.thrustReserve * thrustAccel && (requestY > budget || Math.abs(requestX) > vectorMax)) {
			autopilot.limiter |= autopilot.limitFlags.ACCEL;
		}
		commandThrust(rocket, tuning, thrustAccel, budget, gravity, vectorX, vectorY);
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = autopilot;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
