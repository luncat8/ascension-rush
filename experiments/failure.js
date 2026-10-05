'use strict';

// Failure Monte Carlo (0.5.1): what the damage model does to a hop.
//
// Every leg is the real thing — the operations dispatch, the autopilot and the
// physics, flown with damage on — because the model is tuned against the
// failure rates it produces, not against the constants it is written from.
//
//   node experiments/failure.js [legsPerBucket] [seed]
//
// Two tables. The first flies a fresh stack one hop: how often something
// breaks on a build of this strength, and what it costs to put right. The
// second flies the same hop with an engine near the end of its rated burn
// time, which is the other way a stack becomes dangerous.

var harness = require('./harness.js');
var R = harness.R;
var settings = R.constants;
var worlds = ['verdant', 'tinmoon', 'cinder', 'gossamer'];
var strengths = [1, 0.85, 0.75, 0.5];
var legsPerBucket = Number(process.argv[2] || 120);
var baseSeed = Number(process.argv[3] || settings.damage.seed);
var frameDt = 1 / 120;
var timeScale = 1;
var profileId = R.constants.autopilotProfiles[0].id;

// Damage is the subject here, so it is on: the harness switches it off for
// every other measurement.
R.damage.enabled = true;

var flags = R.damage.flags;
var modeFlags = [flags.DEGRADED, flags.ENGINE_OUT, flags.LEAK, flags.FAIRING, flags.RUPTURE];

function seedFor(bucket, leg) {
	return (baseSeed + bucket * 7919 + leg * 104729) >>> 0;
}

function padLeft(value, width) {
	var text = String(value);

	while (text.length < width) {
		text = ' ' + text;
	}
	return text;
}

function padRight(text, width) {
	while (text.length < width) {
		text += ' ';
	}
	return text;
}

function percent(fraction, width) {
	return padLeft((100 * fraction).toFixed(1), width === undefined ? 6 : width);
}

// The planet's reference build with every stage built to `strength`. A skimpy
// stage is lighter, so it flies faster on the same fuel: the model has to be
// tuned against the flight it actually produces, not the one it was designed
// for.
function buildFor(strength) {
	var planet = R.world.planet;

	return {
		stageCount: planet.defaultFuel.length,
		payloadMass: planet.defaultPayload,
		stages: planet.defaultFuel.map(function(fuel) {
			return { fuelMass: fuel, strength: strength, engineId: null, tankId: null, fairingId: null };
		})
	};
}

function countFlag(legs, flag) {
	var count = 0;
	var i;

	for (i = 0; i < legs.length; i += 1) {
		count += legs[i].failures & flag ? 1 : 0;
	}
	return count;
}

function mean(values) {
	var total = 0;
	var i;

	for (i = 0; i < values.length; i += 1) {
		total += values[i];
	}
	return values.length ? total / values.length : 0;
}

// One leg, dispatched and flown like a player's. `worn` puts the engines near
// the end of their rated burn time before the leg.
function flyLeg(bucket, leg, strength, worn) {
	var planet = R.world.planet;
	var source = R.world.pads[0];
	var target = R.world.pads[2];
	var build = buildFor(strength);
	var game = harness.createGame(source, target.id, timeScale, settings.economy.startingCash);
	var order;
	var entry;
	var type;
	var rocket;
	var stress;
	var i;

	R.game = game;
	R.operations.initialize();
	R.market.initialize(seedFor(bucket, leg));
	R.operations.state.types.length = 0;
	R.operations.state.fleet.length = 0;
	type = R.operations.addType({
		name: 'failure',
		stageCount: build.stageCount,
		stages: build.stages,
		nominalPayload: build.payloadMass,
		defaultProfileId: profileId
	});
	rocket = R.operations.createRocket(type, source);
	if (worn) {
		for (i = 0; i < type.stageCount; i += 1) {
			rocket.stageState[i].engineBurnTimeUsed = settings.damage.wearStart *
				R.parts.engine(type.stages[i].engineId).maxThrottleSeconds +
				(1 - settings.damage.wearStart) * R.parts.engine(type.stages[i].engineId).maxThrottleSeconds * 0.5;
			rocket.stageState[i].lifeFlights = Math.floor(R.parts.tank(type.stages[i].tankId).maxFlights / 2);
		}
	}
	// A pad's appetite caps a leg's cargo in the game; this measures the build
	// it was handed, so the gate is widened for the launch.
	planet.defaultPayload = build.payloadMass;
	order = R.operations.dispatch({
		source: source.id,
		destination: target.id,
		mode: 'oneway',
		fuelPolicy: 'refuel',
		outboundPayload: build.payloadMass,
		returnPayload: 0,
		typeId: type.id,
		profileId: profileId,
		overhaul: true
	});
	if (!order.ok) {
		return { status: 'refused', failures: 0, stress: 0, repair: 0, cargo: 1 };
	}
	planet.defaultPayload = build.payloadMass;
	// The seed is the experiment's: the same bucket and leg roll the same
	// failures, so a rate change can be measured against the run before it.
	R.damage.reset(seedFor(bucket, leg));
	harness.fly(game, frameDt);
	entry = R.flightLog.entries[0];
	stress = 0;
	for (i = 0; i < type.stageCount; i += 1) {
		stress += rocket.stageState[i].alive ? rocket.stageState[i].stress : 0;
	}
	return {
		status: entry.status,
		failures: entry.failures,
		cause: entry.cause,
		// The damage the leg left on the stack it came down with, which is the
		// repair bill the next dispatch pays. A stack that crashed is written
		// off, so it is replaced rather than repaired.
		stress: type.stageCount ? stress / type.stageCount : 0,
		repair: entry.status === 'crashed' ? 0 :
			R.parts.repairValue(type, rocket.stageState, true) * R.economy.priceSteel(entry.landingPadId || entry.departedPadId),
		cargo: 1 - entry.payloadDamage
	};
}

