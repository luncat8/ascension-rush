(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var campaign = R.campaign || (R.campaign = {});
	var settings = R.constants.campaign;
	var money = R.util.money;
	// Reused by campaign.standing() and campaign.rivalCarry(): both are read on
	// deck renders and world starts, one caller at a time.
	var standing = { cashLead: 0, deliveryLead: 0, padsBehind: 0, behindPadId: '', behindBy: 0, dominant: false };
	var rivalCarry = { reputation: 0, skill: 0, noticed: false };
	var persistent = false;

	// The record is the company: what it has unlocked, cleared and settled on
	// every world, and the reputation it carries to the next one. The state is
	// one world's run of the ladder and is rebuilt with that world.
	campaign.record = null;
	campaign.state = null;

	function freshRecord() {
		return { reputation: settings.startReputation, unlocks: {}, completed: {}, settlements: {} };
	}

	function completedKey(planetId, milestoneId) {
		return planetId + ':' + milestoneId;
	}

	// A page opened from file:// can be refused storage outright; the campaign
	// then lasts for the session, which is all a refused save can mean.
	function readStored() {
		try {
			return JSON.parse(root.localStorage.getItem(settings.storageKey));
		} catch (error) {
			return null;
		}
	}

	campaign.save = function() {
		if (!persistent) {
			return;
		}
		try {
			root.localStorage.setItem(settings.storageKey, JSON.stringify(campaign.record));
		} catch (error) {
			persistent = false;
		}
	};

	// Called once by the page before its first run. Node scripts never call it,
	// so a measurement starts from a fresh record and writes nothing.
	campaign.restore = function() {
		var stored = readStored();

		persistent = true;
		campaign.record = stored && stored.unlocks && stored.completed && stored.settlements ? stored : freshRecord();
		return campaign.record;
	};

	campaign.reset = function() {
		campaign.record = freshRecord();
		campaign.save();
		return campaign.record;
	};

	campaign.ladderOf = function(planetId) {
		return settings.worlds[planetId];
	};

	campaign.completedCount = function(planetId) {
		var ladder = settings.worlds[planetId];
		var count = 0;
		var i;

		for (i = 0; i < ladder.length; i += 1) {
			count += campaign.record.completed[completedKey(planetId, ladder[i].id)] ? 1 : 0;
		}
		return count;
	};

	campaign.initialize = function() {
		var planetId = R.world.planet.id;
		var record = campaign.record || (campaign.record = freshRecord());
		var state = {
			planetId: planetId,
			ladder: settings.worlds[planetId],
			activeIndex: campaign.completedCount(planetId),
			startReputation: R.util.clamp(record.reputation, settings.startReputation, settings.carryReputationCap),
			legs: 0,
			cleanLegs: 0,
			deliveries: 0,
			contractsDelivered: 0,
			fragileDelivered: 0,
			cargoKg: 0,
			contractsToPad: {},
			taskBase: 0
		};

		campaign.state = state;
		return state;
	};

	campaign.activeMilestone = function() {
		var state = campaign.state;

		return state.activeIndex < state.ladder.length ? state.ladder[state.activeIndex] : null;
	};

	campaign.profileUnlocked = function(profileId) {
		return profileId === R.constants.autopilotProfiles[0].id || !!campaign.record.unlocks['profile:' + profileId];
	};

	campaign.worldUnlocked = function(planetId) {
		return planetId === R.planets.defaultId || !!campaign.record.unlocks['world:' + planetId];
	};

	campaign.settlement = function(planetId) {
		return campaign.record.settlements[planetId] || null;
	};

	campaign.arcComplete = function() {
		var list = R.planets.list;
		var i;

		for (i = 0; i < list.length; i += 1) {
			if (!campaign.record.settlements[list[i].id]) {
				return false;
			}
		}
		return true;
	};

	// The first world that is open and not yet won, for the settlement card.
	campaign.nextWorld = function() {
		var list = R.planets.list;
		var i;

		for (i = 0; i < list.length; i += 1) {
			if (campaign.worldUnlocked(list[i].id) && !campaign.record.settlements[list[i].id]) {
				return list[i];
			}
		}
		return null;
	};

	// Names the milestone that opens `unlockId`, for a lock reason: "Long reach
	// (Verdant)".
	campaign.unlockSource = function(unlockId) {
		var list = R.planets.list;
		var ladder;
		var i;
		var j;

		for (i = 0; i < list.length; i += 1) {
			ladder = settings.worlds[list[i].id];
			for (j = 0; j < ladder.length; j += 1) {
				if (ladder[j].reward.unlock === unlockId) {
					return ladder[j].title + ' (' + list[i].name + ')';
				}
			}
		}
		return '';
	};

	// What this world's rival starts with: the reputation the player brought is
	// matched, and a milestone that made it take notice stays noticed.
	campaign.rivalCarry = function() {
		var state = campaign.state;
		var carried = state.startReputation - settings.startReputation;
		var i;

		rivalCarry.reputation = carried;
		rivalCarry.skill = carried * settings.rivalSkillPerCarriedReputation;
		rivalCarry.noticed = false;
		for (i = 0; i < state.activeIndex; i += 1) {
			rivalCarry.noticed = rivalCarry.noticed || !!state.ladder[i].reward.rivalNotice;
		}
		return rivalCarry;
	};

	// The dominant-courier comparison against the rival, on the same numbers
	// the scoreboard shows.
	campaign.standing = function() {
		var rival = R.competitor.state;
		var pads = R.world.pads;
		var needed;
		var served;
		var i;

		standing.cashLead = R.game.cash - rival.cash;
		standing.deliveryLead = R.operations.state.playerStats.deliveries - rival.deliveries;
		standing.padsBehind = 0;
		standing.behindPadId = '';
		standing.behindBy = 0;
		for (i = 0; i < pads.length; i += 1) {
			needed = Math.max(settings.dominantMinPerPad, R.market.servedBy(pads[i].id, rival.id));
			served = R.market.servedBy(pads[i].id, 'player');
			if (served >= needed) {
				continue;
			}
			standing.padsBehind += 1;
			if (!standing.behindPadId) {
				standing.behindPadId = pads[i].id;
				standing.behindBy = needed - served;
			}
		}
		standing.dominant = standing.cashLead > 0 && standing.padsBehind === 0;
		return standing;
	};

	function plural(count, word) {
		return count + ' ' + (count === 1 ? word : word.replace(/y$/, 'ie') + 's');
	}

	function standingText() {
		var result = campaign.standing();
		var lead = 'Ahead by ' + money(result.cashLead);

		if (result.cashLead <= 0) {
			return R.competitor.state.name + ' still leads by ' + money(-result.cashLead);
		}
		if (result.dominant) {
			return lead + ' and ' + plural(result.deliveryLead, 'delivery');
		}
		return lead + ' · ' + R.world.findPadById(result.behindPadId).name + ' needs ' +
			plural(result.behindBy, 'more delivery') +
			(result.padsBehind > 1 ? ' · ' + plural(result.padsBehind - 1, 'more pad') + ' behind' : '');
	}

	function padIdByName(name) {
		var pads = R.world.pads;
		var i;

		for (i = 0; i < pads.length; i += 1) {
			if (pads[i].name === name) {
				return pads[i].id;
			}
		}
		return '';
	}

	// One measure per milestone kind: the number compared with `target`.
	var measures = {
		deliveries: function(state) {
			return state.deliveries;
		},
		contracts: function(state) {
			return state.contractsDelivered;
		},
		contractTo: function(state, milestone) {
			return state.contractsToPad[padIdByName(milestone.padName)] || 0;
		},
		fragile: function(state) {
			return state.fragileDelivered;
		},
		cargoKg: function(state) {
			return Math.floor(state.cargoKg);
		},
		netCash: function() {
			return Math.max(0, Math.floor(R.game.cash - R.constants.economy.startingCash));
		},
		// Reputation alone is not reliability: until the clean run is long
		// enough the measure stops one short of the target.
		reputationClean: function(state, milestone) {
			var reputation = R.operations.state.playerStats.reputation;

			return state.cleanLegs >= milestone.cleanLegs ? reputation : Math.min(reputation, milestone.target - 1);
		},
		dominant: function() {
			return campaign.standing().dominant ? 1 : 0;
		}
	};

	var units = {
		deliveries: 'delivered',
		contracts: 'contracts',
		contractTo: 'contracts',
		fragile: 'fragile contracts',
		cargoKg: 'kg delivered'
	};

	var progressTexts = {
		netCash: function(state, milestone) {
			return money(measures.netCash()) + ' / ' + money(milestone.target) + ' above opening cash';
		},
		reputationClean: function(state, milestone) {
			return 'REP ' + R.operations.state.playerStats.reputation + ' / ' + milestone.target + ' · ' +
				Math.min(state.cleanLegs, milestone.cleanLegs) + ' / ' + milestone.cleanLegs + ' clean legs';
		},
		dominant: standingText
	};

	// A task is flown on purpose: its count starts when its milestone becomes
	// active. The other measures are company totals and may already be met.
	var tasks = { contracts: true, contractTo: true, fragile: true };

	function activate(state) {
		var milestone = campaign.activeMilestone();

		state.taskBase = milestone && tasks[milestone.kind] ? measures[milestone.kind](state, milestone) : 0;
	}

	// Progress of the active milestone, the only one that is measured.
	campaign.progress = function() {
		var milestone = campaign.activeMilestone();

		return measures[milestone.kind](campaign.state, milestone) - campaign.state.taskBase;
	};

	campaign.progressText = function() {
		var milestone = campaign.activeMilestone();
		var describe = progressTexts[milestone.kind];

		if (describe) {
			return describe(campaign.state, milestone);
		}
		return Math.min(campaign.progress(), milestone.target) + ' / ' + milestone.target + ' ' + units[milestone.kind];
	};

	function unlockText(unlockId) {
		var parts = unlockId.split(':');

		if (parts[0] === 'world') {
			return R.planets.findById(parts[1]).name + ' opened';
		}
		return R.autopilot.profileById(parts[1]).label + ' profile unlocked';
	}

	campaign.rewardText = function(milestone) {
		var reward = milestone.reward;
		var parts = [];

		if (reward.cash) {
			parts.push(money(reward.cash) + ' grant');
		}
		if (reward.unlock) {
			parts.push(unlockText(reward.unlock));
		}
		if (reward.rivalNotice) {
			parts.push(R.competitor.state.name + ' takes notice');
		}
		if (milestone.kind === 'dominant') {
			parts.push('Dominant courier of ' + R.world.planet.name);
		}
		return parts.join(' · ');
	};

	// What the settlement card and the world menu quote: the standing at the
	// moment the world was won.
	function settle(state) {
		var result = campaign.standing();

		return {
			cashLead: Math.round(result.cashLead),
			deliveries: R.operations.state.playerStats.deliveries,
			deliveryLead: result.deliveryLead,
			reputation: R.operations.state.playerStats.reputation,
			legs: state.legs
		};
	}

	function award(state, milestone) {
		var record = campaign.record;
		var reward = milestone.reward;
		var settlement = null;

		// The standing is taken before a grant could flatter it.
		if (milestone.kind === 'dominant') {
			settlement = settle(state);
			record.settlements[state.planetId] = settlement;
		}
		if (reward.cash) {
			R.economy.earn(R.game, 'grant', reward.cash);
		}
		if (reward.unlock) {
			record.unlocks[reward.unlock] = true;
		}
		if (reward.rivalNotice) {
			R.competitor.state.noticed = true;
		}
		record.completed[completedKey(state.planetId, milestone.id)] = true;
		return {
			milestone: milestone,
			number: state.activeIndex + 1,
			rewardText: campaign.rewardText(milestone),
			settlement: settlement,
			arcComplete: !!settlement && campaign.arcComplete()
		};
	}

	// Counts the leg and says whether it delivered. A crash or lost cargo ends
	// the clean run; a safe landing at the wrong pad neither counts nor breaks it.
	function countLeg(state, result) {
		var delivered = result.status === 'delivered';
		var failed = result.status === 'crashed' || result.cargoLost;

		state.legs += 1;
		state.cleanLegs = failed ? 0 : state.cleanLegs + 1;
		if (!delivered) {
			return false;
		}
		state.deliveries += 1;
		state.cargoKg += result.payloadMass * (1 - result.payloadDamage);
		if (!result.contractId) {
			return true;
		}
		state.contractsDelivered += 1;
		state.fragileDelivered += result.fragile ? 1 : 0;
		state.contractsToPad[result.targetPadId] = (state.contractsToPad[result.targetPadId] || 0) + 1;
		return true;
	}

	// Runs on the deck after the leg and the rival's turn have settled. Only a
	// delivered leg can clear a milestone; one that clears may clear the next
	// if its measure was already met. Returns the awards, oldest first.
	campaign.onLegSettled = function(result) {
		var state = campaign.state;
		var awards = [];
		var delivered = countLeg(state, result);
		var milestone = campaign.activeMilestone();

		campaign.record.reputation = R.operations.state.playerStats.reputation;
		while (delivered && milestone && campaign.progress() >= milestone.target) {
			awards.push(award(state, milestone));
			state.activeIndex += 1;
			activate(state);
			milestone = campaign.activeMilestone();
		}
		campaign.save();
		return awards;
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = campaign;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
