(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var menu = R.menu || (R.menu = {});

	var ui = {};

	function statLine(planet) {
		return Math.round(planet.circumference / 100) / 10 + ' km around · g ' + planet.surfaceGravity +
			' m/s² · air ' + planet.seaLevelDensity + ' kg/m³ · $' + planet.prices.delivery + '/kg delivered';
	}

	function buildCard(preset) {
		var card = root.document.createElement('button');
		var title = root.document.createElement('strong');
		var description = root.document.createElement('span');
		var stats = root.document.createElement('em');

		card.type = 'button';
		card.className = 'planet-card';
		card.dataset.planetId = preset.id;
		if (preset.id === R.world.planet.id) {
			card.classList.add('is-current');
		}
		title.textContent = preset.name;
		description.textContent = preset.description;
		stats.textContent = statLine(preset);
		card.appendChild(title);
		card.appendChild(description);
		card.appendChild(stats);
		card.addEventListener('click', function() {
			menu.pick(preset.id);
		});
		return card;
	}

	function build() {
		var list = R.planets.list;
		var i;

		ui.list.innerHTML = '';
		for (i = 0; i < list.length; i += 1) {
			ui.list.appendChild(buildCard(list[i]));
		}
	}

	menu.pick = function(planetId) {
		menu.hide();
		R.main.restart(planetId);
	};

	menu.show = function() {
		if (!ui.panel) {
			return;
		}
		build();
		ui.panel.hidden = false;
	};

	menu.hide = function() {
		if (ui.panel) {
			ui.panel.hidden = true;
		}
	};

	menu.initialize = function() {
		if (!root.document || !root.document.getElementById) {
			return false;
		}
		ui.panel = root.document.getElementById('planet-menu');
		ui.list = root.document.getElementById('planet-list');
		if (!ui.panel || !ui.list) {
			return false;
		}
		ui.close = root.document.getElementById('planet-menu-close');
		if (ui.close) {
			ui.close.addEventListener('click', menu.hide);
		}
		menu.show();
		return true;
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = menu;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
