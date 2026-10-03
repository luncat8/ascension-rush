'use strict';

// Flight envelope report: real autopilot commands and real physics on every
// directed pad-to-pad route.
// Usage: node experiments/envelope.js [planetId] [configIndex] [profileId|off] [fps] [timeScale]
// `off` flies without the planet's envelope limits, for comparison.
// The default flies one control update per fixed physics step; fps and
// timeScale fly the same routes in the frame loop's order instead (one control
// update per frame, then the frame's physics budget).

var harness = require('./harness.js');

var R = harness.R;
var configs = [
	{
		label: 'planet reference',
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
var profileId = process.argv[4] || R.constants.autopilotProfiles[0].id;
var limitsOff = profileId === 'off';
var frameDt = 1 / Number(process.argv[5] || 1 / step);
var timeScale = Number(process.argv[6] || 1);
var config;
var planet;
var rows = [];

function resolveConfig(targetPadId) {
	var shipped;

	if (config.fromPlanet) {
		return harness.referenceBuild(planet, targetPadId);
	}
	shipped = JSON.parse(JSON.stringify(config));
	shipped.targetPadId = targetPadId;
	return shipped;
}

function flyTo(sourcePad, targetPad) {
	var game = harness.launch(sourcePad, targetPad.id, resolveConfig(targetPad.id), limitsOff ? R.constants.autopilotProfiles[0].id : profileId, timeScale);
	var result;

	if (!game) {
		return { rejected: true };
	}
	result = harness.fly(game, frameDt);
	result.rejected = false;
	result.dryMass = result.flight.dryMass;
	return result;
}

function fly(sourcePad, targetPad) {
	// `off` holds the envelope limits back, not the staging authority: that is
	// guidance behaviour, and the routes are compared with it in force.
	return limitsOff ? harness.withLimits({ stageOnAuthority: true }, function() {
		return flyTo(sourcePad, targetPad);
	}) : flyTo(sourcePad, targetPad);
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
console.log('=== ' + planet.name + ' · ' + config.label + ' · ' + (limitsOff ? 'limits off' : profileId + ' profile') + ' · C ' + Math.round(planet.circumference / 100) / 10 +
	' km · g ' + planet.surfaceGravity + ' m/s² · ' + planet.seaLevelDensity + ' kg/m³ · ' + Math.round(1 / frameDt) + ' fps x' + timeScale + ' ===');
console.log(padRight('directed route', 25) + padLeft('km', 6) + padLeft('result', 10) + padLeft('time', 8) + padLeft('peak alt', 10) + padLeft('peak v', 9) + padLeft('dry mass', 10) + padLeft('peak Q', 11) + padLeft('Q alt', 9) + padLeft('AoA@Qpk', 10) + padLeft('AoAmax/Q', 14) + padLeft('peak T/m', 10) + padLeft('applied', 9) + padLeft('limit s Q/A/α', 16) + padLeft('touchdown V/H', 15) + padLeft('pad error', 11) + padLeft('fuel left', 11));

R.world.pads.forEach(function(sourcePad) {
	R.world.pads.forEach(function(targetPad) {
		var result;
		var label;
		var distance;
		var flight;

		if (sourcePad.id === targetPad.id) {
			return;
		}
		label = sourcePad.name + ' → ' + targetPad.name;
		result = fly(sourcePad, targetPad);
		if (result.rejected) {
			console.log(padRight(label, 25) + padLeft('—', 6) + padLeft('rejected', 10));
			return;
		}
		flight = result.flight;
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
			padLeft((flight.peakDynamicPressure / 1000).toFixed(1) + 'kPa', 11) +
			padLeft(Math.round(flight.peakDynamicPressureAltitude) + 'm', 9) +
			padLeft(planet.seaLevelDensity > 0 ? (flight.peakDynamicPressureAngleOfAttack * 180 / Math.PI).toFixed(1) + '°' : 'n/a', 10) +
			padLeft(planet.seaLevelDensity > 0 ? (flight.peakAngleOfAttack * 180 / Math.PI).toFixed(1) + '/' + (flight.peakAngleOfAttackDynamicPressure / 1000).toFixed(1) : 'n/a', 14) +
			padLeft(flight.peakThrustAcceleration.toFixed(1), 10) +
			padLeft(flight.peakAppliedThrustAcceleration.toFixed(1), 9) +
			padLeft(result.limiterSeconds.Q.toFixed(1) + '/' + result.limiterSeconds.ACCEL.toFixed(1) + '/' + result.limiterSeconds.AOA.toFixed(1), 16) +
			padLeft(result.report ? result.report.touchdownVerticalSpeed.toFixed(1) + '/' + result.report.touchdownHorizontalSpeed.toFixed(1) : 'n/a', 15) +
			padLeft(result.report ? Math.round(result.report.targetError) + 'm' : 'n/a', 11) +
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
	var peakAppliedAcceleration = 0;
	var worstReclimb = 0;
	var mostFlips = 0;
	var worstSink = 0;
	var worstPadError = 0;
	var i;

	for (i = 0; i < rows.length; i += 1) {
		delivered += rows[i].status === 'delivered' ? 1 : 0;
		if (rows[i].flight.peakDynamicPressure > peakQ) {
			peakQ = rows[i].flight.peakDynamicPressure;
			peakQAoA = rows[i].flight.peakDynamicPressureAngleOfAttack;
		}
		if (rows[i].flight.peakAngleOfAttack > peakAoA) {
			peakAoA = rows[i].flight.peakAngleOfAttack;
			peakAoAQ = rows[i].flight.peakAngleOfAttackDynamicPressure;
		}
		peakThrustAcceleration = Math.max(peakThrustAcceleration, rows[i].flight.peakThrustAcceleration);
		peakAppliedAcceleration = Math.max(peakAppliedAcceleration, rows[i].flight.peakAppliedThrustAcceleration);
		worstReclimb = Math.max(worstReclimb, rows[i].reclimb);
		mostFlips = Math.max(mostFlips, rows[i].sideFlips);
		if (rows[i].report) {
			worstSink = Math.max(worstSink, Math.abs(rows[i].report.touchdownVerticalSpeed));
			worstPadError = Math.max(worstPadError, Math.abs(rows[i].report.targetError));
		}
	}
	console.log('routes delivered: ' + delivered + '/' + rows.length +
		' · envelope maxima: Q ' + (peakQ / 1000).toFixed(1) + ' kPa at AoA ' +
		(planet.seaLevelDensity > 0 ? (peakQAoA * 180 / Math.PI).toFixed(1) + '°' : 'n/a') + ' · max AoA ' +
		(planet.seaLevelDensity > 0 ? (peakAoA * 180 / Math.PI).toFixed(1) + '° at Q ' + (peakAoAQ / 1000).toFixed(1) + ' kPa' : 'n/a') +
		' · thrust acceleration ' + peakAppliedAcceleration.toFixed(1) + ' applied / ' + peakThrustAcceleration.toFixed(1) + ' available m/s²' +
		' · worst re-climb ' + Math.round(worstReclimb) + ' m · most axis flips ' + mostFlips +
		' · worst touchdown ' + worstSink.toFixed(1) + ' m/s down, ' + Math.round(worstPadError) + ' m off the pad');
}
