'use strict';

// Shared flight harness for the experiments: real autopilot commands and real
// physics, flown in the frame loop's order (one control update per frame, then
// that frame's physics budget). With a frame equal to the fixed step that is
// one update per physics step.

var R = require('../js/namespaces.js');
require('../js/parts.js');

require('../js/util.js');
require('../js/constants.js');
require('../js/planets.js');
require('../js/coords.js');
require('../js/camera.js');
require('../js/world.js');
require('../js/rocket.js');
require('../js/market.js');
require('../js/economy.js');
require('../js/flight-log.js');
require('../js/mission.js');
require('../js/aerodynamics.js');
require('../js/physics.js');
require('../js/trajectory.js');
require('../js/autopilot.js');
require('../js/operations.js');
require('../js/controls.js');
require('../js/input.js');

var harness = { R: R, maxSeconds: 300, overrideKeys: ['maxDynamicPressure', 'maxThrustAcceleration', 'maxAngleOfAttackDeg', 'stageOnAuthority'] };
// Flights that come back within this distance of the target count as arrived.
var arrivalRadius = 500;
// An axis flip only counts while the rocket is fast enough to have a clear
// airflow axis and the engine is really burning: a coasting axis that sits
// sideways to the flow crosses it on the slightest drift.
var flipSpeed = 30;
var flipThrottle = 0.1;

// `cash` defaults to the run's starting cash, so an experiment measures the
// economy the player starts with; a caller that only flies legs can pass more.
harness.createGame = function(sourcePad, targetPadId, timeScale, cash) {
	return {
		currentPadId: sourcePad.id,
		targetPadId: targetPadId,
		rocket: R.rocket.create(sourcePad),
		phase: 'deck',
		cash: cash === undefined ? R.constants.economy.startingCash : cash,
		ledger: [],
		flight: null,
		mission: null,
		lastReport: null,
		selection: { sourcePadId: sourcePad.id, targetPadId: targetPadId, mode: 'oneway', visible: true },
		simTime: 0,
		physicsAccumulator: 0,
		timeScaleIndex: R.constants.time.defaultIndex,
		timeScale: timeScale || 1
	};
};

harness.referenceBuild = function(planet, targetPadId) {
	return {
		targetPadId: targetPadId,
		stageCount: 3,
		payloadMass: planet.defaultPayload,
		stages: planet.defaultFuel.map(function(fuel, index) {
			return { fuelMass: fuel, strength: R.constants.rocket.defaultStageStrength[index] };
		})
	};
};

// Runs `work` with the live planet's flight tuning replaced (a key missing
// from `overrides` is switched off), then restores it. The envelope limits and
// the staging-authority switch both live here, so a variant can be flown with
// either held back. The autopilot is reset on both sides so the next flight
// resolves the tuning in force.
harness.withLimits = function(overrides, work) {
	var flight = R.world.planet.flight;
	var saved = {};

	harness.overrideKeys.forEach(function(key) {
		saved[key] = flight[key];
		flight[key] = overrides[key] === undefined ? null : overrides[key];
	});
	R.autopilot.reset();
	try {
		return work();
	} finally {
		harness.overrideKeys.forEach(function(key) {
			// Restore the shape as well as the values. A key that was absent
			// has to go back to being absent: left behind as an explicit
			// undefined it overrides the shared default with nothing, and a
			// flag resolved from it reads as undefined instead of true.
			if (saved[key] === undefined) {
				delete flight[key];
			} else {
				flight[key] = saved[key];
			}
		});
		R.autopilot.reset();
	}
};

// Hands the flight to the autopilot under `profileId` through the operations
// path the game itself uses: the build becomes a rocket type, one instance is
// put on the start pad, and a one-way mission order is dispatched. Returns the
// launched game, or null when the mission rejects the build.
harness.launch = function(sourcePad, targetPadId, build, profileId, timeScale) {
	var game = harness.createGame(sourcePad, targetPadId, timeScale);
	var type;
	var result;

	R.game = game;
	R.operations.initialize();
	R.operations.state.types.length = 0;
	R.operations.state.fleet.length = 0;
	type = R.operations.addType({
		name: 'harness',
		stageCount: build.stageCount,
		stages: build.stages,
		nominalPayload: build.payloadMass,
		defaultProfileId: profileId
	});
	R.operations.createRocket(type, sourcePad);
	R.autopilot.setEnabled(true);
	R.autopilot.reset();
	R.autopilot.setProfile(profileId);
	result = R.operations.dispatch({
		source: sourcePad.id,
		destination: targetPadId,
		mode: 'oneway',
		fuelPolicy: 'refuel',
		outboundPayload: build.payloadMass,
		returnPayload: 0,
		typeId: type.id,
		profileId: profileId
	});
	return result.ok ? game : null;
};

