(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var damage = R.damage || (R.damage = {});
	// The tuning is bound when the model is used, not when this file is
	// evaluated: the experiments require the modules in their own order.
	var settings = R.constants.damage || {};

	function bind() {
		settings = R.constants.damage;
		return settings;
	}

	// Damage is one model with two halves: the flight's loads accumulate
	// stress on the stack, and stress is what fails. A stage is rated against
	// the world's own certified flight envelope — the limits the autopilot
	// flies — times a margin for how strongly it was built, so a well-built
	// rocket flies the certified envelope for free and a skimpy one is
	// damaged by exactly the same flight.
	damage.enabled = true;

	// One bit per failure mode: the HUD, the debrief and the flight log read
	// the same bits, so a failure is never described twice.
	damage.flags = { DEGRADED: 1, ENGINE_OUT: 2, LEAK: 4, FAIRING: 8, RUPTURE: 16 };
	var flagOrder = ['DEGRADED', 'ENGINE_OUT', 'LEAK', 'FAIRING', 'RUPTURE'];
	var flagLabels = ['ENGINE DEGRADED', 'ENGINE OUT', 'TANK LEAK', 'FAIRING LOST', 'TANK RUPTURE'];
	// Which failure a roll picks, and how often relative to the others: an
	// engine that loses half its thrust is the common one, a dead engine is
	// not, and a fairing only pops on a stack that carries one.
	var modeWeights = { DEGRADED: 3, ENGINE_OUT: 1, LEAK: 2, FAIRING: 1 };
	var modeOrder = [];
	var labelsByFlag = {};
	(function buildTables() {
		var i;
		var flag;

		for (i = 0; i < flagOrder.length; i += 1) {
			flag = damage.flags[flagOrder[i]];
			modeOrder.push(flag);
			labelsByFlag[flag] = flagLabels[i];
		}
	})();

	damage.active = 0;
	damage.alarm = 0;
	damage.alarmTime = 0;
	// The active stage's stress and the cargo's damage, for the HUD.
	damage.stageStress = 0;
	damage.payloadStress = 0;

	var randState = 1;
	var limits = { acceleration: 0, pressure: 0 };
	var landing = { stress: 0, payloadDamage: 0 };
	var candidates = [];
	var weights = [];

	// How far a load is past the limit it is rated for, as a fraction: 0
	// inside the limit, 1 at twice it. A limit of 0 means the world certifies
	// nothing, and nothing exceeds it.
	function excess(load, limit) {
		if (!(limit > 0)) {
			return 0;
		}
		return Math.max(0, load / limit - 1);
	}

	// An engine's burn time against its rating, past the point where the
	// clock starts to matter: 0 at `wearStart`, 1 at the rating.
	function wearExcess(stage) {
		var rating = R.parts.engine(stage.engineId).maxThrottleSeconds;
		var wear = stage.engineBurnTimeUsed / rating;
		var start = settings.wearStart;

		return Math.max(0, (wear - start) / (1 - start));
	}

	// The envelope this stage is built to, from the planet's certified limits
	// and how strongly the stage was built.
	function stageLimits(stage) {
		var flight = R.world.planet.flight;
		var strength = R.util.clamp(stage.strength == null ? 1 : stage.strength, 0.5, 1);
		var margin = settings.structureMargin * strength;

		limits.acceleration = (flight.maxThrustAcceleration > 0 ? flight.maxThrustAcceleration : 0) * margin;
		limits.pressure = (flight.maxDynamicPressure > 0 ? flight.maxDynamicPressure : 0) * margin;
		return limits;
	}

	// Stress per second from the load the stack is carrying: thrust and drag,
	// and the air it is being pushed through. Flying inside the rating is not
	// free, it is cheap — the fatigue term is what every hop costs — and the
	// excess over the rating is what wrecks a stage.
	function structuralStress(stage, accel, pressure) {
		stageLimits(stage);
		var shareG = limits.acceleration > 0 ? accel / limits.acceleration : 0;
		var shareQ = limits.pressure > 0 ? pressure / limits.pressure : 0;
		var overG = Math.max(0, shareG - 1);
		var overQ = Math.max(0, shareQ - 1);

		return settings.stressRate * (overG * overG + overQ * overQ +
			settings.fatigueWeight * (shareG * shareG + shareQ * shareQ));
	}

	// The cargo rides the same flight. It is rated in g and, once a fairing
	// has been lost inside the atmosphere, in pressure too.
	function payloadStress(state, accel, pressure) {
		var gLoad = (state.fragileCargo ? settings.fragileGLoad : settings.payloadGLoad) *
			R.constants.rocket.standardGravity;
		var overG = excess(accel, gLoad);
		var overQ = state.fairingLost ? excess(pressure, settings.payloadPressure) : 0;

		return settings.payloadStressRate * (overG * overG + overQ * overQ);
	}

	// What fails a part is the damage it carries and, for an engine, how far
	// past its useful burn time it has been flown.
	function failureRate(stage) {
		bind();
		var stress = Math.min(settings.ruptureStress, Math.max(0, stage.stress));
		var wear = wearExcess(stage);

		return Math.min(settings.maxFailureRate,
			settings.failureRate * Math.pow(stress, settings.failureExponent) +
			settings.wearRate * wear * wear);
	}

	// Exported for the HUD and the experiments: what this stage's risk is
	// worth per second, before it is sampled.
	damage.failureRate = failureRate;

	function nextRandom() {
		randState = (randState + 0x6D2B79F5) | 0;
		var t = randState;

		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}

	// mulberry32, seeded per flight: the same flight rolls the same failures,
	// so a rate change can be measured against the runs that came before it.
	damage.reset = function(seed) {
		bind();
		randState = (seed === undefined ? settings.seed : seed) >>> 0;
		damage.active = 0;
		damage.alarm = 0;
		damage.alarmTime = 0;
		damage.stageStress = 0;
		damage.payloadStress = 0;
		return damage;
	};

	function raise(flag) {
		damage.active |= flag;
		damage.alarm = flag;
		damage.alarmTime = settings.alarmSeconds;
	}

	damage.alarmLabel = function() {
		return damage.alarmTime > 0 ? labelsByFlag[damage.alarm] : '';
	};

	// The failures of a finished flight, worst first, for the debrief and the
	// log. Rebuilt once per report, never in a frame.
	damage.failureText = function(flags) {
		var text = '';
		var i;
		var flag;

		for (i = modeOrder.length - 1; i >= 0; i -= 1) {
			flag = modeOrder[i];
			if (flags & flag) {
				text += (text ? ' · ' : '') + labelsByFlag[flag];
			}
		}
		return text;
	};

	// An engine that has failed keeps a fraction of its thrust and loses some
	// of its efficiency. Thrust is what the flight reads everywhere else, so
	// the failure is written into the stage rather than subtracted per step.
	function failEngine(stage, health) {
		var efficiency = 1 - settings.engineIspLoss * (1 - health);

		stage.engineHealth = health;
		stage.thrustMax = stage.thrustNominal * health;
		stage.ispSea *= efficiency;
		stage.ispVac *= efficiency;
		if (health <= 0) {
			stage.engineOut = true;
		}
	}

	function loseFairing(state) {
		var top = state.stages[state.stageCount - 1];

		if (!state.fairingAttached) {
			return;
		}
		state.fairingAttached = false;
		state.fairingLost = true;
		top.dryMass = Math.max(0, top.dryMass - state.fairingMass);
		state.fairingMass = 0;
	}

	// Which failures this stage can still suffer, weighted.
	function rollCandidates(state, stage) {
		var total = 0;
		var i;
		var flag;

		candidates.length = 0;
		weights.length = 0;
		for (i = 0; i < modeOrder.length; i += 1) {
			flag = modeOrder[i];
			if (flag === damage.flags.DEGRADED && stage.engineHealth <= settings.enginePartialHealth) {
				continue;
			}
			if (flag === damage.flags.ENGINE_OUT && stage.engineHealth <= 0) {
				continue;
			}
			if (flag === damage.flags.LEAK && (stage.leakRate > 0 || stage.fuelMass <= 0)) {
				continue;
			}
			if (flag === damage.flags.FAIRING && !state.fairingAttached) {
				continue;
			}
			if (flag === damage.flags.RUPTURE) {
				continue;
			}
			candidates.push(flag);
			total += modeWeights[flagOrder[i]];
			weights.push(total);
		}
		return total;
	}

	function pickFailure(state, stage, total) {
		var roll = nextRandom() * total;
		var i;

		for (i = 0; i < weights.length; i += 1) {
			if (roll < weights[i]) {
				return candidates[i];
			}
		}
		return candidates[candidates.length - 1];
	}

	function applyFailure(state, stage, flag) {
		if (flag === damage.flags.DEGRADED) {
			failEngine(stage, settings.enginePartialHealth);
			return;
		}
		if (flag === damage.flags.ENGINE_OUT) {
			failEngine(stage, 0);
			return;
		}
		if (flag === damage.flags.LEAK) {
			stage.leakRate = settings.leakRate;
			return;
		}
		loseFairing(state);
	}

	// A tank that is past its rupture limit with fuel aboard does not leak or
	// sputter: the stack comes apart and nothing about the flight survives.
	function rupture(game, stage) {
		raise(damage.flags.RUPTURE);
		stage.engineOut = true;
		R.mission.rupture(game, stage);
	}

	function leakFuel(stage, dt) {
		if (stage.leakRate <= 0) {
			return;
		}
		stage.leakRate += settings.leakGrowth * dt;
		stage.fuelMass = Math.max(0, stage.fuelMass - stage.leakRate * dt);
	}

	// One physics step of the damage model. Every attached stage carries the
	// flight's load; the stage that is burning is the one that can fail.
	// `accel` is the non-gravitational acceleration (thrust and drag) and
	// `pressure` the dynamic pressure of the step that just flew.
	damage.step = function(game, dt, accel, pressure) {
		bind();
		var state = game.rocket;
		var stage = R.rocket.activeStage(state);
		var stress;
		var rate;
		var total;
		var flag;
		var i;
		var s;

		if (!damage.enabled || game.phase !== 'flying') {
			return false;
		}
		if (damage.alarmTime > 0) {
			damage.alarmTime = Math.max(0, damage.alarmTime - dt);
		}
		for (i = 0; i < state.stageCount; i += 1) {
			s = state.stages[i];
			if (!s.alive) {
				continue;
			}
			stress = s.stress + structuralStress(s, accel, pressure) * dt;
			s.stress = Math.min(settings.ruptureStress, Math.max(0, stress));
			if (s.stress >= settings.ruptureStress && s.fuelMass > 0) {
				rupture(game, s);
				return true;
			}
		}
		damage.payloadStress = Math.min(1, damage.payloadStress + payloadStress(state, accel, pressure) * dt);
		if (!stage) {
			return false;
		}
		damage.stageStress = stage.stress;
		leakFuel(stage, dt);
		if (state.throttle <= 0 || stage.fuelMass <= 0) {
			return false;
		}
		rate = failureRate(stage);
		if (rate <= 0 || nextRandom() >= 1 - Math.exp(-rate * dt)) {
			return false;
		}
		total = rollCandidates(state, stage);
		if (total <= 0) {
			return false;
		}
		flag = pickFailure(state, stage, total);
		raise(flag);
		applyFailure(state, stage, flag);
		// A dead engine is the autopilot's to answer, and it answers by
		// staging; the alarm is what the player sees either way.
		return game.phase !== 'flying';
	};

	// Separating a stage shakes the stack.
	damage.separation = function(state) {
		bind();
		var stage = R.rocket.activeStage(state);

		if (!damage.enabled || !stage) {
			return;
		}
		stage.stress = Math.min(settings.ruptureStress, stage.stress + settings.separationStress);
	};

	// Touchdown, in the shared `landing` record: the caller reads it before
	// the next touchdown. The 0.3.3 reference band — 2.7 to 3.8 m/s down, within a
	// metre of the pad — is the zero point, and the planet's own crash limits
	// are the far end: an arrival inside the soft threshold costs nothing and
	// a hard one bills both the stack and the cargo.
	damage.landing = function(state, vy, vx, planet, fragile) {
		bind();
		var softVertical = planet.landingVerticalSpeed * settings.softLandingFraction;
		var softHorizontal = planet.landingHorizontalSpeed * settings.softLandingFraction;
		var overVertical = Math.max(0, Math.abs(vy) - softVertical);
		var overHorizontal = Math.max(0, Math.abs(vx) - softHorizontal);

		if (!damage.enabled) {
			landing.stress = 0;
			landing.payloadDamage = 0;
			return landing;
		}
		landing.stress = settings.landingStress * (overVertical + 0.5 * overHorizontal);
		landing.payloadDamage = settings.payloadLandingDamage * (overVertical + 0.5 * overHorizontal) *
			(fragile ? 2 : 1);
		return landing;
	};

	// A hard arrival leaves its mark on every stage that came down with the
	// rocket; a crash is written off instead.
	damage.applyLanding = function(state, stress) {
		bind();
		var i;

		if (!damage.enabled || stress <= 0) {
			return;
		}
		for (i = 0; i < state.stageCount; i += 1) {
			if (!state.stages[i].alive) {
				continue;
			}
			state.stages[i].stress = Math.min(settings.ruptureStress, state.stages[i].stress + stress);
		}
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = damage;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
