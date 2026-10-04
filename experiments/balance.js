'use strict';

// Balance Monte Carlo: the real operations dispatch, the real autopilot and the
// real physics, flown over seeded price paths. One bucket per world × distance
// bracket × stage count × payload percent; each bucket is a repeating
// pad-to-pad chain on one fleet instance, so wear, market drift and cash all
// accumulate the way a session does. A crashed rocket is rebuilt and the
// service goes on, the way a player does it, until the cash cannot buy another.
//
// Margin is the leg's own cash flow over its revenue — what the deck quotes and
// the log records: fuel and structure charged at the pad the leg leaves from,
// the overhaul a standing service buys, the autopilot fee. An overbuild's sin
// (buying fuel it never burns) is therefore visible in the number, and a leg
// that flies on the previous leg's leftover fuel is visibly cheaper.
//
// Usage: node experiments/balance.js [baseSeed] [legsPerBucket] [repetitions]

var harness = require('./harness.js');

var R = harness.R;
var market = R.market;
var settings = R.constants;
var baseSeed = Number(process.argv[2] || 20261004);
var legsPerBucket = Number(process.argv[3] || 6);
var repetitions = Number(process.argv[4] || 2);
var frameDt = 1 / 120;
var timeScale = 4;
var profileId = settings.autopilotProfiles[0].id;
var stageCounts = [1, 2, 3];
var payloadPercents = settings.market.payloadLadder;
var buckets = [];
var index = 0;

// A bucket's seed is mixed from the base seed, the bucket and the repetition,
// so one command line reproduces a whole report and a different base seed is a
// different set of price paths over the same flights.
function mix(a, b, c) {
	var value = (a ^ Math.imul(b + 1, 2654435761) ^ Math.imul(c + 1, 40503)) >>> 0;

	value = Math.imul(value ^ (value >>> 13), 1274126177) >>> 0;
	return (value ^ (value >>> 16)) >>> 0;
}

function padDistance(from, to) {
	return Math.abs(R.util.wrapDelta(to.wx - from.wx, R.world.planet.circumference));
}

// The chain's other end: the nearest neighbour pad, or the farthest one, so a
// bracket is a hop length rather than a named pad.
function bracketTarget(source, far) {
	var pads = R.world.pads;
	var best = null;
	var bestDistance = far ? -1 : Infinity;
	var distance;
	var i;

	for (i = 0; i < pads.length; i += 1) {
		if (pads[i].id === source.id) {
			continue;
		}
		distance = padDistance(source, pads[i]);
		if (far ? distance > bestDistance : distance < bestDistance) {
			best = pads[i];
			bestDistance = distance;
		}
	}
	return best;
}

// A build of `stageCount` stages: the planet's reference stages, kept only as
// many as the count asks for, so the same design is measured lean and full.
function buildFor(stageCount, payloadPercent) {
	var planet = R.world.planet;
	var stages = planet.defaultFuel.slice(0, stageCount).map(function(fuel, position) {
		return {
			fuelMass: fuel,
			strength: settings.rocket.defaultStageStrength[position],
			engineId: null,
			tankId: null,
			fairingId: null
		};
	});

	return {
		stageCount: stageCount,
		payloadMass: Math.max(10, Math.round(payloadPercent * planet.defaultPayload / 10) * 10),
		stages: stages
	};
}

