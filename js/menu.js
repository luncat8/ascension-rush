(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var menu = R.menu || (R.menu = {});

	var ui = {};
	// Starting over erases the whole campaign, so the button asks twice.
	var resetArmed = false;

	function statLine(planet) {
		return Math.round(planet.circumference / 100) / 10 + ' km around · g ' + planet.surfaceGravity +
			' m/s² · air ' + planet.seaLevelDensity + ' kg/m³ · $' + planet.prices.delivery + '/kg delivered';
	}

	// Where the company stands on a world: locked behind a named milestone,
	// part-way up its ladder, or won.
	function campaignLine(preset) {
		var settlement = R.campaign.settlement(preset.id);

		if (!R.campaign.worldUnlocked(preset.id)) {
			return 'LOCKED · CLEAR ' + R.campaign.unlockSource('world:' + preset.id).toUpperCase();
		}
		if (settlement) {
			return 'DOMINANT COURIER · WON BY ' + R.util.money(settlement.cashLead);
		}
		return R.campaign.completedCount(preset.id) + ' / ' + R.campaign.ladderOf(preset.id).length + ' MILESTONES';
	}

	function buildCard(preset) {
		var card = root.document.createElement('button');
		var title = root.document.createElement('strong');
		var status = root.document.createElement('b');
		var description = root.document.createElement('span');
		var stats = root.document.createElement('em');
		var unlocked = R.campaign.worldUnlocked(preset.id);

		card.type = 'button';
		card.className = 'planet-card';
		card.dataset.planetId = preset.id;
		card.disabled = !unlocked;
		if (preset.id === R.world.planet.id) {
			card.classList.add('is-current');
		}
		if (!unlocked) {
			card.classList.add('is-locked');
		}
		if (R.campaign.settlement(preset.id)) {
			card.classList.add('is-dominant');
		}
		title.textContent = preset.name;
		status.textContent = campaignLine(preset);
		description.textContent = preset.description;
		stats.textContent = statLine(preset);
		card.appendChild(title);
		card.appendChild(status);
		card.appendChild(description);
		card.appendChild(stats);
		card.addEventListener('click', function() {
			menu.selectWorld(preset.id);
		});
		return card;
	}

	function campaignNote() {
		var list = R.planets.list;
		var won = 0;
		var i;

		for (i = 0; i < list.length; i += 1) {
			won += R.campaign.settlement(list[i].id) ? 1 : 0;
		}
		if (won === list.length) {
			return 'Campaign complete: dominant courier on every world. All of them are open for free play.';
		}
		return 'Campaign: dominant courier on ' + won + ' of ' + list.length + ' worlds. A world opens when the one ' +
			'before it clears its Long-reach milestone; reputation travels with the company, cash and fleet do not.';
	}

	function build() {
		var list = R.planets.list;
		var i;

		ui.list.innerHTML = '';
		for (i = 0; i < list.length; i += 1) {
			ui.list.appendChild(buildCard(list[i]));
		}
		ui.campaign.textContent = campaignNote();
		ui.reset.textContent = resetArmed ? 'Erase all campaign progress?' : 'Start a new campaign';
	}

	// The gate is here as well as on the card: a world the campaign has not
	// opened cannot be started, however the request arrives.
	menu.selectWorld = function(planetId) {
		if (!R.campaign.worldUnlocked(planetId)) {
			return false;
		}
		menu.hide();
		R.main.restart(planetId);
		return true;
	};

	menu.newCampaign = function() {
		R.campaign.reset();
		menu.hide();
		R.main.restart(R.planets.defaultId);
	};

	menu.show = function() {
		if (!ui.panel) {
			return;
		}
		resetArmed = false;
		build();
		ui.panel.hidden = false;
		// A world picker is a modal too: automation must not launch behind it.
		R.operations.blocked = true;
	};

	menu.hide = function() {
		if (ui.panel) {
			ui.panel.hidden = true;
		}
		if (!R.deck.dialog) {
			R.operations.blocked = false;
		}
	};

	function onReset() {
		if (resetArmed) {
			menu.newCampaign();
			return;
		}
		resetArmed = true;
		build();
	}

	menu.initialize = function() {
		if (!root.document || !root.document.getElementById) {
			return false;
		}
		ui.panel = root.document.getElementById('planet-menu');
		ui.list = root.document.getElementById('planet-list');
		if (!ui.panel || !ui.list) {
			return false;
		}
		ui.campaign = root.document.getElementById('planet-menu-campaign');
		ui.reset = root.document.getElementById('planet-menu-reset');
		ui.reset.addEventListener('click', onReset);
		root.document.getElementById('planet-menu-close').addEventListener('click', menu.hide);
		menu.show();
		return true;
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = menu;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
