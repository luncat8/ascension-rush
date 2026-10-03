'use strict';

// Flight envelope report: real autopilot commands and real physics on every
// directed pad-to-pad route. Usage: node experiments/envelope.js [planetId] [configIndex]

var R = require('../js/namespaces.js');

require('../js/util.js');
require('../js/constants.js');
require('../js/planets.js');
require('../js/coords.js');
require('../js/camera.js');
require('../js/world.js');
require('../js/rocket.js');
require('../js/economy.js');
require('../js/mission.js');
require('../js/aerodynamics.js');
require('../js/physics.js');
require('../js/autopilot.js');
require('../js/controls.js');
require('../js/input.js');

var configs = [
	{
		label: 'planet reference',
		stageCount: 3,
		fromPlanet: true
	},
	{
		label: 'default 3-stage',
		stageCount: 3,
		payloadMass: R.constants.rocket.defaultPayloadMass,
		stages: [
			{ fuelMass: R.constants.rocket.defaultStageFuel[0], strength: 0.85 },
			{ fuelMass: R.constants.rocket.defaultStageFuel[1], strength: 0.9 },
			{ fuelMass: R.constants.rocket.defaultStageFuel[2], strength: 0.9 }
		]
	},
	{
		label: 'single stage',
		stageCount: 1,
		payloadMass: 80,
		stages: [
			{ fuelMass: 900, strength: 0.9 },
			{ fuelMass: 100, strength: 0.9 },
			{ fuelMass: 100, strength: 0.9 }
		]
	},
	{
		label: 'overbuilt 3-stage',
		stageCount: 3,
		payloadMass: 300,
		stages: [
			{ fuelMass: 1500, strength: 1 },
			{ fuelMass: 1200, strength: 1 },
			{ fuelMass: 900, strength: 1 }
		]
	}
];

var step = R.constants.rocket.fixedStep;
var planetId = process.argv[2] || R.planets.defaultId;
var configIndex = Number(process.argv[3] || 0);
var config;
var planet;
var rows = [];
var limits = { maxSteps: 300 / step };

function resolveConfig(template, targetPadId) {
	var shipped;

	if (!template.fromPlanet) {
		shipped = JSON.parse(JSON.stringify(template));
		shipped.targetPadId = targetPadId;
		return shipped;
	}
	return {
		targetPadId: targetPadId,
		stageCount: 3,
		payloadMass: planet.defaultPayload,
		stages: planet.defaultFuel.map(function(fuel, index) {
			return { fuelMass: fuel, strength: R.constants.rocket.defaultStageStrength[index] };
		})
	};
}

function createGame(sourcePad, targetPadId) {
	return {
		currentPadId: sourcePad.id,
		targetPadId: targetPadId,
		rocket: R.rocket.create(sourcePad),
		phase: 'building',
		cash: 1000000,
		ledger: [],
		flight: null,
		lastReport: null,
		simTime: 0,
		physicsAccumulator: 0,
		timeScaleIndex: R.constants.time.defaultIndex,
		timeScale: 1
	};
}

function flyTo(sourcePad, targetPad) {
	var game = createGame(sourcePad, targetPad.id);
	var steps = 0;
	var fuelLeft = 0;
	var peakAltitude = 0;
	var peakSpeed = 0;
	var shipped = resolveConfig(config, targetPad.id);
	var flight;

	R.game = game;
	R.autopilot.setEnabled(true);
	R.autopilot.reset();
	if (!R.mission.launch(game, shipped)) {
		return { rejected: true };
	}
	flight = game.flight;

	while (game.phase === 'flying' && steps < limits.maxSteps) {
		R.controls.update(game, step);
		if (game.phase !== 'flying') {
			break;
		}
		peakAltitude = Math.max(peakAltitude, game.rocket.wy);
		peakSpeed = Math.max(peakSpeed, Math.hypot(game.rocket.vx, game.rocket.vy));
		fuelLeft = game.rocket.stages.reduce(function(sum, stage) {
			return sum + (stage.alive ? stage.fuelMass : 0);
		}, 0);
		R.physics.advance(game, step);
		steps += 1;
	}

	return {
		rejected: false,
		status: game.lastReport ? game.lastReport.status : 'timeout(' + R.autopilot.label() + ')',
		seconds: game.lastReport ? game.lastReport.elapsed : flight.elapsed,
		fuelLeft: fuelLeft,
		peakAltitude: peakAltitude,
		peakSpeed: peakSpeed,
		peakDynamicPressure: flight.peakDynamicPressure,
		peakDynamicPressureAltitude: flight.peakDynamicPressureAltitude,
		peakDynamicPressureAngleOfAttack: flight.peakDynamicPressureAngleOfAttack,
		peakAngleOfAttack: flight.peakAngleOfAttack,
		peakAngleOfAttackDynamicPressure: flight.peakAngleOfAttackDynamicPressure,
		peakThrustAcceleration: flight.peakThrustAcceleration,
		dryMass: flight.dryMass
	};
}