// Flies one bucket repetition and returns its legs. A refused dispatch ends the
// chain with the reason recorded: that is the bucket telling the player it
// cannot afford the next leg, or that the build cannot lift the payload.
function runChain(bucket, seed) {
	var source = R.world.pads[0];
	var target = bracketTarget(source, bucket.far);
	var build = buildFor(bucket.stageCount, bucket.payloadPercent);
	var game = harness.createGame(source, target.id, timeScale, settings.economy.startingCash);
	var legs = [];
	var from = source;
	var to = target;
	var order;
	var entry;
	var type;
	var leg;

	R.game = game;
	R.operations.initialize();
	market.initialize(seed);
	R.operations.state.types.length = 0;
	R.operations.state.fleet.length = 0;
	type = R.operations.addType({
		name: 'balance',
		stageCount: build.stageCount,
		stages: build.stages,
		nominalPayload: build.payloadMass,
		defaultProfileId: profileId
	});
	R.operations.createRocket(type, source);

	for (leg = 0; leg < legsPerBucket; leg += 1) {
		order = R.operations.dispatch({
			source: from.id,
			destination: to.id,
			mode: 'oneway',
			fuelPolicy: 'refuel',
			outboundPayload: build.payloadMass,
			returnPayload: 0,
			typeId: type.id,
			profileId: profileId,
			// A standing service budgets its own maintenance instead of
			// stalling on the pad: the wear is in the number, not in a refusal.
			overhaul: true
		});
		if (!order.ok) {
			legs.push({ status: 'refused', reason: order.reason, cashDelta: 0, revenue: 0, cash: game.cash, granted: false });
			break;
		}
		harness.fly(game, frameDt);
		// The log is newest first: the leg that just finished is entries[0].
		entry = R.flightLog.entries[0];
		legs.push({
			status: entry.status,
			reason: '',
			cashDelta: entry.cashDelta,
			revenue: entry.revenue,
			cash: game.cash,
			// The chain opens on the granted, fully fuelled rocket, so its first
			// leg buys no fuel: it is the run's bonus, not the service's steady
			// state, and the margin histogram leaves it out.
			granted: leg === 0
		});
		if (entry.status === 'crashed' && !R.operations.buildRocket(type.id, from.id).ok) {
			legs.push({ status: 'broke', reason: 'CANNOT REBUILD', cashDelta: 0, revenue: 0, cash: game.cash, granted: false });
			break;
		}
		from = R.world.findPadById(entry.landingPadId) || from;
		to = from.id === source.id ? target : source;
	}
	return legs;
}

function quantile(sorted, fraction) {
	if (!sorted.length) {
		return 0;
	}
	var position = fraction * (sorted.length - 1);
	var low = Math.floor(position);

	return low + 1 < sorted.length ?
		sorted[low] + (position - low) * (sorted[low + 1] - sorted[low]) :
		sorted[low];
}

function mean(values) {
	if (!values.length) {
		return NaN;
	}
	return values.reduce(function(sum, value) {
		return sum + value;
	}, 0) / values.length;
}

// The histogram line for a set of delivered legs: the mean, the 10th and 90th
// percentiles, and how many legs it covers.
function marginLine(margins) {
	var sorted = margins.slice().sort(function(a, b) {
		return a - b;
	});

	return margins.length ?
		'margin ' + percent(mean(margins)) + ' · p10 ' + percent(quantile(sorted, 0.1)) +
		' · p90 ' + percent(quantile(sorted, 0.9)) + ' over ' + margins.length + ' delivered legs' :
		'no legs delivered';
}

// A bucket is every leg its repetitions flew: the margin histogram over the
// delivered legs (the granted opener of each chain excluded — it buys no fuel),
// the outcomes, and the cash the chain ended on.
function summarize(legs) {
	var margins = [];
	var summary = {
		legs: legs.length,
		granted: 0,
		delivered: 0,
		landed: 0,
		crashed: 0,
		refused: '',
		cashStart: settings.economy.startingCash,
		cashMin: Infinity,
		cashFinal: 0,
		marginCount: 0,
		marginMean: 0,
		marginP10: 0,
		marginP90: 0
	};
	var i;

	for (i = 0; i < legs.length; i += 1) {
		summary.cashMin = Math.min(summary.cashMin, legs[i].cash);
		summary.cashFinal = legs[i].cash;
		if (legs[i].granted) {
			summary.granted += 1;
		}
		if (legs[i].status === 'delivered' && !legs[i].granted) {
			summary.delivered += 1;
			margins.push(legs[i].cashDelta / legs[i].revenue);
		} else if (legs[i].status === 'landed') {
			summary.landed += 1;
		} else if (legs[i].status === 'crashed') {
			summary.crashed += 1;
		} else if (legs[i].status !== 'delivered') {
			summary.refused = legs[i].reason || legs[i].status;
		}
	}
	margins.sort(function(a, b) {
		return a - b;
	});
	summary.marginCount = margins.length;
	if (margins.length) {
		summary.marginMean = mean(margins);
		summary.marginP10 = quantile(margins, 0.1);
		summary.marginP90 = quantile(margins, 0.9);
	}
	return summary;
}