function fuelLeft(rocket) {
	var total = 0;
	var i;

	for (i = 0; i < rocket.stageCount; i += 1) {
		total += rocket.stages[i].alive ? rocket.stages[i].fuelMass : 0;
	}
	return total;
}

function thrustAcceleration(rocket) {
	var stage = R.rocket.activeStage(rocket);

	return stage && stage.fuelMass > 0 ? stage.thrustMax / R.rocket.totalMass(rocket) : 0;
}

// Flies the game to touchdown (or the time limit) and measures it. Flight
// quality metrics: `limiterToggles` counts each limiter switching on or off
// (a constraint that oscillates flickers), `sideFlips` counts the thrust axis
// changing ends of the airflow axis, `reclimb` is the altitude regained after
// arriving over the target, and the command checks cover every control update.
harness.fly = function(game, frameDt) {
	var simDt = Math.min(frameDt, R.constants.rocket.maxFrameStep) * game.timeScale;
	var command = R.autopilot.command;
	var flags = R.autopilot.limitFlags;
	var rocket = game.rocket;
	var flight = game.flight;
	var target = R.world.findPadById(game.targetPadId);
	var circumference = R.world.planet.circumference;
	var result = {
		fuelLeft: 0,
		peakAltitude: 0,
		peakSpeed: 0,
		limiterSeconds: { Q: 0, ACCEL: 0, AOA: 0 },
		limiterToggles: { Q: 0, ACCEL: 0, AOA: 0 },
		maxCommandAcceleration: 0,
		commandsValid: true,
		sideFlips: 0,
		reclimb: 0
	};
	var lowest = Infinity;
	var side = 0;
	var previousLimiter = 0;
	var speed;
	var axisSide;
	var commanded;

	while (game.phase === 'flying' && flight.elapsed < harness.maxSeconds) {
		commanded = thrustAcceleration(rocket);
		R.controls.update(game, simDt);
		if (game.phase !== 'flying') {
			break;
		}
		commanded *= command.throttle;
		result.maxCommandAcceleration = Math.max(result.maxCommandAcceleration, commanded);
		result.commandsValid = result.commandsValid && Number.isFinite(command.heading) &&
			command.throttle >= 0 && command.throttle <= 1;
		result.limiterSeconds.Q += R.autopilot.limiter & flags.Q ? simDt : 0;
		result.limiterSeconds.ACCEL += R.autopilot.limiter & flags.ACCEL ? simDt : 0;
		result.limiterSeconds.AOA += R.autopilot.limiter & flags.AOA ? simDt : 0;
		result.limiterToggles.Q += (R.autopilot.limiter ^ previousLimiter) & flags.Q ? 1 : 0;
		result.limiterToggles.ACCEL += (R.autopilot.limiter ^ previousLimiter) & flags.ACCEL ? 1 : 0;
		result.limiterToggles.AOA += (R.autopilot.limiter ^ previousLimiter) & flags.AOA ? 1 : 0;
		previousLimiter = R.autopilot.limiter;

		speed = Math.sqrt(rocket.vx * rocket.vx + rocket.vy * rocket.vy);
		result.peakAltitude = Math.max(result.peakAltitude, rocket.wy);
		result.peakSpeed = Math.max(result.peakSpeed, speed);
		result.fuelLeft = fuelLeft(rocket);
		if (speed > flipSpeed && rocket.throttle > flipThrottle) {
			axisSide = Math.sin(rocket.heading) * rocket.vx + Math.cos(rocket.heading) * rocket.vy >= 0 ? 1 : -1;
			result.sideFlips += side !== 0 && axisSide !== side ? 1 : 0;
			side = axisSide;
		}
		if (Math.abs(R.util.wrapDelta(target.wx - rocket.wx, circumference)) < arrivalRadius) {
			lowest = Math.min(lowest, rocket.wy);
			result.reclimb = Math.max(result.reclimb, rocket.wy - lowest);
		}
		R.physics.advance(game, frameDt);
	}

	result.status = game.lastReport ? game.lastReport.status : 'timeout';
	result.seconds = game.lastReport ? game.lastReport.elapsed : flight.elapsed;
	result.report = game.lastReport;
	result.flight = flight;
	return result;
};

module.exports = harness;
