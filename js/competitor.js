(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var competitor = R.competitor || (R.competitor = {});
	var settings = R.constants.competitor;
	var randomState = 1;
	var running = false;
	var simulationGame = null;
	var profile = {
		enabled: false,
		profileId: '',
		phase: '',
		limiter: 0,
		stagedEarly: false,
		heading: 0,
		throttle: 0,
		stage: false
	};

	competitor.id = settings.id;
	competitor.state = null;

	function nextRandom() {
		randomState = (randomState + 0x6D2B79F5) | 0;
		var value = randomState;

		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	}

	function createOperationsState(planetId) {
		return {
			planetId: planetId,
			nextId: 1,
			types: [],
			fleet: [],
			routes: [],
			playerStats: { deliveries: 0, reputation: 50 },
			mission: null,
			offer: null,
			countdown: 0,
			revision: 0,
			scheduledRevision: -1,
			dismissedRouteId: null
		};
	}

	function createType(planet) {
		var stages = [];
		var i;

		for (i = 0; i < planet.defaultFuel.length; i += 1) {
			stages.push({ fuelMass: planet.defaultFuel[i], strength: settings.initialStrength });
		}
		return R.operations.addType({
			name: 'Skybolt Courier',
			stageCount: stages.length,
			stages: stages,
			nominalPayload: planet.defaultPayload,
			defaultProfileId: 'balanced'
		});
	}

	function createSimulationGame(pad) {
		return {
			currentPadId: pad.id,
			targetPadId: R.world.pads[1].id,
			rocket: R.rocket.create(pad),
			phase: 'deck',
			cash: settings.startingCash,
			ledger: [],
			flight: null,
			mission: null,
			lastReport: null,
			explosion: null,
			selection: {
				sourcePadId: pad.id,
				targetPadId: R.world.pads[1].id,
				mode: 'oneway',
				visible: false
			},
			simTime: 0,
			physicsAccumulator: 0,
			timeScaleIndex: R.constants.time.scales.indexOf(1),
			timeScale: 1,
			competitorSimulation: true
		};
	}

	competitor.initialize = function(seed) {
		var playerOperations = R.operations.state;
		var planet = R.world.planet;
		var home = R.world.pads[0];
		var operationState = createOperationsState(planet.id);
		var rivalSeed = seed === undefined ? R.market.state.seed : seed;

		competitor.state = {
			id: settings.id,
			name: settings.name,
			planetId: planet.id,
			cash: settings.startingCash,
			deliveries: 0,
			reputation: 50,
			skill: settings.initialSkill,
			turns: 0,
			contractsAccepted: 0,
			failedFlights: 0,
			currentPadId: home.id,
			lastAction: 'ready',
			lastFlight: {
				status: '',
				fromPadId: home.id,
				toPadId: home.id,
				contractId: null,
				payloadMass: 0,
				elapsed: 0,
				failures: 0,
				steps: 0
			},
			operations: operationState
		};
		randomState = ((rivalSeed >>> 0) ^ settings.seed) >>> 0;
		if (!randomState) {
			randomState = 1;
		}

		R.operations.state = operationState;
		try {
			createType(planet);
			R.operations.createRocket(operationState.types[0], home);
		} finally {
			R.operations.state = playerOperations;
		}
		simulationGame = createSimulationGame(home);
		return competitor.state;
	};

	competitor.bidChance = function(playerCash, rivalCash, margin, skill) {
		var cashAdvantage = R.util.clamp((playerCash - rivalCash) / Math.max(1, settings.startingCash), -1, 1);
		var profitMargin = R.util.clamp(margin, 0, 1);
		var experience = R.util.clamp(skill, 0, settings.maxSkill);

		return R.util.clamp(settings.baseBidChance + cashAdvantage * settings.cashLeadSwing +
			profitMargin * settings.marginSwing + experience * settings.skillSwing,
		settings.minBidChance, settings.maxBidChance);
	};

	function saveContext() {
		profile.enabled = R.autopilot.enabled;
		profile.profileId = R.autopilot.profileId;
		profile.phase = R.autopilot.phase;
		profile.limiter = R.autopilot.limiter;
		profile.stagedEarly = R.autopilot.stagedEarly;
		profile.heading = R.autopilot.command.heading;
		profile.throttle = R.autopilot.command.throttle;
		profile.stage = R.autopilot.command.stage;
	}

	function restoreContext(playerGame, playerOperations) {
		R.game = playerGame;
		R.operations.state = playerOperations;
		R.autopilot.reset();
		R.autopilot.setProfile(profile.profileId);
		R.autopilot.setEnabled(profile.enabled);
		R.autopilot.phase = profile.phase;
		R.autopilot.limiter = profile.limiter;
		R.autopilot.stagedEarly = profile.stagedEarly;
		R.autopilot.command.heading = profile.heading;
		R.autopilot.command.throttle = profile.throttle;
		R.autopilot.command.stage = profile.stage;
	}

	function availableRocket(state) {
		var fleet = state.operations.fleet;
		var i;

		for (i = 0; i < fleet.length; i += 1) {
			if (fleet[i].status === 'available') {
				state.currentPadId = fleet[i].padId;
				return fleet[i];
			}
			if (fleet[i].status === 'flying') {
				return null;
			}
		}
		return null;
	}

	function ensureRocket(state) {
		var rocket = availableRocket(state);
		var type = state.operations.types[0];
		var result;

		if (rocket) {
			return rocket;
		}
		if (state.operations.fleet.some(function(ship) { return ship.status === 'flying'; })) {
			return null;
		}
		simulationGame.cash = state.cash;
		result = R.operations.buildRocket(type.id, state.currentPadId);
		state.cash = simulationGame.cash;
		if (!result.ok) {
			state.lastAction = 'cannot-rebuild';
			return null;
		}
		return R.operations.findRocket(result.rocketId);
	}

	function bestContract(state, rocket) {
		var contracts = R.market.state.contracts;
		var type = state.operations.types[0];
		var best = null;
		var contract;
		var evaluation;
		var reward;
		var expectedRevenue;
		var expectedProfit;
		var margin;
		var i;

		for (i = 0; i < contracts.length; i += 1) {
			contract = contracts[i];
			if (contract.status !== 'open' || contract.fromPadId !== state.currentPadId) {
				continue;
			}
			evaluation = R.operations.evaluateLeg(type.id, contract.fromPadId, contract.payloadMass,
				true, rocket.id, true, contract.toPadId);
			if (!evaluation.ready) {
				continue;
			}
			reward = R.market.contractReward(contract);
			expectedRevenue = reward * (1 - settings.expectedCargoLoss) * (1 - R.autopilot.feeFraction);
			expectedProfit = expectedRevenue - evaluation.cost;
			if (!Number.isFinite(expectedProfit) || expectedProfit <= 0 ||
				(best && expectedProfit <= best.expectedProfit)) {
				continue;
			}
			margin = expectedProfit / Math.max(1, reward);
			best = {
				contract: contract,
				expectedProfit: expectedProfit,
				margin: margin
			};
		}
		return best;
	}

	function profileFor(state, contract) {
		return contract.fragile && state.skill >= 0.5 ? 'gentle' : 'balanced';
	}

	function fly(game) {
		var step = R.constants.rocket.fixedStep;
		var maxSteps = Math.ceil(settings.maxFlightSeconds / step);
		var count = 0;

		while (game.phase === 'flying' && count < maxSteps) {
			R.controls.update(game, step);
			R.physics.step(game, step);
			count += 1;
		}
		if (game.phase === 'flying') {
			R.mission.timeout(game);
		}
		return count;
	}

	function recordFlight(state, contract, rocket, sourcePadId, stepCount) {
		var report = simulationGame.lastReport;
		var flight = state.lastFlight;

		flight.status = report ? report.status : 'unresolved';
		flight.fromPadId = sourcePadId;
		flight.toPadId = contract.toPadId;
		flight.contractId = contract.id;
		flight.payloadMass = contract.payloadMass;
		flight.elapsed = report ? report.elapsed : 0;
		flight.failures = report ? report.failures : 0;
		flight.steps = stepCount;
		state.currentPadId = rocket.padId;
		state.cash = simulationGame.cash;
		if (report && report.status === 'delivered') {
			state.deliveries += 1;
			state.reputation = Math.min(100, state.reputation + settings.reputationPerDelivery);
			state.skill = Math.min(settings.maxSkill, state.skill + settings.skillPerDelivery);
			state.lastAction = 'delivered';
		} else {
			state.failedFlights += 1;
			state.reputation = Math.max(0, state.reputation - settings.reputationLoss);
			state.lastAction = report ? report.status : 'unresolved';
		}
	}

	competitor.takeTurn = function(playerGame) {
		var state = competitor.state;
		var playerOperations = R.operations.state;
		var previousGame = R.game;
		var rocket;
		var candidate;
		var chance;
		var result;
		var sourcePadId;
		var steps;

		if (!state || running || !playerGame || playerGame.phase !== 'deck' || state.planetId !== R.world.planet.id) {
			return false;
		}
		running = true;
		state.turns += 1;
		saveContext();
		R.operations.state = state.operations;
		R.game = simulationGame;
		try {
			simulationGame.cash = state.cash;
			simulationGame.ledger.length = 0;
			simulationGame.lastReport = null;
			simulationGame.explosion = null;
			simulationGame.simTime = 0;
			simulationGame.physicsAccumulator = 0;
			rocket = ensureRocket(state);
			if (!rocket) {
				state.lastAction = state.lastAction === 'cannot-rebuild' ? state.lastAction : 'no-rocket';
				return false;
			}
			candidate = bestContract(state, rocket);
			if (!candidate) {
				state.lastAction = 'no-profitable-contract';
				return false;
			}
			chance = competitor.bidChance(playerGame.cash, state.cash, candidate.margin, state.skill);
			if (nextRandom() >= chance) {
				state.lastAction = 'passed';
				return false;
			}
			sourcePadId = state.currentPadId;
			result = R.operations.dispatch({
				source: candidate.contract.fromPadId,
				destination: candidate.contract.toPadId,
				mode: 'oneway',
				fuelPolicy: 'refuel',
				outboundPayload: candidate.contract.payloadMass,
				returnPayload: 0,
				typeId: state.operations.types[0].id,
				rocketId: rocket.id,
				profileId: profileFor(state, candidate.contract),
				overhaul: true,
				contractId: candidate.contract.id,
				operatorId: state.id
			});
			if (!result.ok) {
				state.lastAction = 'dispatch-refused';
				return false;
			}
			state.contractsAccepted += 1;
			steps = fly(simulationGame);
			recordFlight(state, candidate.contract, rocket, sourcePadId, steps);
			return true;
		} finally {
			restoreContext(previousGame, playerOperations);
			running = false;
		}
	};

	// `mission.finish` runs per flight leg. A return order waits on the deck
	// for authorization between flights; the phase guard keeps shared scratch
	// isolated from any active player physics.
	competitor.afterPlayerLeg = function(game) {
		if (!competitor.state || game !== R.game || game.competitorSimulation || game.phase !== 'deck') {
			return false;
		}
		return competitor.takeTurn(game);
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = competitor;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
