'use strict';

// Flight envelope report: flies the real physics with the real autopilot
// command layer and prints flight time, fuel burn and outcome per route.
// Usage: node experiments/envelope.js [planetId] [configIndex]

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
require('../js/physics.js');
require('../js/autopilot.js');
require('../js/controls.js');
require('../js/input.js');

var configs = [
	{
		label: 'planet default',
		targetPadId: '',
		stageCount: 3,
		payloadMass: 0,
		stages: null,
		fromPlanet: true
	},
	{
		label: 'default 3-stage',
		targetPadId: '',
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
		targetPadId: '',
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
		targetPadId: '',
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

function resolveConfig(template) {
	var shipped;

	if (!template.fromPlanet) {
		return JSON.parse(JSON.stringify(template));
	}
	shipped = {
		label: template.label,
		targetPadId: '',
		stageCount: 3,
		payloadMass: planet.defaultPayload,
		stages: planet.defaultFuel.map(function(fuel, index) {
			return { fuelMass: fuel, strength: R.constants.rocket.defaultStageStrength[index] };
		})
	};
	return shipped;
}
var limits = { maxTime: 300, maxSteps: 300 / step };

function createGame() {
	var home = R.world.pads[0];

	return {
		currentPadId: home.id,
		targetPadId: R.world.pads[1].id,
		rocket: R.rocket.create(home),
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

function flyTo(targetPadId) {
	var game = createGame();
	var peakAltitude = 0;
	var peakSpeed = 0;
	var fuelLeft = 0;
	var steps = 0;
	var dryMass;
	var shipped = resolveConfig(config);

	shipped.targetPadId = targetPadId;
	R.game = game;
	R.autopilot.setEnabled(true);
	R.autopilot.reset();
	if (!R.mission.launch(game, shipped)) {
		return { rejected: true };
	}
	dryMass = game.flight.dryMass;

	while (game.phase === 'flying' && steps < limits.maxSteps) {
		R.controls.update(game, step);
		R.physics.advance(game, step);
		peakAltitude = Math.max(peakAltitude, game.rocket.wy);
		peakSpeed = Math.max(peakSpeed, Math.hypot(game.rocket.vx, game.rocket.vy));
		if (game.phase === 'flying') {
			fuelLeft = game.rocket.stages.reduce(function(sum, stage) {
				return sum + (stage.alive ? stage.fuelMass : 0);
			}, 0);
		}
		steps += 1;
	}

	return {
		rejected: false,
		status: game.lastReport ? game.lastReport.status : 'timeout(' + R.autopilot.label() + ')',
		seconds: game.flight ? game.flight.elapsed : steps * step,
		fuelLeft: fuelLeft,
		peakAltitude: peakAltitude,
		peakSpeed: peakSpeed,
		dryMass: dryMass,
		finalWx: game.rocket.wx
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
		text = text + ' ';
	}
	return text;
}

R.world.initialize(planetId);
planet = R.world.planet;
config = configs[configIndex] || configs[0];
if (config.fromPlanet) {
	console.log('(planet default build: payload ' + planet.defaultPayload + ' kg, stages ' + planet.defaultFuel.join('/') + ' kg)');
}
console.log('=== ' + planet.name + ' · ' + config.label + ' · C ' + Math.round(planet.circumference / 100) / 10 +
	' km · g ' + planet.surfaceGravity + ' m/s² · ' + planet.seaLevelDensity + ' kg/m³ ===');
console.log(padRight('route', 22) + padLeft('km', 6) + padLeft('result', 10) + padLeft('time', 8) + padLeft('peak alt', 10) + padLeft('peak v', 9) + padLeft('dry mass', 10) + padLeft('fuel left', 10));

R.world.pads.forEach(function(padEntry, index) {
	var result;
	var label;
	var previousId;

	if (index === 0) {
		return;
	}
	previousId = R.world.pads[0].id;
	label = R.world.pads[0].name + ' → ' + padEntry.name;
	result = flyTo(padEntry.id);
	R.world.currentPadId = previousId;
	if (result.rejected) {
		console.log(padRight(label, 22) + padLeft('—', 6) + padLeft('rejected', 10));
		return;
	}
	rows.push(result.seconds);
	console.log(
		padRight(label, 22) +
		padLeft(Math.round(Math.abs(R.util.wrapDelta(padEntry.wx - R.world.pads[0].wx, planet.circumference)) / 100) / 10, 6) +
		padLeft(result.status, 10) +
		padLeft(result.seconds.toFixed(1) + 's', 8) +
		padLeft(Math.round(result.peakAltitude) + 'm', 10) +
		padLeft(Math.round(result.peakSpeed) + 'm/s', 9) +
		padLeft(Math.round(result.dryMass) + 'kg', 10) +
		padLeft(result.fuelLeft.toFixed(1) + 'kg', 10)
	);
});

if (rows.length) {
	rows.sort(function(a, b) {
		return a - b;
	});
	console.log('flight time: min ' + rows[0].toFixed(1) + 's · median ' + rows[Math.floor(rows.length / 2)].toFixed(1) + 's · max ' + rows[rows.length - 1].toFixed(1) + 's');
}