function padLeft(value, width) {
	var text = String(value);

	while (text.length < width) {
		text = ' ' + text;
	}
	return text;
}

function padRight(value, width) {
	var text = String(value);

	while (text.length < width) {
		text += ' ';
	}
	return text;
}

R.world.initialize(planetId);
planet = R.world.planet;
config = configs[configIndex] || configs[0];
if (config.fromPlanet) {
	console.log('(planet reference build: payload ' + planet.defaultPayload + ' kg, stages ' + planet.defaultFuel.join('/') + ' kg)');
}
console.log('=== ' + planet.name + ' · ' + config.label + ' · C ' + Math.round(planet.circumference / 100) / 10 +
	' km · g ' + planet.surfaceGravity + ' m/s² · ' + planet.seaLevelDensity + ' kg/m³ ===');
console.log(padRight('directed route', 25) + padLeft('km', 6) + padLeft('result', 10) + padLeft('time', 8) + padLeft('peak alt', 10) + padLeft('peak v', 9) + padLeft('dry mass', 10) + padLeft('peak Q', 11) + padLeft('Q alt', 9) + padLeft('AoA@Qpk', 10) + padLeft('AoAmax/Q', 14) + padLeft('peak T/m', 11) + padLeft('fuel left', 11));

R.world.pads.forEach(function(sourcePad) {
	R.world.pads.forEach(function(targetPad) {
		var result;
		var label;
		var distance;

		if (sourcePad.id === targetPad.id) {
			return;
		}
		label = sourcePad.name + ' → ' + targetPad.name;
		result = flyTo(sourcePad, targetPad);
		if (result.rejected) {
			console.log(padRight(label, 25) + padLeft('—', 6) + padLeft('rejected', 10));
			return;
		}
		distance = Math.abs(R.util.wrapDelta(targetPad.wx - sourcePad.wx, planet.circumference));
		rows.push(result);
		console.log(
			padRight(label, 25) +
			padLeft((distance / 1000).toFixed(1), 6) +
			padLeft(result.status, 10) +
			padLeft(result.seconds.toFixed(1) + 's', 8) +
			padLeft(Math.round(result.peakAltitude) + 'm', 10) +
			padLeft(Math.round(result.peakSpeed) + 'm/s', 9) +
			padLeft(Math.round(result.dryMass) + 'kg', 10) +
			padLeft((result.peakDynamicPressure / 1000).toFixed(1) + 'kPa', 11) +
			padLeft(Math.round(result.peakDynamicPressureAltitude) + 'm', 9) +
			padLeft(planet.seaLevelDensity > 0 ? (result.peakDynamicPressureAngleOfAttack * 180 / Math.PI).toFixed(1) + '°' : 'n/a', 10) +
			padLeft(planet.seaLevelDensity > 0 ? (result.peakAngleOfAttack * 180 / Math.PI).toFixed(1) + '/' + (result.peakAngleOfAttackDynamicPressure / 1000).toFixed(1) : 'n/a', 14) +
			padLeft(result.peakThrustAcceleration.toFixed(1), 11) +
			padLeft(result.fuelLeft.toFixed(1) + 'kg', 11)
		);
	});
});

if (rows.length) {
	var delivered = 0;
	var peakQ = 0;
	var peakQAoA = 0;
	var peakAoA = 0;
	var peakAoAQ = 0;
	var peakThrustAcceleration = 0;
	var i;

	for (i = 0; i < rows.length; i += 1) {
		delivered += rows[i].status === 'delivered' ? 1 : 0;
		if (rows[i].peakDynamicPressure > peakQ) {
			peakQ = rows[i].peakDynamicPressure;
			peakQAoA = rows[i].peakDynamicPressureAngleOfAttack;
		}
		if (rows[i].peakAngleOfAttack > peakAoA) {
			peakAoA = rows[i].peakAngleOfAttack;
			peakAoAQ = rows[i].peakAngleOfAttackDynamicPressure;
		}
		peakThrustAcceleration = Math.max(peakThrustAcceleration, rows[i].peakThrustAcceleration);
	}
	console.log('routes delivered: ' + delivered + '/' + rows.length +
		' · envelope maxima: Q ' + (peakQ / 1000).toFixed(1) + ' kPa at AoA ' +
		(planet.seaLevelDensity > 0 ? (peakQAoA * 180 / Math.PI).toFixed(1) + '°' : 'n/a') + ' · max AoA ' +
		(planet.seaLevelDensity > 0 ? (peakAoA * 180 / Math.PI).toFixed(1) + '° at Q ' + (peakAoAQ / 1000).toFixed(1) + ' kPa' : 'n/a') +
		' · thrust acceleration ' + peakThrustAcceleration.toFixed(1) + ' m/s²');
}
