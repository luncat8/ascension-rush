'use strict';

// Coast-impact accuracy report: the shipped predictor against a
// high-resolution engine-off rollout of the same integrator, over states taken
// from real flights and over a synthetic grid (vacuum, zero speed, dense air,
// high altitude). Also times a prediction, because it runs once per frame.
// Usage: node experiments/impact-accuracy.js [samplesPerRoute] [seed] [stepHz]
// stepHz overrides the prediction step (the shipped value is the live fixed
// step, 120), which is how the step choice itself was measured.

var harness = require('./harness.js');

var R = harness.R;
var trajectory = R.trajectory;
var samplesPerRoute = Number(process.argv[2] || 12);
var seed = Number(process.argv[3] || 7);
var stepHz = Number(process.argv[4] || 1 / R.constants.rocket.fixedStep);
var planetIds = ['verdant', 'tinmoon', 'cinder', 'gossamer'];
var profiles = R.constants.autopilotProfiles.map(function(profile) {
	return profile.id;
});
trajectory.coastStep = 1 / stepHz;
trajectory.maxCoastSteps = Math.ceil(trajectory.coastHorizon / trajectory.coastStep);
// Reference rollout: 24x finer than the shipped prediction step, which is the
// live fixed step, so its own discretisation error is a fraction of a metre.
var referenceStep = trajectory.coastStep / 24;
var referenceSteps = Math.ceil(trajectory.coastHorizon / referenceStep);
var toleranceFraction = 0.01;
var toleranceMetres = 25;
var predicted = { wx: 0, vx: 0, vy: 0, seconds: 0, steps: 0, valid: false };
var reference = { wx: 0, vx: 0, vy: 0, seconds: 0, steps: 0, valid: false };

function random() {
	seed = (seed * 1664525 + 1013904223) % 4294967296;
	return seed / 4294967296;
}

// A coast state: the rollout only reads the position, the velocity, the heading
// and the mass, so the sample carries its mass as payload and no stages.
function sampleState(wx, wy, vx, vy, heading, mass) {
	return { wx: wx, wy: wy, vx: vx, vy: vy, heading: heading, payloadMass: mass, stageCount: 0, stages: [] };
}

// States the marker is really shown for: points along flown reference routes.
function flightSamples(planetId, profileId) {
	var planet = R.planets.findById(planetId);
	var states = [];
	var frameDt = R.constants.rocket.fixedStep;
	var interval = Math.max(1, Math.round(4800 / samplesPerRoute));
	var tick = 0;
	var game;
	var rocket;
	var mass;
	var padIndex;

	R.world.initialize(planetId);
	for (padIndex = 1; padIndex < planet.pads.length; padIndex += 1) {
		game = harness.launch(R.world.pads[0], R.world.pads[padIndex].id,
			harness.referenceBuild(planet, R.world.pads[padIndex].id), profileId, 1);
		if (!game) {
			continue;
		}
		tick = 0;
		while (game.phase === 'flying' && game.flight.elapsed < harness.maxSeconds) {
			R.controls.update(game, frameDt);
			R.physics.advance(game, frameDt);
			tick += 1;
			rocket = game.rocket;
			if (game.phase === 'flying' && rocket.wy > 5 && tick % interval === 0) {
				mass = R.rocket.totalMass(rocket);
				states.push(sampleState(rocket.wx, rocket.wy, rocket.vx, rocket.vy, rocket.heading, mass));
			}
		}
	}
	return states;
}

// States the routes never reach: the edges a player can fly into by hand.
function gridSamples(planetId) {
	var planet = R.planets.findById(planetId);
	var altitudes = [20, 150, 900, 3000, Math.min(9000, planet.maxAltitude * 0.6)];
	var speeds = [0, 25, 140, 420];
	var headings = [-1.4, 0, 0.9, Math.PI];
	var verticals = [-0.6, 0, 0.7];
	var states = [];
	var mass = 900;
	var i;
	var j;
	var k;
	var l;
	var speed;
	var heading;

	for (i = 0; i < altitudes.length; i += 1) {
		for (j = 0; j < speeds.length; j += 1) {
			for (k = 0; k < headings.length; k += 1) {
				for (l = 0; l < verticals.length; l += 1) {
					speed = speeds[j];
					heading = headings[k];
					states.push(sampleState(
						planet.circumference * 0.25 * (i + 1),
						altitudes[i],
						Math.sin(heading) * speed * Math.cos(verticals[l] * 1.2),
						Math.sin(verticals[l] * 1.2) * speed,
						heading,
						mass
					));
				}
			}
		}
	}
	return states;
}

