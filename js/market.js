(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var market = R.market || (R.market = {});
	var settings = R.constants.market;

	// One market per run: a price per pad and a contract board, both seeded so
	// a world's economy can be reproduced exactly (`seedFor(planetId)`). The
	// state is reset by operations.initialize with everything else.
	market.state = null;

	var randState = 1;
	var quote = { reward: 0, pricePerKg: 0, contractId: null, fragileSpeed: 0 };

	// mulberry32: small, fast, and good enough for prices. Advanced at board
	// generation and turn time only, never in a frame.
	function nextRandom() {
		randState = (randState + 0x6D2B79F5) | 0;
		var t = randState;

		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}

	function hashText(text) {
		var hash = 2166136261;
		var i;

		for (i = 0; i < text.length; i += 1) {
			hash ^= text.charCodeAt(i);
			hash = Math.imul(hash, 16777619);
		}
		return hash >>> 0;
	}

	market.seedFor = function(planetId) {
		return (hashText(planetId) ^ settings.seed) >>> 0;
	};

	market.initialize = function(seed) {
		var planet = R.world.planet;
		var pads = R.world.pads;
		var state = {
			planetId: planet.id,
			seed: seed === undefined ? settings.seed : seed,
			turn: 0,
			pads: [],
			contracts: [],
			nextContractId: 1
		};
		var i;

		for (i = 0; i < pads.length; i += 1) {
			state.pads.push({
				padId: pads[i].id,
				fuel: planet.prices.fuel,
				steel: planet.prices.steel,
				delivery: planet.prices.delivery,
				demand: demandBase(),
				served: 0
			});
		}
		market.state = state;
		randState = state.seed;
		// The first turn-0 prices are a step of drift, so no two pads open at
		// exactly the planet's list price and cheap fuel is visible from the map.
		// The appetite does not drift: a pad's standing demand is what a route is
		// planned against, and 0.5 moves it with shocks and rival volume rather
		// than with noise.
		for (i = 0; i < state.pads.length; i += 1) {
			drift(state.pads[i], 'fuel', planet.prices.fuel);
			drift(state.pads[i], 'steel', planet.prices.steel);
			drift(state.pads[i], 'delivery', planet.prices.delivery);
		}
		for (i = 0; i < pads.length; i += 1) {
			fillBoard(pads[i].id);
		}
		return state;
	};

	function padEntry(padId) {
		var pads = market.state ? market.state.pads : [];
		var i;

		for (i = 0; i < pads.length; i += 1) {
			if (pads[i].padId === padId) {
				return pads[i];
			}
		}
		return null;
	}

	function basePrice(field) {
		return R.world.planet.prices[field];
	}

	// A pad's appetite in kilos per leg: the planet's reference load times the
	// market's demand factor, drifting inside the same band as its prices.
	function demandBase() {
		return R.world.planet.defaultPayload * settings.demandFactor;
	}

	// The live price of `field` ('fuel' | 'steel' | 'delivery') at a pad, in
	// money per kg. Without a market (a cold render) the planet's list price is
	// the honest answer.
	market.price = function(padId, field) {
		var entry = padEntry(padId);

		return entry ? entry[field] : basePrice(field);
	};

	// A bounded random walk around the planet's list price, pulled gently back
	// toward it so a delivery cannot park a price at a bound.
	function drift(entry, field, base) {
		var spread = base * settings.padSpread;
		var value = entry[field] + (base - entry[field]) * settings.meanReversion +
			(nextRandom() * 2 - 1) * settings.driftPerTurn * base;

		entry[field] = Math.min(base + spread, Math.max(base - spread, value));
	}

	market.turn = function() {
		return market.state ? market.state.turn : 0;
	};

	// What the destination will take on one leg, in kilos, rounded to the ten
	// kilos the payload slider works in. Without a market the planet's own
	// appetite is the honest answer.
	market.demand = function(padId) {
		var entry = padEntry(padId);

		return Math.round((entry ? entry.demand : demandBase()) / 10) * 10;
	};

	// One dispatch turn: prices drift, open contracts age, expired ones go, and
	// every board is refilled. A leg ends a turn, delivering, landing, crashing
	// or finding the return blocked, so urgency counts flights, not wall clock.
	market.advance = function() {
		var state = market.state;
		var planet = R.world.planet;
		var pads = state.pads;
		var contracts = state.contracts;
		var i;

		state.turn += 1;
		for (i = 0; i < pads.length; i += 1) {
			drift(pads[i], 'fuel', planet.prices.fuel);
			drift(pads[i], 'steel', planet.prices.steel);
			drift(pads[i], 'delivery', planet.prices.delivery);
		}
		for (i = contracts.length - 1; i >= 0; i -= 1) {
			if (contracts[i].status !== 'open') {
				continue;
			}
			contracts[i].turnsLeft -= 1;
			if (contracts[i].turnsLeft <= 0) {
				contracts.splice(i, 1);
			}
		}
		for (i = 0; i < R.world.pads.length; i += 1) {
			fillBoard(R.world.pads[i].id);
		}
	};

	function openCount(padId) {
		var contracts = market.state.contracts;
		var count = 0;
		var i;

		for (i = 0; i < contracts.length; i += 1) {
			count += contracts[i].fromPadId === padId && contracts[i].status === 'open' ? 1 : 0;
		}
		return count;
	}

	// The board asks for a rung of the destination's appetite, never more: a
	// contract the pad would not take could not be flown by any rocket.
	function payloadFor(demand) {
		var ladder = settings.payloadLadder;
		var mass = ladder[Math.floor(nextRandom() * ladder.length)] * demand;

		return Math.min(R.constants.rocket.maxPayloadMass, Math.max(10, Math.round(mass / 10) * 10));
	}

	function otherPad(padId) {
		var pads = R.world.pads;
		var pad = pads[Math.floor(nextRandom() * pads.length)];

		// Four pads per world, so one redraw is enough and the loop is bounded.
		if (pad.id === padId) {
			pad = pads[(R.world.padIndex(padId) + 1) % pads.length];
		}
		return pad;
	}

	// A contract quotes its own price per kg at posting: the destination's live
	// price, plus urgency (a short deadline pays the full bonus, the longest
	// pays a quarter of it) and a fragility premium. Quoting at posting is why
	// the board's numbers never move while the player decides.
	function makeContract(fromPadId) {
		var destination = otherPad(fromPadId);
		var turnsLeft = settings.minContractTurns +
			Math.floor(nextRandom() * (settings.maxContractTurns - settings.minContractTurns + 1));
		var fragile = nextRandom() < settings.fragileChance;
		var urgency = settings.urgencyBonus * (settings.maxContractTurns + 1 - turnsLeft) / settings.maxContractTurns;

		return {
			id: market.state.nextContractId++,
			fromPadId: fromPadId,
			toPadId: destination.id,
			payloadMass: payloadFor(market.demand(destination.id)),
			perKg: market.price(destination.id, 'delivery') * (1 + urgency + (fragile ? settings.fragileBonus : 0)),
			turnsLeft: turnsLeft,
			fragile: fragile,
			status: 'open',
			postedTurn: market.state.turn
		};
	}

	function fillBoard(padId) {
		while (openCount(padId) < settings.contractSlots) {
			market.state.contracts.push(makeContract(padId));
		}
	}

	market.find = function(contractId) {
		var contracts = market.state ? market.state.contracts : [];
		var i;

		for (i = 0; i < contracts.length; i += 1) {
			if (contracts[i].id === contractId) {
				return contracts[i];
			}
		}
		return null;
	};

	market.servedAt = function(padId) {
		var entry = padEntry(padId);

		return entry ? entry.served : 0;
	};

	market.contractsAt = function(padId) {
		var contracts = market.state ? market.state.contracts : [];
		var out = [];
		var i;

		for (i = 0; i < contracts.length; i += 1) {
			if (contracts[i].fromPadId === padId) {
				out.push(contracts[i]);
			}
		}
		return out;
	};

	market.contractReward = function(contract) {
		return contract.payloadMass * contract.perKg;
	};

	// What a leg pays if it delivers: a contract pays its posted rate; a
	// standing service sells at the destination's live price, which grows with
	// the distance flown. Frozen on the flight record at dispatch, so a price
	// that drifts mid-flight cannot change what was promised.
	market.quote = function(fromPadId, toPadId, payloadMass, contractId) {
		var contract = contractId ? market.find(contractId) : null;
		var distance = Math.abs(R.util.wrapDelta(R.world.findPadById(toPadId).wx - R.world.findPadById(fromPadId).wx,
			R.world.planet.circumference));

		quote.contractId = contract ? contract.id : null;
		quote.fragileSpeed = contract && contract.fragile ?
			R.world.planet.landingVerticalSpeed * settings.fragileSpeedFactor : 0;
		if (contract) {
			quote.pricePerKg = contract.perKg;
		} else {
			quote.pricePerKg = market.price(toPadId, 'delivery') *
				(1 + settings.distanceBonus * distance / R.world.planet.circumference);
		}
		quote.reward = payloadMass * quote.pricePerKg;
		return quote;
	};

	// The contract is being flown: it leaves the board but keeps its clock.
	market.assign = function(contractId) {
		var contract = market.find(contractId);

		if (!contract || contract.status !== 'open') {
			return false;
		}
		contract.status = 'assigned';
		return true;
	};

	// The leg that carried it did not deliver: the cargo is back on the board
	// for another attempt while its turns last.
	market.release = function(contractId) {
		var contract = market.find(contractId);

		if (!contract) {
			return false;
		}
		contract.status = 'open';
		contract.turnsLeft = Math.max(1, contract.turnsLeft);
		return true;
	};

	// Delivered: the contract is done, the destination has been served, and its
	// price gives a little to the extra volume.
	market.fulfil = function(contractId) {
		var state = market.state;
		var contract = market.find(contractId);
		var entry;
		var i;

		if (!contract) {
			return false;
		}
		entry = padEntry(contract.toPadId);
		if (entry) {
			entry.served += 1;
			entry.delivery = Math.max(basePrice('delivery') * (1 - settings.padSpread),
				entry.delivery - basePrice('delivery') * settings.servedPressure);
		}
		for (i = 0; i < state.contracts.length; i += 1) {
			if (state.contracts[i].id === contractId) {
				state.contracts.splice(i, 1);
				break;
			}
		}
		fillBoard(contract.fromPadId);
		return true;
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = market;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