function runBucket(bucket) {
	var legs = [];
	var repetition;

	for (repetition = 0; repetition < repetitions; repetition += 1) {
		legs = legs.concat(runChain(bucket, mix(baseSeed, bucket.index, repetition)));
	}
	bucket.summary = summarize(legs);
	bucket.legs = legs;
	return bucket;
}

function percent(value) {
	return (value >= 0 ? '+' : '−') + (Math.abs(value) * 100).toFixed(1) + '%';
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

function bucketRow(bucket) {
	var summary = bucket.summary;

	return padRight(bucket.stageCount + 'st', 4) +
		padLeft(bucket.payloadMass + 'kg', 8) +
		padLeft(summary.legs, 6) +
		padLeft(summary.granted, 6) +
		padLeft(summary.delivered, 7) +
		padLeft(summary.landed, 6) +
		padLeft(summary.crashed, 7) +
		padLeft(summary.refused || '—', 22) +
		padLeft(summary.marginCount ? percent(summary.marginMean) : '—', 9) +
		padLeft(summary.marginCount ? percent(summary.marginP10) : '—', 8) +
		padLeft(summary.marginCount ? percent(summary.marginP90) : '—', 8) +
		padLeft(Math.round(summary.cashMin), 9) +
		padLeft(Math.round(summary.cashFinal), 9);
}

function printWorld(world) {
	var planet = R.world.planet;
	var brackets = [
		{ far: false, label: 'near' },
		{ far: true, label: 'far' }
	];
	var source = R.world.pads[0];
	var bracket;
	var bucket;
	var i;

	console.log('=== ' + world.id + ' · C ' + Math.round(planet.circumference / 100) / 10 + ' km · g ' +
		planet.surfaceGravity + ' · prices fuel ' + planet.prices.fuel.toFixed(3) + ' steel ' +
		planet.prices.steel.toFixed(3) + ' delivery ' + planet.prices.delivery.toFixed(2) + ' · reference ' +
		planet.defaultFuel.join('/') + ' kg × ' + planet.defaultPayload + ' kg ===');
	for (i = 0; i < brackets.length; i += 1) {
		bracket = brackets[i];
		console.log('-- ' + bracket.label + ' hop · ' +
			(padDistance(source, bracketTarget(source, bracket.far)) / 1000).toFixed(1) + ' km · ' +
			source.name + ' ⇄ ' + bracketTarget(source, bracket.far).name);
		console.log(padRight('stages', 4) + padLeft('payload', 8) + padLeft('legs', 6) + padLeft('grant', 6) +
			padLeft('deliv', 7) + padLeft('land', 6) + padLeft('crash', 7) + padLeft('chain stopped by', 22) +
			padLeft('margin', 9) + padLeft('p10', 8) + padLeft('p90', 8) + padLeft('cash min', 9) +
			padLeft('cash end', 9));
		for (bucket = 0; bucket < buckets.length; bucket += 1) {
			if (buckets[bucket].world !== world.id || buckets[bucket].far !== bracket.far) {
				continue;
			}
			console.log(bucketRow(buckets[bucket]));
		}
	}
}

// The bands the plan targets, measured on Verdant's shortest hop with the
// balanced profile: the reference build is the correctly sized standing
// service, and the same design with every stage overfuelled is the overbuild.
function bandReport() {
	var near = buckets.filter(function(bucket) {
		return bucket.world === 'verdant' && !bucket.far;
	});
	var reference = null;
	var lean = {};
	var bucket;
	var i;

	for (i = 0; i < near.length; i += 1) {
		bucket = near[i];
		if (bucket.payloadPercent !== 1) {
			continue;
		}
		lean[bucket.stageCount] = bucket;
		if (bucket.stageCount === 3) {
			reference = bucket;
		}
	}
	console.log('=== bands · verdant near hop · balanced · standing service ===');
	if (reference) {
		console.log('reference build (3 stages, ' + reference.payloadMass + ' kg): margin ' +
			percent(reference.summary.marginMean) + ' over ' + reference.summary.marginCount +
			' delivered legs · target +10.0…+20.0% ' +
			(reference.summary.marginMean >= 0.1 && reference.summary.marginMean <= 0.2 ? 'PASS' : 'MISS'));
	}
	if (lean[1] && lean[2]) {
		console.log('for scale, the leaner builds on the same hop: 1 stage ' + percent(lean[1].summary.marginMean) +
			' · 2 stages ' + percent(lean[2].summary.marginMean) +
			' · the overbuild is what a bigger stack than the hop needs costs');
	}
}

// The overbuild band: the reference design with every stage overfuelled by half
// at the same payload, flown as a standing service on the shortest hop. It
// burns fuel the hop does not need, so it must not pay.
function overbuildReport() {
	var worlds = R.planets.list;
	var source;
	var target;
	var build;
	var game;
	var margins;
	var from;
	var to;
	var type;
	var order;
	var entry;
	var average;
	var world;
	var leg;
	var i;

	console.log('=== bands · overbuilt stack (reference stages ×1.5 fuel, same payload) ===');
	for (i = 0; i < worlds.length; i += 1) {
		world = worlds[i];
		R.world.initialize(world.id);
		source = R.world.pads[0];
		target = bracketTarget(source, false);
		build = buildFor(3, 1);
		game = harness.createGame(source, target.id, timeScale, settings.economy.startingCash);
		margins = [];
		from = source;
		to = target;
		R.game = game;
		R.operations.initialize();
		R.operations.state.types.length = 0;
		R.operations.state.fleet.length = 0;
		type = R.operations.addType({
			name: 'overbuild',
			stageCount: 3,
			stages: build.stages.map(function(stage) {
				return { fuelMass: stage.fuelMass * 1.5, strength: stage.strength, engineId: null, tankId: null, fairingId: null };
			}),
			nominalPayload: build.payloadMass,
			defaultProfileId: profileId
		});
		R.operations.createRocket(type, source);
		for (leg = 0; leg < legsPerBucket; leg += 1) {
			order = R.operations.dispatch({
				source: from.id,
				destination: to.id,
				mode: 'oneway',
				fuelPolicy: 'refuel',
				outboundPayload: build.payloadMass,
				returnPayload: 0,
				typeId: type.id,
				profileId: profileId,
				overhaul: true
			});
			if (!order.ok) {
				break;
			}
			harness.fly(game, frameDt);
			entry = R.flightLog.entries[0];
			if (entry.status === 'delivered' && leg > 0) {
				margins.push(entry.cashDelta / entry.revenue);
			}
			from = R.world.findPadById(entry.landingPadId) || from;
			to = from.id === source.id ? target : source;
		}
		average = mean(margins);
		console.log(world.id + ' near hop: margin ' + (margins.length ? percent(average) : '—') +
			' over ' + margins.length + ' delivered legs · target ≤ 0% ' +
			(margins.length ? (average <= 0 ? 'PASS' : 'MISS') : '—'));
	}
}

// A posted contract this rocket could fly right now: the same hop, the same
// payload, still open. The board is the market's, so the rate on it is the
// market's pricing, not a number this script made up.
function openContract(fromPadId, toPadId, payloadMass) {
	var contracts = market.state.contracts;
	var i;

	for (i = 0; i < contracts.length; i += 1) {
		if (contracts[i].status === 'open' && contracts[i].fromPadId === fromPadId &&
			contracts[i].toPadId === toPadId && contracts[i].payloadMass === payloadMass) {
			return contracts[i];
		}
	}
	return null;
}

// Flies a service on one hop for `legs` legs and books every leg that delivered
// after the granted opener, labelled by what it flew: a contract when
// `takeContracts` is set and the board has one for the hop and the payload, a
// standing service otherwise.
function flyServiceChain(type, source, target, takeContracts, legs) {
	var game = harness.createGame(source, target.id, timeScale, settings.economy.startingCash);
	var margins = { contract: [], standing: [] };
	var lost = { contract: 0, standing: 0 };
	var from = source;
	var to = target;
	var contract;
	var order;
	var entry;
	var label;
	var leg;

	R.game = game;
	R.operations.createRocket(type, source);
	for (leg = 0; leg < legs; leg += 1) {
		contract = takeContracts ? openContract(from.id, to.id, type.nominalPayload) : null;
		order = R.operations.dispatch({
			source: from.id,
			destination: to.id,
			mode: 'oneway',
			fuelPolicy: 'refuel',
			outboundPayload: type.nominalPayload,
			returnPayload: 0,
			typeId: type.id,
			profileId: profileId,
			contractId: contract ? contract.id : null,
			overhaul: true
		});
		if (!order.ok) {
			break;
		}
		harness.fly(game, frameDt);
		entry = R.flightLog.entries[0];
		label = contract ? 'contract' : 'standing';
		if (leg > 0) {
			// The granted opener is the run's bonus, not the service's steady
			// state, exactly as in the margin histogram.
			if (entry.status === 'delivered') {
				margins[label].push(entry.cashDelta / entry.revenue);
			} else {
				lost[label] += 1;
			}
		}
		if (entry.status === 'crashed' && !R.operations.buildRocket(type.id, from.id).ok) {
			break;
		}
		from = R.world.findPadById(entry.landingPadId) || from;
		to = from.id === source.id ? target : source;
	}
	return { margins: margins, lost: lost };
}

// The contract band: one chain on the verdant near hop that takes every
// contract the board posts for it and flies a standing service when the board
// has none. Both kinds of leg share the chain, so they share the market path,
// the wear and the maintenance — the only difference is the cargo. A contract's
// rate is fixed at posting with the urgency and fragility premiums already in
// it, so the same cargo pays more per kilogram, and a fragile load is lost
// whole if it lands hard.
function contractReport() {
	var source = R.world.pads[0];
	var target = bracketTarget(source, false);
	var build = buildFor(3, 1);
	var legs = legsPerBucket * 10;
	var chain;
	var type;
	var keys = ['contract', 'standing'];
	var label;
	var i;

	R.world.initialize('verdant');
	R.operations.initialize();
	market.initialize(baseSeed);
	R.operations.state.types.length = 0;
	R.operations.state.fleet.length = 0;
	type = R.operations.addType({
		name: 'contract',
		stageCount: build.stageCount,
		stages: build.stages,
		nominalPayload: build.payloadMass,
		defaultProfileId: profileId
	});
	chain = flyServiceChain(type, source, target, true, legs);
	console.log('=== bands · contract with urgency or fragile cargo vs a standing service ===');
	console.log('the reference build on the verdant near hop, ' + legs + ' legs on one chain');
	for (i = 0; i < keys.length; i += 1) {
		label = keys[i];
		console.log(label + ' legs: ' + marginLine(chain.margins[label]) + ' · ' + chain.lost[label] + ' lost');
	}
	console.log('target: a contract pays a higher margin, with a wider spread, than a standing service ' +
		(chain.margins.contract.length && chain.margins.standing.length ?
			(mean(chain.margins.contract) > mean(chain.margins.standing) ? 'PASS' : 'MISS') : '—'));
}

// The leftover-fuel band: the return leg of a route flown on what landed,
// against the same return leg refuelled. The no-refuel leg buys no fuel, so it
// must be the strictly better margin.
function leftoverFuelReport() {
	var source = R.world.pads[0];
	var target = R.world.pads[1];
	var build = buildFor(3, 1);
	var game = harness.createGame(source, target.id, timeScale, 1e8);
	var outcomes = {};
	var type;
	var order;
	var entry;
	var sent;
	var policy;

	R.game = game;
	R.operations.initialize();
	R.operations.state.types.length = 0;
	R.operations.state.fleet.length = 0;
	type = R.operations.addType({
		name: 'leftover',
		stageCount: build.stageCount,
		stages: build.stages,
		nominalPayload: build.payloadMass,
		defaultProfileId: profileId
	});
	R.operations.createRocket(type, source);

	for (policy = 0; policy < 2; policy += 1) {
		R.operations.state.fleet.length = 0;
		R.operations.createRocket(type, source);
		order = R.operations.dispatch({
			source: source.id,
			destination: target.id,
			mode: 'return',
			fuelPolicy: policy === 0 ? 'none' : 'refuel',
			outboundPayload: build.payloadMass,
			returnPayload: build.payloadMass,
			typeId: type.id,
			profileId: profileId,
			overhaul: true
		});
		if (!order.ok) {
			outcomes[policy] = { refused: order.reason };
			continue;
		}
		harness.fly(game, frameDt);
		entry = R.flightLog.entries[0];
		if (entry.status !== 'delivered') {
			outcomes[policy] = { refused: 'outbound ' + entry.status };
			continue;
		}
		sent = R.operations.sendReturnLeg();
		if (!sent.ok) {
			outcomes[policy] = { refused: 'return ' + sent.reason };
			continue;
		}
		harness.fly(game, frameDt);
		entry = R.flightLog.entries[0];
		outcomes[policy] = entry.status === 'delivered' ?
			{ margin: entry.cashDelta / entry.revenue, cashDelta: entry.cashDelta, revenue: entry.revenue } :
			{ refused: 'return ' + entry.status };
	}
	console.log('=== bands · return leg on leftover fuel vs a refuelled turnaround ===');
	if (outcomes[0].margin !== undefined && outcomes[1].margin !== undefined) {
		console.log('leftover fuel: return margin ' + percent(outcomes[0].margin) +
			' · refuelled: ' + percent(outcomes[1].margin) + ' · target: leftover strictly better ' +
			(outcomes[0].margin > outcomes[1].margin ? 'PASS' : 'MISS'));
	} else {
		console.log('leftover fuel: ' + (outcomes[0].refused || percent(outcomes[0].margin)) +
			' · refuelled: ' + (outcomes[1].refused || percent(outcomes[1].margin)));
	}
}

R.planets.list.forEach(function(world) {
	var brackets = [false, true];
	var position;

	R.world.initialize(world.id);
	for (position = 0; position < brackets.length; position += 1) {
		stageCounts.forEach(function(stageCount) {
			payloadPercents.forEach(function(payloadPercent) {
				buckets.push({
					index: index++,
					world: world.id,
					far: brackets[position],
					stageCount: stageCount,
					payloadPercent: payloadPercent,
					payloadMass: buildFor(stageCount, payloadPercent).payloadMass,
					summary: null,
					legs: null
				});
			});
		});
	}
});

console.log('balance Monte Carlo · base seed ' + baseSeed + ' · ' + legsPerBucket + ' legs × ' +
	repetitions + ' repetitions per bucket · ' + buckets.length + ' buckets · starting cash $' +
	settings.economy.startingCash + ' · overhaulFactor ' + settings.parts.overhaulFactor +
	' · distanceBonus ' + settings.market.distanceBonus + ' · padSpread ' + settings.market.padSpread);

R.planets.list.forEach(function(world) {
	var pending = buckets.filter(function(bucket) {
		return bucket.world === world.id;
	});

	// The world has to be live before its pads and prices are read.
	R.world.initialize(world.id);
	pending.forEach(runBucket);
	printWorld(world);
});

// The crash band: a leg that ends in a wreck earns nothing and costs the stack
// it flew. The ledger charges the fuel the leg loaded but not the lost
// structure — the player pays that when the rocket is replaced — so the report
// shows both, and the total is what a crash costs a run.
function crashReport() {
	var source = R.world.pads[0];
	var target = bracketTarget(source, false);
	var build = buildFor(1, 1);
	var game = harness.createGame(source, target.id, timeScale, settings.economy.startingCash);
	var type;
	var order;
	var entry;
	var replacement;

	R.game = game;
	R.operations.initialize();
	R.operations.state.types.length = 0;
	R.operations.state.fleet.length = 0;
	type = R.operations.addType({
		name: 'undersized',
		stageCount: 1,
		stages: build.stages,
		nominalPayload: build.payloadMass,
		defaultProfileId: profileId
	});
	R.operations.createRocket(type, source);
	// A rocket that refuels for the leg and then wrecks has paid for the fuel
	// it burned, which is the honest cost of the attempt.
	game.ledger.length = 0;
	R.operations.state.fleet[0].stageState[0].fuelMass = build.stages[0].fuelMass * 0.4;
	order = R.operations.dispatch({
		source: source.id,
		destination: target.id,
		mode: 'oneway',
		fuelPolicy: 'refuel',
		outboundPayload: build.payloadMass * 4,
		returnPayload: 0,
		typeId: type.id,
		profileId: profileId,
		overhaul: true
	});
	if (!order.ok) {
		console.log('=== bands · crash ===');
		console.log('the undersized stack was refused: ' + order.reason);
		return;
	}
	harness.fly(game, frameDt);
	entry = R.flightLog.entries[0];
	replacement = R.parts.typeBuildCost(type, entry.departedPadId);
	console.log('=== bands · crash · verdant near hop, an undersized stack ===');
	console.log('status ' + entry.status + ' · revenue $0 · leg cash ' + Math.round(entry.cashDelta) +
		' (the fuel it loaded) · replacement $' + Math.round(replacement) +
		' · a crash costs $' + Math.round(-entry.cashDelta + replacement) +
		' against a leg that pays nothing · target: a large negative, never a mid-band result');
}

// The crash band: a leg that ends in a wreck earns nothing and costs the stack
// it flew. The ledger charges the fuel the leg loaded but not the lost
// structure — the player pays that when the rocket is replaced — so the report
// shows both, and the total is what a crash costs a run.
function crashReport() {
	var source;
	var target;
	var build;
	var game;
	var type;
	var capacity;
	var order;
	var entry;
	var replacement;

	R.world.initialize('verdant');
	source = R.world.pads[0];
	target = bracketTarget(source, false);
	game = harness.createGame(source, target.id, timeScale, settings.economy.startingCash);
	R.game = game;
	R.operations.initialize();
	R.operations.state.types.length = 0;
	R.operations.state.fleet.length = 0;
	// A stack loaded to its launch gate with the least fuel the catalog allows:
	// it lifts off, cannot complete the hop, and wrecks. The gate is a liftoff
	// check, not a promise the rocket can fly the leg.
	type = R.operations.addType({
		name: 'undersized',
		stageCount: 1,
		stages: [{ fuelMass: settings.rocket.minFuelMass, strength: 1, engineId: null, tankId: null, fairingId: null }],
		nominalPayload: settings.rocket.defaultPayloadMass,
		defaultProfileId: profileId
	});
	capacity = Math.floor(type.payloadLimit * 0.95);
	R.operations.createRocket(type, source);
	// A rocket that refuels for the leg and then wrecks has paid for the fuel
	// it burned, which is the honest cost of the attempt.
	R.operations.state.fleet[0].stageState[0].fuelMass = settings.rocket.minFuelMass * 0.4;
	order = R.operations.dispatch({
		source: source.id,
		destination: target.id,
		mode: 'oneway',
		fuelPolicy: 'refuel',
		outboundPayload: capacity,
		returnPayload: 0,
		typeId: type.id,
		profileId: profileId,
		overhaul: true
	});
	console.log('=== bands · crash · verdant near hop, a stack loaded to its gate (' + capacity + ' kg) ===');
	if (!order.ok) {
		console.log('the stack was refused before it flew: ' + order.reason);
		return;
	}
	harness.fly(game, frameDt);
	entry = R.flightLog.entries[0];
	replacement = R.parts.typeBuildCost(type, entry.departedPadId);
	console.log('status ' + entry.status + ' · revenue $' + Math.round(entry.revenue) +
		' · leg cash ' + Math.round(entry.cashDelta) + ' (the fuel it loaded) · replacement $' +
		Math.round(replacement) + ' · the attempt costs $' + Math.round(-entry.cashDelta + replacement) +
		' · target: a large negative, never a mid-band result');
}

bandReport();
overbuildReport();
crashReport();
contractReport();
leftoverFuelReport();
