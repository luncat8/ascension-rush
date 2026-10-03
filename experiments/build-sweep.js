'use strict';

// Randomised regression sweep for the autopilot's envelope limits. Random
// launchable builds (stage count, fuel, strength, payload), routes, frame
// rates and time scales are each flown three times: with the planet's limits
// off, and with every autopilot profile. A flight is a regression when it
// delivers without limits and fails with them, and a fix in the other case.
// Usage: node experiments/build-sweep.js [buildsPerPlanet] [seed]

var harness = require('./harness.js');

var R = harness.R;
var settings = R.constants.rocket;
var buildsPerPlanet = Number(process.argv[2] || 100);
var seed = Number(process.argv[3] || 1);
var frameRates = [30, 60, 144];
var timeScales = [0.5, 1, 2, 4];
var planetIds = ['verdant', 'tinmoon', 'cinder', 'gossamer'];
var variants = ['off'].concat(R.constants.autopilotProfiles.map(function(profile) {
	return profile.id;
}));
var stats = R.rocket.createStats();
var totals = {};
var regressions = [];
var fixes = {};

// Small seeded generator, so a failing sweep can be replayed exactly.
function random() {
	seed = (seed * 1664525 + 1013904223) % 4294967296;
	return seed / 4294967296;
}

function pick(list) {
	return list[Math.floor(random() * list.length)];
}

// A random build the launch gate accepts, or null.
function randomBuild() {
	var build = { stageCount: 1 + Math.floor(random() * 3), payloadMass: 0, stages: [] };
	var i;

	for (i = 0; i < 3; i += 1) {
		build.stages.push({
			fuelMass: Math.round((settings.minFuelMass + random() * (settings.maxFuelMass - settings.minFuelMass)) / 10) * 10,
			strength: 0.5 + Math.round(random() * 10) / 20
		});
	}
	R.rocket.evaluateBuild(build, stats);
	build.payloadMass = Math.floor(random() * Math.min(stats.payloadLimit, 400) / 10) * 10;
	R.rocket.evaluateBuild(build, stats);
	return stats.twr < settings.minimumLaunchTwr ? null : build;
}

function describe(planet, sourcePad, targetPad, build, frames, scale) {
	return planet.id + ' ' + sourcePad.name + '>' + targetPad.name + ' stages ' + build.stages.slice(0, build.stageCount).map(function(stage) {
		return stage.fuelMass;
	}).join('/') + ' kg, payload ' + build.payloadMass + ' kg, ' + frames + ' fps x' + scale;
}

function flyVariant(variant, sourcePad, targetPad, build, frames, scale) {
	var limits = variant === 'off' ? {} : R.world.planet.flight;
	var shipped = Object.assign({ targetPadId: targetPad.id }, JSON.parse(JSON.stringify(build)));

	return harness.withLimits(limits, function() {
		var game = harness.launch(sourcePad, targetPad.id, shipped, variant === 'off' ? variants[1] : variant, scale);

		return harness.fly(game, 1 / frames);
	});
}

variants.forEach(function(variant) {
	totals[variant] = { delivered: 0, flights: 0, seconds: 0, pressure: 0, acceleration: 0 };
	fixes[variant] = 0;
});

planetIds.forEach(function(planetId) {
	var planet;
	var pads;
	var counts = {};
	var done = 0;
	var tries = 0;

	R.world.initialize(planetId);
	planet = R.world.planet;
	pads = R.world.pads;
	variants.forEach(function(variant) {
		counts[variant] = 0;
	});
	while (done < buildsPerPlanet && tries < buildsPerPlanet * 50) {
		tries += 1;
		(function() {
			var build = randomBuild();
			var sourcePad = pick(pads);
			var targetPad = pick(pads);
			var frames = pick(frameRates);
			var scale = pick(timeScales);
			var results = {};

			if (!build || sourcePad === targetPad) {
				return;
			}
			variants.forEach(function(variant) {
				results[variant] = flyVariant(variant, sourcePad, targetPad, build, frames, scale);
			});
			done += 1;
			variants.forEach(function(variant) {
				var result = results[variant];
				var delivered = result.status === 'delivered';

				totals[variant].flights += 1;
				counts[variant] += delivered ? 1 : 0;
				if (delivered) {
					totals[variant].delivered += 1;
					totals[variant].seconds += result.seconds;
					totals[variant].pressure += result.flight.peakDynamicPressure;
					totals[variant].acceleration += result.flight.peakAppliedThrustAcceleration;
				}
				if (variant === 'off') {
					return;
				}
				fixes[variant] += delivered && results.off.status !== 'delivered' ? 1 : 0;
				if (!delivered && results.off.status === 'delivered') {
					regressions.push(variant + ': ' + describe(planet, sourcePad, targetPad, build, frames, scale) + ' (' + result.status + ')');
				}
			});
		}());
	}
	console.log(planet.name.padEnd(9) + variants.map(function(variant) {
		return variant + ' ' + counts[variant] + '/' + done;
	}).join('   '));
});

console.log('--- totals (delivered flights only for the means)');
variants.forEach(function(variant) {
	var total = totals[variant];
	var delivered = Math.max(1, total.delivered);

	console.log(variant.padEnd(9) + total.delivered + '/' + total.flights + ' delivered · mean ' + (total.seconds / delivered).toFixed(1) +
		' s · mean peak Q ' + (total.pressure / delivered / 1000).toFixed(1) + ' kPa · mean applied acceleration ' + (total.acceleration / delivered).toFixed(1) + ' m/s²' +
		(variant === 'off' ? '' : ' · fixed ' + fixes[variant] + ' flights that crash without limits'));
});
console.log('regressions (deliver without limits, fail with them): ' + regressions.length);
regressions.forEach(function(line) {
	console.log('  ' + line);
});
