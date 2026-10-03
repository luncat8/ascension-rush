(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var builder = R.builder || (R.builder = {});
	var settings = R.constants.rocket;
	var ui = {};
	var stageFuelInputs = [null, null, null];
	var stageStrengthInputs = [null, null, null];
	var stageCards = [null, null, null];
	var stageFuelValues = [null, null, null];
	var stageStrengthValues = [null, null, null];
	var stats = R.rocket.createStats();
	var i;

	builder.config = {
		targetPadId: '',
		stageCount: 3,
		payloadMass: settings.defaultPayloadMass,
		stages: [
			{ fuelMass: settings.defaultStageFuel[0], strength: settings.defaultStageStrength[0] },
			{ fuelMass: settings.defaultStageFuel[1], strength: settings.defaultStageStrength[1] },
			{ fuelMass: settings.defaultStageFuel[2], strength: settings.defaultStageStrength[2] }
		]
	};
	builder.initialized = false;
	builder.lastCurrentPadId = null;
	builder.lastPlanetId = null;

	function getElement(id) {
		return root.document.getElementById(id);
	}

	function formatMass(value) {
		return Math.round(value).toLocaleString('en-US');
	}

	function formatMoney(value) {
		return Math.round(value).toLocaleString('en-US');
	}

	function hasTarget(padId, currentPadId) {
		var pads = R.world.pads;
		var i;

		for (i = 0; i < pads.length; i += 1) {
			if (pads[i].id === padId && pads[i].id !== currentPadId) {
				return true;
			}
		}
		return false;
	}

	function populateProfiles() {
		var profiles = R.constants.autopilotProfiles;
		var option;
		var i;

		ui.profile.innerHTML = '';
		for (i = 0; i < profiles.length; i += 1) {
			option = root.document.createElement('option');
			option.value = profiles[i].id;
			option.textContent = profiles[i].label;
			ui.profile.appendChild(option);
		}
	}

	function showProfile() {
		ui.profile.value = R.autopilot.profileId;
		ui.profileHint.textContent = R.autopilot.profileById(R.autopilot.profileId).description;
	}

	function populateTargets(game) {
		var pads = R.world.pads;
		var source = R.world.findPadById(game.currentPadId);
		var option;
		var selectedId = builder.config.targetPadId;
		var distance;
		var i;

		ui.target.innerHTML = '';
		for (i = 0; i < pads.length; i += 1) {
			if (pads[i].id === game.currentPadId) {
				continue;
			}
			distance = Math.abs(R.util.wrapDelta(pads[i].wx - source.wx, R.world.planet.circumference));
			option = root.document.createElement('option');
			option.value = pads[i].id;
			option.textContent = pads[i].name + ' · ' + (Math.round(distance / 100) / 10) + ' km';
			ui.target.appendChild(option);
		}

		if (!hasTarget(selectedId, game.currentPadId)) {
			selectedId = ui.target.options.length ? ui.target.options[0].value : '';
		}
		ui.target.value = selectedId;
		builder.config.targetPadId = selectedId;
		builder.lastCurrentPadId = game.currentPadId;
		builder.lastPlanetId = R.world.planet.id;
	}

	// A planet switch loads that world's reference build: fuel masses and
	// payload that its gravity and air can actually lift.
	function applyPlanetDefaults() {
		var planet = R.world.planet;
		var fuel = planet.defaultFuel || settings.defaultStageFuel;
		var j;

		builder.config.payloadMass = planet.defaultPayload || settings.defaultPayloadMass;
		for (j = 0; j < 3; j += 1) {
			builder.config.stages[j].fuelMass = fuel[j];
		}
		if (builder.initialized) {
			ui.payload.value = String(builder.config.payloadMass);
			for (j = 0; j < 3; j += 1) {
				stageFuelInputs[j].value = String(fuel[j]);
			}
		}
	}

	function readInputs(game) {
		var stage;
		var j;

		builder.config.targetPadId = ui.target.value;
		builder.config.stageCount = Number(ui.stageCount.value);
		builder.config.payloadMass = Number(ui.payload.value);
		for (j = 0; j < 3; j += 1) {
			stage = builder.config.stages[j];
			stage.fuelMass = Number(stageFuelInputs[j].value);
			stage.strength = Number(stageStrengthInputs[j].value);
		}
		game.targetPadId = builder.config.targetPadId;
	}

	function update(game) {
		var target = hasTarget(builder.config.targetPadId, game.currentPadId);
		var estimatedCost;
		var maximumPayload;
		var warning = '';
		var stage;
		var j;

		ui.panel.hidden = game.phase !== 'building';
		ui.cash.textContent = formatMoney(game.cash);
		if (ui.planetName) {
			ui.planetName.textContent = R.world.planet.name;
		}
		if (ui.autopilot) {
			ui.autopilot.checked = R.autopilot.enabled;
		}
		showProfile();
		ui.report.hidden = !game.lastReport;
		if (game.lastReport) {
			ui.reportTitle.textContent = game.lastReport.title;
			ui.reportDetail.textContent = game.lastReport.detail;
			ui.report.dataset.status = game.lastReport.status;
		} else {
			ui.report.removeAttribute('data-status');
		}

		R.rocket.evaluateBuild(builder.config, stats);
		maximumPayload = Math.floor(stats.payloadLimit / 10) * 10;
		ui.payload.max = String(maximumPayload);
		if (builder.config.payloadMass > maximumPayload) {
			builder.config.payloadMass = maximumPayload;
			ui.payload.value = String(maximumPayload);
			R.rocket.evaluateBuild(builder.config, stats);
		}
		ui.payloadValue.textContent = formatMass(builder.config.payloadMass) + ' kg';

		for (j = 0; j < 3; j += 1) {
			stage = builder.config.stages[j];
			stageCards[j].hidden = j >= builder.config.stageCount;
			stageFuelValues[j].textContent = formatMass(stage.fuelMass) + ' kg';
			stageStrengthValues[j].textContent = Math.round(stage.strength * 100) + '%';
		}

		estimatedCost = R.economy.estimateBuildCost(stats);
		ui.mass.textContent = formatMass(stats.totalMass);
		ui.steel.textContent = formatMass(stats.dryMass);
		ui.fuel.textContent = formatMass(stats.fuelMass);
		ui.deltaV.textContent = formatMass(stats.deltaV);
		ui.twr.textContent = stats.twr.toFixed(2) + ' : 1';
		ui.cost.textContent = formatMoney(estimatedCost);
		ui.stageCount.value = String(builder.config.stageCount);
		ui.target.value = builder.config.targetPadId;
		game.targetPadId = builder.config.targetPadId;

		if (stats.twr < settings.minimumLaunchTwr) {
			warning = 'Not enough lift: add booster fuel or reduce payload.';
		} else if (!target) {
			warning = 'Choose a destination pad different from your current pad.';
		} else if (game.cash < estimatedCost) {
			warning = 'Insufficient funds for this build and its full fuel load.';
		} else {
			for (j = 0; j < builder.config.stageCount; j += 1) {
				if (builder.config.stages[j].strength < 0.7) {
					warning = 'Light structure: reduced mass, but future failure risk is higher.';
					break;
				}
			}
		}
		ui.warning.textContent = warning;
		ui.launch.disabled = game.phase !== 'building' || !target || stats.twr < settings.minimumLaunchTwr || game.cash < estimatedCost;
	}

	function onInput() {
		if (!builder.initialized || !R.game) {
			return;
		}
		readInputs(R.game);
		update(R.game);
	}

	function onLaunch() {
		if (!builder.initialized || !R.game) {
			return;
		}
		readInputs(R.game);
		if (!R.mission.launch(R.game, builder.config)) {
			update(R.game);
			return;
		}
		ui.launch.blur();
		R.input.pointerActive = false;
		update(R.game);
	}

	builder.initialize = function(game) {
		if (!root.document || !root.document.getElementById) {
			return;
		}

		ui.panel = getElement('builder-panel');
		if (!ui.panel) {
			return;
		}
		ui.target = getElement('builder-target');
		ui.stageCount = getElement('builder-stage-count');
		ui.payload = getElement('builder-payload');
		ui.payloadValue = getElement('builder-payload-value');
		ui.cash = getElement('builder-cash');
		ui.report = getElement('builder-report');
		ui.reportTitle = getElement('builder-report-title');
		ui.reportDetail = getElement('builder-report-detail');
		ui.mass = getElement('builder-mass');
		ui.steel = getElement('builder-steel');
		ui.fuel = getElement('builder-fuel');
		ui.deltaV = getElement('builder-dv');
		ui.twr = getElement('builder-twr');
		ui.cost = getElement('builder-cost');
		ui.warning = getElement('builder-warning');
		ui.launch = getElement('launch-button');
		ui.planetName = getElement('builder-planet-name');
		ui.planetButton = getElement('builder-planet-button');
		ui.autopilot = getElement('builder-autopilot');
		ui.profile = getElement('builder-autopilot-profile');
		ui.profileHint = getElement('builder-autopilot-profile-hint');
		populateProfiles();

		for (i = 0; i < 3; i += 1) {
			stageCards[i] = getElement('builder-stage-' + i);
			stageFuelInputs[i] = getElement('builder-fuel-' + i);
			stageFuelInputs[i].min = String(settings.minFuelMass);
			stageFuelInputs[i].max = String(settings.maxFuelMass);
			stageFuelInputs[i].value = String(builder.config.stages[i].fuelMass);
			stageStrengthInputs[i] = getElement('builder-strength-' + i);
			stageStrengthInputs[i].value = String(builder.config.stages[i].strength);
			stageFuelValues[i] = getElement('builder-fuel-value-' + i);
			stageStrengthValues[i] = getElement('builder-strength-value-' + i);
		}

		if (ui.planetButton) {
			ui.planetButton.addEventListener('click', function() {
				R.menu.show();
			});
		}
		if (ui.autopilot) {
			ui.autopilot.addEventListener('change', function() {
				R.autopilot.setEnabled(ui.autopilot.checked);
			});
		}
		ui.profile.addEventListener('change', function() {
			R.autopilot.setProfile(ui.profile.value);
			showProfile();
		});
		ui.target.addEventListener('change', onInput);
		ui.stageCount.addEventListener('change', onInput);
		ui.payload.addEventListener('input', onInput);
		ui.launch.addEventListener('click', onLaunch);
		for (i = 0; i < 3; i += 1) {
			stageFuelInputs[i].addEventListener('input', onInput);
			stageStrengthInputs[i].addEventListener('input', onInput);
		}

		ui.stageCount.value = String(builder.config.stageCount);
		ui.payload.value = String(builder.config.payloadMass);
		builder.initialized = true;
		builder.lastCurrentPadId = null;
		builder.lastPlanetId = null;
		builder.config.targetPadId = game.targetPadId;
		builder.refresh(game);
	};

	builder.refresh = function(game) {
		if (!builder.initialized) {
			return;
		}
		if (builder.lastPlanetId !== R.world.planet.id) {
			applyPlanetDefaults();
			populateTargets(game);
		} else if (builder.lastCurrentPadId !== game.currentPadId) {
			populateTargets(game);
		}
		update(game);
	};

	builder.update = function(game) {
		if (builder.initialized) {
			update(game);
		}
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = builder;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
