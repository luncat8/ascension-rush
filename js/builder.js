(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var builder = R.builder || (R.builder = {});
	var settings = R.constants.rocket;
	var partSettings = R.constants.parts;
	var stageSlots = 3;
	var ui = {};
	var stageFuelInputs = [null, null, null];
	var stageStrengthInputs = [null, null, null];
	var stageEngineInputs = [null, null, null];
	var stageTankInputs = [null, null, null];
	var stageFairingInputs = [null, null, null];
	var stageCards = [null, null, null];
	var stageFuelValues = [null, null, null];
	var stageStrengthValues = [null, null, null];
	var i;

	// The workshop edits an immutable rocket type and builds fleet instances of
	// it. It makes no scheduling decision: where a rocket flies is the dispatch
	// form's and the routes' business.
	builder.draft = {
		id: null,
		name: '',
		stageCount: 3,
		nominalPayload: settings.defaultPayloadMass,
		stages: [
			{ fuelMass: settings.defaultStageFuel[0], strength: settings.defaultStageStrength[0], engineId: partSettings.defaultEngineId, tankId: partSettings.defaultTankId, fairingId: null },
			{ fuelMass: settings.defaultStageFuel[1], strength: settings.defaultStageStrength[1], engineId: partSettings.defaultEngineId, tankId: partSettings.defaultTankId, fairingId: null },
			{ fuelMass: settings.defaultStageFuel[2], strength: settings.defaultStageStrength[2], engineId: partSettings.defaultEngineId, tankId: partSettings.defaultTankId, fairingId: null }
		]
	};
	builder.initialized = false;
	builder.padId = null;
	builder.lastPlanetId = null;

	function getElement(id) {
		return root.document.getElementById(id);
	}

	function formatMass(value) {
		return Math.round(value).toLocaleString('en-US');
	}

	// Fill a part picker from a catalog table; fairings get a leading "None".
	function populatePartSelect(select, list, includeNone) {
		var option;
		var k;

		select.textContent = '';
		if (includeNone) {
			option = root.document.createElement('option');
			option.value = '';
			option.textContent = 'None';
			select.appendChild(option);
		}
		for (k = 0; k < list.length; k += 1) {
			option = root.document.createElement('option');
			option.value = list[k].id;
			option.textContent = list[k].label;
			select.appendChild(option);
		}
	}

	// A planet switch loads that world's reference build into the draft: fuel
	// masses and payload that its gravity and air can actually lift.
	function applyPlanetDefaults() {
		var planet = R.world.planet;
		var fuel = planet.defaultFuel || settings.defaultStageFuel;
		var j;

		builder.draft.id = null;
		builder.draft.name = planet.name + ' custom';
		builder.draft.stageCount = fuel.length;
		builder.draft.nominalPayload = planet.defaultPayload || settings.defaultPayloadMass;
		for (j = 0; j < stageSlots; j += 1) {
		builder.draft.stages[j].fuelMass = fuel[j] || settings.minFuelMass;
		builder.draft.stages[j].strength = settings.defaultStageStrength[j];
		builder.draft.stages[j].engineId = partSettings.defaultEngineId;
		builder.draft.stages[j].tankId = partSettings.defaultTankId;
		builder.draft.stages[j].fairingId = null;
		}
	}

	function loadType(type) {
		var j;

		builder.draft.id = type.id;
		builder.draft.name = type.name;
		builder.draft.stageCount = type.stageCount;
		builder.draft.nominalPayload = type.nominalPayload;
		for (j = 0; j < stageSlots; j += 1) {
		builder.draft.stages[j].fuelMass = j < type.stageCount ? type.stages[j].fuelMass : settings.minFuelMass;
		builder.draft.stages[j].strength = j < type.stageCount ? type.stages[j].strength : settings.defaultStageStrength[j];
		builder.draft.stages[j].engineId = j < type.stageCount ? type.stages[j].engineId : partSettings.defaultEngineId;
		builder.draft.stages[j].tankId = j < type.stageCount ? type.stages[j].tankId : partSettings.defaultTankId;
		builder.draft.stages[j].fairingId = j < type.stageCount ? type.stages[j].fairingId : null;
		}
	}

	function readInputs() {
		var j;

		builder.draft.name = ui.name.value.trim() || builder.draft.name;
		builder.draft.stageCount = Number(ui.stageCount.value);
		builder.draft.nominalPayload = Number(ui.payload.value);
		for (j = 0; j < stageSlots; j += 1) {
			builder.draft.stages[j].fuelMass = Number(stageFuelInputs[j].value);
			builder.draft.stages[j].strength = Number(stageStrengthInputs[j].value);
			builder.draft.stages[j].engineId = stageEngineInputs[j].value;
			builder.draft.stages[j].tankId = stageTankInputs[j].value;
			builder.draft.stages[j].fairingId = stageFairingInputs[j].disabled ? null : stageFairingInputs[j].value;
		}
	}

	function fleetLine() {
		var fleet = R.operations.state.fleet;
		var count = 0;
		var ready = 0;
		var j;

		for (j = 0; j < fleet.length; j += 1) {
			if (fleet[j].typeId !== builder.draft.id) {
				continue;
			}
			count += 1;
			ready += fleet[j].status === 'available' ? 1 : 0;
		}
		return count === 0 ? 'No rockets of this type built yet.' :
			count + ' built · ' + ready + ' available';
	}

	function update() {
		var stats;
		var capacity;
		var estimatedCost;
		var warning = '';
		var stage;
		var j;

		if (!builder.initialized) {
			return;
		}
		stats = R.operations.typeStats(builder.draft);
		capacity = Math.floor(stats.payloadLimit);
		ui.payload.max = String(capacity);
		if (builder.draft.nominalPayload > capacity) {
			builder.draft.nominalPayload = capacity;
			ui.payload.value = String(capacity);
			stats = R.operations.typeStats(builder.draft);
		}
		ui.payloadValue.textContent = formatMass(builder.draft.nominalPayload) + ' kg';
		var topStage = builder.draft.stageCount - 1;
		var structureEngine = 0;
		var structureTank = 0;
		var structureFairing = 0;
		var breakdown;
		for (j = 0; j < stageSlots; j += 1) {
			stage = builder.draft.stages[j];
			stageCards[j].hidden = j >= builder.draft.stageCount;
			stageFuelValues[j].textContent = formatMass(stage.fuelMass) + ' kg';
			stageStrengthValues[j].textContent = Math.round(stage.strength * 100) + '%';
			// A fairing rides the top stage only; every other stage is barred from
			// carrying one, and any it had is cleared so it cannot hide a mass.
			if (stageFairingInputs[j]) {
				var isTop = j === topStage;
				stageFairingInputs[j].disabled = !isTop;
				if (!isTop && stage.fairingId) {
					stage.fairingId = null;
					stageFairingInputs[j].value = '';
				}
			}
			breakdown = R.parts.stageBreakdown(stage);
			structureEngine += breakdown.engineMass;
			structureTank += breakdown.tankMass;
			structureFairing += breakdown.fairingMass;
		}

		estimatedCost = R.parts.typeBuildCost(builder.draft, builder.padId);
		ui.structureDetail.textContent = 'Engines ' + formatMass(structureEngine) + ' kg · Tanks ' +
			formatMass(structureTank) + ' kg' + (structureFairing > 0 ? ' · Fairing ' + formatMass(structureFairing) + ' kg' : '');
		ui.mass.textContent = formatMass(stats.totalMass);
		ui.steel.textContent = formatMass(stats.dryMass);
		ui.fuel.textContent = formatMass(stats.fuelMass);
		ui.deltaV.textContent = formatMass(stats.deltaV);
		ui.twr.textContent = R.operations.typeTwr(builder.draft, builder.draft.nominalPayload).toFixed(2) + ' : 1';
		ui.capacity.textContent = formatMass(capacity);
		ui.cost.textContent = formatMass(estimatedCost);
		ui.fleet.textContent = fleetLine();
		ui.title.textContent = builder.draft.id ? 'Edit rocket type' : 'New rocket type';
		ui.buildPad.textContent = builder.padId ? R.world.findPadById(builder.padId).name : '';
		ui.build.hidden = !builder.padId;
		ui.saveLabel.textContent = builder.draft.id ? 'Save changes to type' : 'Save as new rocket type';

		if (R.operations.typeTwr(builder.draft, builder.draft.nominalPayload) < settings.minimumLaunchTwr) {
			warning = 'Not enough lift: add booster fuel or reduce the design payload.';
		} else if (R.game && R.game.cash < estimatedCost) {
			warning = 'A new rocket of this type needs $' + formatMass(estimatedCost) + '.';
		} else {
			for (j = 0; j < builder.draft.stageCount; j += 1) {
				if (builder.draft.stages[j].strength < 0.7) {
					warning = 'Light structure: less mass, more risk once wear arrives.';
					break;
				}
			}
		}
		ui.warning.textContent = warning;
		ui.build.disabled = !builder.padId || R.game.cash < estimatedCost;
	}

	// Inputs are read on the way in, never on the way out: a draft loaded from a
	// type or a planet default must survive the first repaint.
	function onInput() {
		readInputs();
		update();
	}

	function onSave() {
		var type;
		var result;

		readInputs();
		if (builder.draft.id) {
			result = R.operations.saveType(builder.draft.id, builder.draft);
			if (!result.ok) {
				ui.warning.textContent = result.reason;
				return false;
			}
			type = result.type;
			R.deck.announce('Rocket type ' + type.name + ' updated.');
		} else {
			type = R.operations.addType({
				name: builder.draft.name,
				stageCount: builder.draft.stageCount,
				stages: builder.draft.stages,
				nominalPayload: builder.draft.nominalPayload,
				defaultProfileId: R.autopilot.profileId
			});
			builder.draft.id = type.id;
			R.deck.announce('Rocket type ' + type.name + ' saved.');
		}
		update();
		return true;
	}

	function onBuild() {
		var result;

		if (!builder.padId) {
			return;
		}
		if (!onSave()) {
			return;
		}
		result = R.operations.buildRocket(builder.draft.id, builder.padId);
		if (!result.ok) {
			ui.warning.textContent = result.reason;
			return;
		}
		R.deck.announce('Rocket built at ' + R.world.findPadById(builder.padId).name + ' for $' + formatMass(result.cost) + '.');
		update();
	}

	builder.open = function(game, options) {
		if (!builder.initialized) {
			return;
		}
		builder.padId = options && options.padId ? options.padId : null;
		if (options && options.typeId) {
			loadType(R.operations.findType(options.typeId));
		} else if (builder.lastPlanetId !== R.world.planet.id) {
			applyPlanetDefaults();
		}
		builder.lastPlanetId = R.world.planet.id;
		ui.name.value = builder.draft.name;
		ui.stageCount.value = String(builder.draft.stageCount);
		ui.payload.value = String(builder.draft.nominalPayload);
		for (i = 0; i < stageSlots; i += 1) {
			stageFuelInputs[i].value = String(builder.draft.stages[i].fuelMass);
			stageStrengthInputs[i].value = String(builder.draft.stages[i].strength);
			stageEngineInputs[i].value = builder.draft.stages[i].engineId || partSettings.defaultEngineId;
			stageTankInputs[i].value = builder.draft.stages[i].tankId || partSettings.defaultTankId;
			stageFairingInputs[i].value = builder.draft.stages[i].fairingId || '';
		}
		update();
		R.deck.showDialog('workshop');
	};

	builder.initialize = function(game) {
		if (!root.document || !root.document.getElementById) {
			return;
		}

		ui.panel = getElement('workshop');
		if (!ui.panel) {
			return;
		}
		ui.title = getElement('workshop-title');
		ui.close = getElement('workshop-close');
		ui.name = getElement('workshop-name');
		ui.stageCount = getElement('workshop-stage-count');
		ui.payload = getElement('workshop-payload');
		ui.payloadValue = getElement('workshop-payload-value');
		ui.mass = getElement('workshop-mass');
		ui.steel = getElement('workshop-steel');
		ui.fuel = getElement('workshop-fuel');
		ui.deltaV = getElement('workshop-dv');
		ui.twr = getElement('workshop-twr');
		ui.capacity = getElement('workshop-capacity');
		ui.cost = getElement('workshop-cost');
		ui.structureDetail = getElement('workshop-structure-detail');
		ui.fleet = getElement('workshop-fleet');
		ui.warning = getElement('workshop-warning');
		ui.save = getElement('workshop-save');
		ui.saveLabel = getElement('workshop-save-label');
		ui.build = getElement('workshop-build');
		ui.buildPad = getElement('workshop-build-pad');

		for (i = 0; i < stageSlots; i += 1) {
			stageCards[i] = getElement('builder-stage-' + i);
			stageFuelInputs[i] = getElement('builder-fuel-' + i);
			stageFuelInputs[i].min = String(settings.minFuelMass);
			stageFuelInputs[i].max = String(settings.maxFuelMass);
			stageStrengthInputs[i] = getElement('builder-strength-' + i);
			stageFuelValues[i] = getElement('builder-fuel-value-' + i);
			stageStrengthValues[i] = getElement('builder-strength-value-' + i);
			stageEngineInputs[i] = getElement('builder-engine-' + i);
			stageTankInputs[i] = getElement('builder-tank-' + i);
			stageFairingInputs[i] = getElement('builder-fairing-' + i);
			populatePartSelect(stageEngineInputs[i], partSettings.engines, false);
			populatePartSelect(stageTankInputs[i], partSettings.tanks, false);
			populatePartSelect(stageFairingInputs[i], partSettings.fairings, true);
			stageFuelInputs[i].addEventListener('input', onInput);
			stageStrengthInputs[i].addEventListener('input', onInput);
			stageEngineInputs[i].addEventListener('change', onInput);
			stageTankInputs[i].addEventListener('change', onInput);
			stageFairingInputs[i].addEventListener('change', onInput);
		}

		ui.close.addEventListener('click', function() {
			R.deck.hideDialog();
		});
		ui.save.addEventListener('click', onSave);
		ui.build.addEventListener('click', onBuild);
		ui.name.addEventListener('input', onInput);
		ui.stageCount.addEventListener('change', onInput);
		ui.payload.addEventListener('input', onInput);

		builder.initialized = true;
		builder.lastPlanetId = R.world.planet.id;
		applyPlanetDefaults();
	};

	builder.refresh = function(game) {
		if (!builder.initialized) {
			return;
		}
		if (builder.lastPlanetId !== R.world.planet.id) {
			applyPlanetDefaults();
			builder.lastPlanetId = R.world.planet.id;
		}
		update();
	};

	builder.update = function() {
		update();
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = builder;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