function runBucket(bucket, strength, worn) {
	var legs = [];
	var leg;

	for (leg = 0; leg < legsPerBucket; leg += 1) {
		legs.push(flyLeg(bucket, leg, strength, worn));
	}
	return legs;
}

function reportRow(label, legs) {
	var flown = 0;
	var failed = 0;
	var crashed = 0;
	var stress = 0;
	var repair = 0;
	var cargo = 0;
	var i;

	for (i = 0; i < legs.length; i += 1) {
		if (legs[i].status === 'refused') {
			continue;
		}
		flown += 1;
		failed += legs[i].failures ? 1 : 0;
		crashed += legs[i].status === 'crashed' ? 1 : 0;
		stress += legs[i].stress;
		repair += legs[i].repair;
		cargo += legs[i].cargo;
	}
	if (!flown) {
		return label + '  (no legs flew)';
	}
	return padRight(label, 26) + percent(failed / flown) +
		percent(countFlag(legs, flags.DEGRADED) / flown) +
		percent(countFlag(legs, flags.ENGINE_OUT) / flown) +
		percent(countFlag(legs, flags.LEAK) / flown) +
		percent(countFlag(legs, flags.RUPTURE) / flown) +
		percent(crashed / flown) +
		padLeft((stress / flown).toFixed(3), 8) +
		padLeft('$' + (repair / flown).toFixed(0), 8) +
		percent(1 - cargo / flown, 7);
}

function header() {
	return padRight('world · stage strength', 26) + padLeft('fail%', 6) + padLeft('degr', 6) +
		padLeft('out', 6) + padLeft('leak', 6) + padLeft('rud', 6) + padLeft('crash', 6) +
		padLeft('stress', 8) + padLeft('repair', 8) + padLeft('cargo%', 7);
}

function report(worn) {
	var bucket = 0;
	var w;
	var s;
	var legs;

	console.log('');
	console.log('--- ' + (worn ? 'worn stack: engines at 90 % of their rated burn time' : 'fresh stack') +
		' · ' + legsPerBucket + ' legs per row · seed ' + baseSeed);
	console.log(header());
	for (w = 0; w < worlds.length; w += 1) {
		R.world.initialize(worlds[w]);
		for (s = 0; s < strengths.length; s += 1) {
			legs = runBucket(bucket, strengths[s], worn);
			console.log(reportRow(worlds[w] + ' · strength ' + strengths[s].toFixed(2), legs));
			bucket += 1;
		}
	}
}

console.log('failure Monte Carlo · ' + legsPerBucket + ' legs per bucket · seed ' + baseSeed +
	' · profile ' + profileId + ' · damage ' + (R.damage.enabled ? 'on' : 'off'));
console.log('# failureRate ' + settings.damage.failureRate + ' · exponent ' + settings.damage.failureExponent +
	' · stressRate ' + settings.damage.stressRate + ' · structureMargin ' + settings.damage.structureMargin +
	' · scrap ' + settings.damage.scrapStress);
report(false);
report(true);
console.log('');
console.log('# fail% is a leg with any failure; degr/out/leak/rud are the modes; stress is the');
console.log('# damage the leg left on the stages it came down with; repair is what the next');
console.log('# dispatch pays for it; cargo% is the share of the load that did not arrive.');
