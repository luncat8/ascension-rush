(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var campaign = R.campaign || (R.campaign = {});
	var settings = R.constants.campaign;

	campaign.state = null;

	function ladderFor(planetId) {
		var world = settings.worlds[planetId];

		return world ? world.ladder : [];
	}

	campaign.initialize = function(carry) {
		var planetId = R.world.planet.id;
		var ladder = ladderFor(planetId);
		var reputation = settings.startReputation;
		var rivalSkillOffset = 0;
		var unlocks = {};
		var completed = {};
		var settlements = {};
		var recentLegs = [];
		var i;

		if (carry) {
			reputation = Math.min(settings.carryReputationCap, carry.reputation || reputation);
			rivalSkillOffset = carry.rivalSkillOffset || 0;
			unlocks = carry.unlocks || {};
			completed = carry.completed || {};
			settlements = carry.settlements || {};
		}
		// balanced is always unlocked; gentle is gated by milestone 2.
		unlocks['balanced-profile'] = true;
		campaign.state = {
			planetId: planetId,
			ladder: ladder,
			activeIndex: 0,
			reputationCarry: reputation,
			rivalSkillOffset: rivalSkillOffset,
			unlocks: unlocks,
			completed: completed,
			settlements: settlements,
			recentLegs: recentLegs,
			// Progress counters:
			deliveries: 0,
			contractsDelivered: 0,
			cargoKg: 0,
			cash: 0,
			padDeliveries: {},
			contractsToPad: {},
			lastAnnouncement: ''
		};
		for (i = 0; i < R.world.pads.length; i += 1) {
			campaign.state.padDeliveries[R.world.pads[i].id] = 0;
		}
		// Advance past milestones completed on earlier visits to this world.
		while (campaign.state.activeIndex < ladder.length &&
			completed[planetId + ':' + ladder[campaign.state.activeIndex].id]) {
			campaign.state.activeIndex += 1;
		}
		return campaign.state;
	};

	campaign.activeMilestone = function() {
		var state = campaign.state;

		if (!state || state.activeIndex >= state.ladder.length) {
			return null;
		}
		return state.ladder[state.activeIndex];
	};

	campaign.unlocked = function(featureId) {
		return !!(campaign.state && campaign.state.unlocks[featureId]);
	};

	campaign.isSettled = function(planetId) {
		return !!(campaign.state && campaign.state.settlements[planetId]);
	};

	campaign.carry = function() {
		var state = campaign.state;

		if (!state) {
			return null;
		}
		return {
			reputation: R.operations.state.playerStats.reputation,
			rivalSkillOffset: state.rivalSkillOffset,
			unlocks: state.unlocks,
			completed: state.completed,
			settlements: state.settlements
		};
	};

	function recordClean(state, result) {
		var recent = state.recentLegs;
		var crash = result.status === 'crashed' || result.cargoLost;

		recent.push(crash ? 'crash' : 'ok');
		while (recent.length > 10) {
			recent.shift();
		}
	}

	function cleanStreak(state, window) {
		var recent = state.recentLegs;
		var i;

		for (i = recent.length - 1; i >= Math.max(0, recent.length - window); i -= 1) {
			if (recent[i] === 'crash') {
				return recent.length - 1 - i;
			}
		}
		return Math.min(window, recent.length);
	}

	function padIdByName(name) {
		var pads = R.world.pads;
		var i;

		for (i = 0; i < pads.length; i += 1) {
			if (pads[i].name === name) {
				return pads[i].id;
			}
		}
		return null;
	}

	function progress(state, milestone) {
		var rival;
		var playerStats;
		var pads;
		var padId;
		var targetId;
		var i;

		switch (milestone.kind) {
		case 'deliveries':
			return state.deliveries;
		case 'contracts':
			return state.contractsDelivered;
		case 'contractTo':
			targetId = padIdByName(milestone.padName);
			return targetId ? (state.contractsToPad[targetId] || 0) : 0;
		case 'cargoKg':
			return Math.floor(state.cargoKg);
		case 'reputationClean':
			playerStats = R.operations.state.playerStats;
			if (playerStats.reputation >= milestone.target &&
				cleanStreak(state, milestone.cleanWindow) >= milestone.cleanWindow) {
				return milestone.target;
			}
			return Math.min(milestone.target - 1, playerStats.reputation);
		case 'dominant':
			rival = R.competitor && R.competitor.state;
			if (!rival || R.game.cash <= rival.cash) {
				return 0;
			}
			pads = R.world.pads;
			for (i = 0; i < pads.length; i += 1) {
				padId = pads[i].id;
				if (R.market.servedBy(padId, 'player') < R.market.servedBy(padId, rival.id)) {
					return 0;
				}
			}
			return 1;
		default:
			return 0;
		}
	}

	campaign.progress = function(milestone) {
		return campaign.state ? progress(campaign.state, milestone) : 0;
	};

	function applyReward(state, milestone) {
		var reward = milestone.reward || {};

		if (reward.cash) {
			R.game.cash += reward.cash;
		}
		if (reward.unlock) {
			state.unlocks[reward.unlock] = true;
		}
		if (reward.rivalNotice && R.competitor && R.competitor.state) {
			state.rivalSkillOffset += R.constants.competitor.noticedSkillGrowth;
		}
		if (reward.settlement) {
			state.settlements[reward.settlement] = true;
		}
		state.completed[state.planetId + ':' + milestone.id] = true;
	}

	function milestoneSummary(milestone, amount) {
		return milestone.title + ' — ' + Math.round(amount) + ' / ' + milestone.target;
	}

	campaign.onLegSettled = function(result) {
		var state = campaign.state;
		var deliveredKg;
		var milestone;
		var before;
		var after;
		var reward;

		if (!state) {
			return null;
		}
		recordClean(state, result);
		if (result.status === 'delivered') {
			deliveredKg = result.payloadMass * (1 - result.payloadDamage);
			state.deliveries += 1;
			state.cargoKg += deliveredKg;
			var landedAt = result.landingPadId || result.targetPadId;
			if (landedAt) {
				state.padDeliveries[landedAt] = (state.padDeliveries[landedAt] || 0) + 1;
			}
			if (result.contractId) {
				state.contractsDelivered += 1;
				if (landedAt) {
					state.contractsToPad[landedAt] = (state.contractsToPad[landedAt] || 0) + 1;
				}
			}
		}
		// Cash above starting capital; never goes negative.
		state.cash = Math.max(0, R.game.cash - R.constants.economy.startingCash);
		milestone = campaign.activeMilestone();
		if (!milestone) {
			return null;
		}
		before = progress(state, milestone);
		if (before < milestone.target) {
			return null;
		}
		after = before;
		reward = milestone.reward || {};
		applyReward(state, milestone);
		state.activeIndex += 1;
		state.lastAnnouncement = milestoneSummary(milestone, after);
		return {
			milestone: milestone,
			progress: after,
			reward: reward,
			next: campaign.activeMilestone()
		};
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = campaign;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