function compare(states, planetId, label, report) {
	var planet = R.world.planet;
	var worstError = 0;
	var worstFraction = 0;
	var worstState = null;
	var overTolerance = 0;
	var beyondHorizon = 0;
	var longest = 0;
	var range;
	var error;
	var i;

	for (i = 0; i < states.length; i += 1) {
		trajectory.predictCoast(states[i], predicted);
		trajectory.rollout(states[i], referenceStep, referenceSteps, reference);
		if (predicted.valid !== reference.valid) {
			// One found the ground and the other ran out of horizon: only a
			// near-horizon coast can do that, and it is reported, not scored.
			beyondHorizon += 1;
			continue;
		}
		if (!predicted.valid) {
			beyondHorizon += 1;
			continue;
		}
		range = Math.abs(R.util.wrapDelta(predicted.wx - states[i].wx, planet.circumference));
		error = Math.abs(R.util.wrapDelta(predicted.wx - reference.wx, planet.circumference));
		longest = Math.max(longest, reference.seconds);
		if (error > worstError) {
			worstError = error;
			worstState = states[i];
		}
		worstFraction = Math.max(worstFraction, error / Math.max(1, range));
		if (error > Math.max(toleranceMetres, toleranceFraction * range)) {
			overTolerance += 1;
		}
	}
	report.push({
		planetId: planetId,
		label: label,
		states: states.length,
		scored: states.length - beyondHorizon,
		beyondHorizon: beyondHorizon,
		worstError: worstError,
		worstFraction: worstFraction,
		overTolerance: overTolerance,
		longest: longest,
		worstState: worstState
	});
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

function timePredictions(states) {
	var start = process.hrtime.bigint();
	var runs = 20;
	var i;
	var j;

	for (j = 0; j < runs; j += 1) {
		for (i = 0; i < states.length; i += 1) {
			trajectory.predictCoast(states[i], predicted);
		}
	}
	return Number(process.hrtime.bigint() - start) / 1000 / (runs * states.length);
}

var report = [];
var worstOverall = 0;
var worstFractionOverall = 0;
var overTotal = 0;
var scoredTotal = 0;
var costWorst = 0;

console.log('=== Coast-impact accuracy: prediction step 1/' + Math.round(1 / trajectory.coastStep) +
	' s, horizon ' + trajectory.coastHorizon + ' s, reference step 1/' + Math.round(1 / referenceStep) +
	' s, tolerance max(' + toleranceMetres + ' m, ' + toleranceFraction * 100 + '% of range) ===');
console.log(padRight('world', 10) + padRight('states', 22) + padLeft('scored', 8) + padLeft('no ground', 11) +
	padLeft('worst m', 9) + padLeft('worst %', 9) + padLeft('over tol', 10) + padLeft('longest', 9) + padLeft('µs/call', 9));

planetIds.forEach(function(planetId) {
	R.world.initialize(planetId);
	var flown = [];
	var grid = gridSamples(planetId);
	var cost;

	profiles.forEach(function(profileId) {
		flightSamples(planetId, profileId).forEach(function(state) {
			flown.push(state);
		});
	});
	compare(flown, planetId, 'flown routes', report);
	compare(grid, planetId, 'edge grid', report);
	cost = [timePredictions(flown), timePredictions(grid)];
	report.slice(-2).forEach(function(row, index) {
		console.log(padRight(row.planetId, 10) + padRight(row.label, 22) + padLeft(row.scored, 8) + padLeft(row.beyondHorizon, 11) +
			padLeft(row.worstError.toFixed(1), 9) + padLeft((row.worstFraction * 100).toFixed(2), 9) + padLeft(row.overTolerance, 10) +
			padLeft(row.longest.toFixed(1) + 's', 9) + padLeft(cost[index].toFixed(0), 9));
		worstOverall = Math.max(worstOverall, row.worstError);
		worstFractionOverall = Math.max(worstFractionOverall, row.worstFraction);
		overTotal += row.overTolerance;
		scoredTotal += row.scored;
		costWorst = Math.max(costWorst, cost[index]);
	});
});

console.log('scored ' + scoredTotal + ' states · worst range error ' + worstOverall.toFixed(1) + ' m (' +
	(worstFractionOverall * 100).toFixed(2) + '% of range) · over tolerance ' + overTotal +
	' · slowest prediction ' + costWorst.toFixed(1) + ' µs');
