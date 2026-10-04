(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var deck = R.deck || (R.deck = {});
	var doc = root.document;
	var ui = {};
	var form = {
		sourcePadId: '',
		targetPadId: '',
		mode: 'oneway',
		fuelPolicy: 'refuel',
		outboundPayload: 0,
		returnPayload: 0,
		typeId: null,
		rocketId: null,
		profileId: R.constants.autopilotProfiles[0].id,
		contractId: null,
		// Buying the overhaul a worn engine needs is the player's call on a leg
		// they are sending by hand; it is cleared whenever the rocket changes.
		overhaul: false
	};
	var review = { routeId: null, logId: null, spec: null };
	var typePickerRouteId = null;
	var lastCountdownSecond = -1;

	deck.tab = 'dispatch';
	deck.revision = -1;
	deck.phase = '';
	deck.openOverride = false;

	function el(tag, className, text) {
		var node = doc.createElement(tag);

		if (className) {
			node.className = className;
		}
		if (text !== undefined && text !== null) {
			node.textContent = text;
		}
		return node;
	}

	function on(node, type, handler) {
		if (node) {
			node.addEventListener(type, handler);
		}
	}

	function money(value) {
		return '$' + Math.round(value).toLocaleString('en-US');
	}

	function mass(value) {
		return Math.round(value).toLocaleString('en-US') + ' kg';
	}

	function distance(meters) {
		return meters < 1000 ? Math.round(meters) + ' m' : (Math.round(meters / 100) / 10) + ' km';
	}

	function margin(net, reward) {
		var value = Math.round(net / reward * 1000) / 10;

		return (value > 0 ? '+' : '') + value + '%';
	}

	function padName(padId) {
		var pad = R.world.findPadById(padId);

		return pad ? pad.name : '—';
	}

	function clockAt(timestamp) {
		var date = new Date(timestamp);

		return ('0' + date.getHours()).slice(-2) + ':' + ('0' + date.getMinutes()).slice(-2) + ':' +
			('0' + date.getSeconds()).slice(-2);
	}

	function profileLabel(profileId) {
		var profile = R.autopilot.profileById(profileId);

		return profile ? profile.label : profileId;
	}

	function statusLabel(status) {
		var labels = {
			delivered: 'DELIVERED',
			landed: 'LANDED ELSEWHERE',
			crashed: 'CRASHED',
			'return-blocked': 'RETURN BLOCKED'
		};

		return labels[status] || status.toUpperCase();
	}

	deck.announce = function(text) {
		if (ui.announcer) {
			ui.announcer.textContent = text;
		}
	};

	// ---------------------------------------------------------------- dialogs

	function firstFocusable(panel) {
		var nodes = panel.querySelectorAll('button, input, select, [href]');
		var i;

		for (i = 0; i < nodes.length; i += 1) {
			if (!nodes[i].disabled && !nodes[i].hidden) {
				return nodes[i];
			}
		}
		return panel;
	}

	deck.showDialog = function(name) {
		var panel = ui.dialogs[name];

		if (!panel) {
			return;
		}
		deck.lastFocus = doc.activeElement;
		ui.dialogs.workshop.hidden = name !== 'workshop';
		ui.dialogs['route-type'].hidden = name !== 'route-type';
		ui.dialogs['route-review'].hidden = name !== 'route-review';
		deck.dialog = name;
		// Automation never pulls the player out of a form they are editing.
		R.operations.blocked = true;
		firstFocusable(panel).focus();
	};

	deck.hideDialog = function() {
		var name = deck.dialog;

		if (!name) {
			return;
		}
		ui.dialogs[name].hidden = true;
		deck.dialog = null;
		R.operations.blocked = false;
		if (deck.lastFocus && deck.lastFocus.focus) {
			deck.lastFocus.focus();
		}
		R.operations.touch();
	};

	function onDialogKeydown(event) {
		if (event.key === 'Escape' && deck.dialog) {
			event.preventDefault();
			deck.hideDialog();
		}
	}

	// ----------------------------------------------------------------- header

	function renderHeader(game) {
		var fleet = R.operations.state.fleet;
		var available = 0;
		var i;

		for (i = 0; i < fleet.length; i += 1) {
			available += fleet[i].status === 'available' ? 1 : 0;
		}
		ui.world.textContent = R.world.planet.name;
		ui.cash.textContent = money(game.cash);
		ui.fleetCount.textContent = available + ' of ' + fleet.length + ' ready';
	}

	// --------------------------------------------------------------- dispatch

	function padOption(pad, otherPadId) {
		var option = el('option', null, pad.name);
		var other = R.world.findPadById(otherPadId);

		option.value = pad.id;
		if (other && other.id !== pad.id) {
			option.textContent = pad.name + ' · ' + distance(R.operations.legDistance(other.id, pad.id));
		}
		return option;
	}

	function fillPads(select, selectedId, otherPadId) {
		var pads = R.world.pads;
		var i;

		select.innerHTML = '';
		for (i = 0; i < pads.length; i += 1) {
			select.appendChild(padOption(pads[i], otherPadId));
		}
		select.value = selectedId;
	}

	function fillTypes(select, selectedId) {
		var types = R.operations.state.types;
		var option;
		var i;

		select.innerHTML = '';
		for (i = 0; i < types.length; i += 1) {
			option = el('option', null, types[i].name);
			option.value = String(types[i].id);
			select.appendChild(option);
		}
		select.value = String(selectedId);
	}

	function fillRockets(select, typeId, padId, selectedId) {
		var fleet = R.operations.state.fleet;
		var option;
		var found = false;
		var i;

		select.innerHTML = '';
		for (i = 0; i < fleet.length; i += 1) {
			if (fleet[i].typeId !== typeId || fleet[i].padId !== padId) {
				continue;
			}
			option = el('option', null, 'Rocket #' + fleet[i].id + ' · ' + fleet[i].status);
			option.value = String(fleet[i].id);
			select.appendChild(option);
			found = true;
		}
		if (!found) {
			option = el('option', null, 'No rocket of this type here');
			option.value = '';
			select.appendChild(option);
		}
		select.value = selectedId && found ? String(selectedId) : select.options[0].value;
		select.disabled = !found;
		form.rocketId = found ? Number(select.value) : null;
	}

	function fillProfiles(select, selectedId) {
		var profiles = R.constants.autopilotProfiles;
		var option;
		var i;

		if (select.options.length === profiles.length) {
			select.value = selectedId;
			return;
		}
		select.innerHTML = '';
		for (i = 0; i < profiles.length; i += 1) {
			option = el('option', null, profiles[i].label);
			option.value = profiles[i].id;
			select.appendChild(option);
		}
		select.value = selectedId;
	}

	function summaryRow(label, value) {
		var row = el('div');

		row.appendChild(el('span', null, label));
		row.appendChild(el('strong', null, value));
		return row;
	}

	function countStagesWith(type, field, id) {
		var count = 0;
		var i;

		for (i = 0; i < type.stageCount; i += 1) {
			if (type.stages[i][field] === id) {
				count += 1;
			}
		}
		return count;
	}

	function appendPartGroup(type, field, table, line) {
		var count;
		var i;

		for (i = 0; i < table.length; i += 1) {
			count = countStagesWith(type, field, table[i].id);
			if (count > 0) {
				line += (line ? ' · ' : '') + table[i].label + (count > 1 ? ' ×' + count : '');
			}
		}
		return line;
	}

	// What the instance on the pad has on the clock: engine seconds against the
	// rating, and legs flown against the tank's, one entry per stage attached.
	function serviceLine(type, rocket) {
		var line = '';
		var slot;
		var i;

		for (i = 0; i < type.stageCount; i += 1) {
			slot = rocket.stageState[i];
			if (!slot.alive) {
				continue;
			}
			line += (line ? ' · ' : '') + 'S' + (i + 1) + ' ' + Math.round(slot.engineBurnTimeUsed) + '/' +
				R.parts.engine(type.stages[i].engineId).maxThrottleSeconds + ' s · ' + slot.lifeFlights + '/' +
				R.parts.tank(type.stages[i].tankId).maxFlights + ' legs' +
				// A tank at its rating is replaced by the next turnaround: say so,
				// because the structure price on this leg is where it costs money.
				(R.parts.wornOut(type.stages[i], slot) ? ' TANK WORN' : '');
		}
		return line || 'no stages attached';
	}

	// What the selected type is built from, named from the catalog: the dispatch
	// card shows the parts, so a build's price is legible before it is bought.
	function partsLine(type) {
		var catalog = R.constants.parts;
		var line = appendPartGroup(type, 'engineId', catalog.engines, '');

		line = appendPartGroup(type, 'tankId', catalog.tanks, line);
		return appendPartGroup(type, 'fairingId', catalog.fairings, line);
	}

	// The margin a dispatch books: each leg's payout less the autopilot fee,
	// against the costs the card quotes above. A round trip pays for its return
	// leg too, and that leg refuels at the destination: the bill is the tanks
	// filling there, at most a full load, priced before the outbound leg has
	// burned any of it. Structure the outbound leg wrecks is not quotable yet,
	// the same reason the card does not price the repair bill.
	function dispatchProfit(type, evaluation, quote) {
		var back = null;
		var reward = quote.reward;
		var net = reward * (1 - R.autopilot.feeFraction) - evaluation.cost;

		if (form.mode === 'return') {
			back = R.market.quote(form.targetPadId, form.sourcePadId, form.returnPayload, null);
			reward += back.reward;
			net += back.reward * (1 - R.autopilot.feeFraction) - (form.fuelPolicy === 'refuel' ?
				R.parts.typeFuelMass(type) * R.economy.priceFuel(form.targetPadId) : 0);
		}
		return reward > 0 ? margin(net, reward) + ' · ' + money(net) : '—';
	}

	// The dispatch card's read-only summary and the reason the send button is
	// disabled come from the same evaluation the scheduler uses.
	function renderDispatch(game) {
		var state = R.operations.state;
		var mission = state.mission;
		var type = R.operations.findType(form.typeId);
		var evaluation = R.operations.evaluateLeg(form.typeId, form.sourcePadId, form.outboundPayload, true,
			form.rocketId, form.overhaul);
		var typeStats = type ? R.operations.typeStats(type) : null;
		var capacity = typeStats ? Math.floor(typeStats.payloadLimit) : 0;
		var legDistance = R.operations.legDistance(form.sourcePadId, form.targetPadId);
		var offer = state.offer ? R.operations.findRoute(state.offer.routeId) : null;
		var returnCost = 0;
		var returnEvaluation = null;
		var contract = form.contractId ? R.market.find(form.contractId) : null;
		var quote = null;
		var buildCost = 0;
		var overhaulPrice = 0;
		var blocked = '';
		var rocket;

		// A contract that expired or flew while the form held it is not a
		// pending decision: drop the stale pointer instead of failing on send.
		if (form.contractId && !contract) {
			form.contractId = null;
		}

		ui.report.hidden = !game.lastReport;
		if (game.lastReport) {
			ui.reportTitle.textContent = game.lastReport.title;
			ui.reportDetail.textContent = game.lastReport.detail;
			ui.report.dataset.status = game.lastReport.status;
		}

		ui.offer.hidden = !offer;
		if (offer) {
			ui.offerText.textContent = (state.offer.autoLaunch ? 'Auto-launch in ' : 'Route ready: ') +
				offer.name + ' · ' + padName(offer.source) + ' → ' + padName(offer.destination);
			ui.offerSend.textContent = state.offer.autoLaunch ?
				'Launch now (' + Math.max(0, Math.ceil(state.countdown)) + 's)' : 'Send now';
		}

		ui.contract.hidden = !contract;
		if (contract) {
			ui.contractText.textContent = 'Contract · ' + padName(contract.fromPadId) + ' → ' + padName(contract.toPadId) + ' · ' +
				mass(contract.payloadMass) + ' at $' + contract.perKg.toFixed(2) + '/kg · pays ' +
				money(R.market.contractReward(contract)) + ' · ' + contract.turnsLeft + ' turn' +
				(contract.turnsLeft === 1 ? '' : 's') + ' left' +
				(contract.fragile ? ' · FRAGILE · land under ' +
					(R.world.planet.landingVerticalSpeed * R.constants.market.fragileSpeedFactor).toFixed(1) + ' m/s' : '');
		}

		ui.returnCard.hidden = !mission || mission.status !== 'awaiting-return';
		if (mission && mission.status === 'awaiting-return') {
			returnEvaluation = R.operations.evaluateLeg(mission.typeId, mission.destination, mission.returnPayload,
				mission.fuelPolicy === 'refuel', mission.rocketId, mission.overhaul);
			returnCost = returnEvaluation.cost;
			ui.returnText.textContent = 'Return leg waiting · ' + padName(mission.destination) + ' → ' +
				padName(mission.source) + ' · ' + mass(mission.returnPayload) +
				(mission.fuelPolicy === 'refuel' ? ' · refuels at destination' : ' · flies on remaining fuel');
			ui.returnCost.textContent = mission.fuelPolicy === 'refuel' ?
				'Up to ' + money(returnCost) + ' for fuel and structure' : 'No fuel or structure is added';
			ui.returnSend.disabled = !returnEvaluation.ready;
			ui.returnSend.textContent = returnEvaluation.ready ? 'Send return leg' : returnEvaluation.reason;
		}

		fillPads(ui.from, form.sourcePadId, form.targetPadId);
		fillPads(ui.to, form.targetPadId, form.sourcePadId);
		ui.modeReturn.checked = form.mode === 'return';
		ui.modeOneway.checked = form.mode === 'oneway';
		ui.policy.hidden = form.mode !== 'return';
		ui.policyRefuel.checked = form.fuelPolicy === 'refuel';
		ui.policyNone.checked = form.fuelPolicy === 'none';
		ui.returnPayloadRow.hidden = form.mode !== 'return';

		if (type) {
			ui.outbound.max = String(capacity);
			ui.returnPayload.max = String(capacity);
			// A contracted payload is what the board offers: it is not clamped
			// to this rocket's capacity, it fails the evaluation if it does not
			// fit, and the player picks another rocket or type.
			if (!contract) {
				form.outboundPayload = Math.min(form.outboundPayload, capacity);
			}
			form.returnPayload = Math.min(form.returnPayload, capacity);
		}
		ui.outbound.disabled = !!contract;
		ui.outbound.value = String(form.outboundPayload);
		ui.returnPayload.value = String(form.returnPayload);
		ui.outboundValue.textContent = mass(form.outboundPayload);
		ui.returnPayloadValue.textContent = mass(form.returnPayload);

		fillTypes(ui.type, form.typeId);
		fillRockets(ui.rocket, form.typeId, form.sourcePadId, form.rocketId);
		fillProfiles(ui.profile, form.profileId);
		ui.profileHint.textContent = R.autopilot.profileById(form.profileId).description;

		ui.build.hidden = !type;
		if (type) {
			buildCost = R.parts.typeBuildCost(type, form.sourcePadId);
			ui.buildLabel.textContent = 'Build rocket here · ' + money(buildCost);
			ui.build.disabled = game.cash < buildCost || game.phase !== 'deck';
		}

		ui.summary.innerHTML = '';
		ui.summary.appendChild(summaryRow('LEGS', form.mode === 'return' ?
			'2 · ' + distance(legDistance) + ' each way' : '1 · ' + distance(legDistance)));
		ui.summary.appendChild(summaryRow('PAYLOAD', form.mode === 'return' ?
			mass(form.outboundPayload) + ' out · ' + mass(form.returnPayload) + ' back' : mass(form.outboundPayload)));
		rocket = evaluation.rocket;
		ui.summary.appendChild(summaryRow('ROCKET', rocket ?
			'#' + rocket.id + ' ' + type.name + ' · ' + padName(rocket.padId) + ' · ' + rocket.status :
			'none of this type at ' + padName(form.sourcePadId)));
		if (type) {
			ui.summary.appendChild(summaryRow('PARTS', partsLine(type)));
		}

		ui.maintenance.hidden = !rocket;
		if (rocket) {
			overhaulPrice = evaluation.overhaulValue * R.economy.priceSteel(form.sourcePadId);
			ui.maintenanceText.textContent = 'Service · #' + rocket.id + ' · ' + serviceLine(type, rocket) +
				(evaluation.overhaulValue > 0 ? (form.overhaul ?
					' · OVERHAUL ON THIS LEG ' + money(evaluation.overhaulCost) :
					' · OVERHAUL DUE ' + money(overhaulPrice)) : '');
			ui.maintenanceBuy.hidden = evaluation.overhaulValue <= 0 || form.overhaul;
			ui.maintenanceBuy.textContent = 'Add overhaul to this leg · ' + money(overhaulPrice);
			ui.maintenanceBuy.disabled = game.cash < overhaulPrice;
		}
		ui.summary.appendChild(summaryRow('THIS LEG', evaluation.ready || evaluation.reason === R.operations.reasons.INSUFFICIENT_FUNDS ?
			'up to ' + money(evaluation.cost) + ' (fuel ' + money(evaluation.fuelMass * R.economy.priceFuel(form.sourcePadId)) +
			' · structure ' + money(evaluation.structureValue * R.economy.priceSteel(form.sourcePadId)) +
			(evaluation.overhaulCost > 0 ? ' · overhaul ' + money(evaluation.overhaulCost) : '') + ')' : '—'));
		quote = R.market.quote(form.sourcePadId, form.targetPadId, form.outboundPayload, form.contractId);
		ui.summary.appendChild(summaryRow('PAYS', money(quote.reward) + ' at $' + quote.pricePerKg.toFixed(2) + '/kg' +
			(form.contractId ? ' · contract' : '')));
		// The number experiments/balance.js measures over a chain of legs, for
		// the one in front of the player: a standing service inside the target
		// band is a route worth flying twice.
		ui.summary.appendChild(summaryRow('PROFIT', type && (evaluation.ready ||
			evaluation.reason === R.operations.reasons.INSUFFICIENT_FUNDS) ?
			dispatchProfit(type, evaluation, quote) : '—'));

		if (game.phase !== 'deck') {
			blocked = R.operations.reasons.BUSY;
		} else if (mission) {
			blocked = R.operations.reasons.BUSY + ' · A MISSION IS STILL ACTIVE';
		} else if (form.sourcePadId === form.targetPadId) {
			blocked = R.operations.reasons.SAME_PAD;
		} else if (!evaluation.ready) {
			blocked = evaluation.reason;
		}
		ui.blocked.textContent = blocked;
		ui.blocked.hidden = !blocked;
		ui.send.disabled = !!blocked;
		ui.saveRoute.disabled = form.sourcePadId === form.targetPadId || !type;
	}

	function onSend() {
		var result = R.operations.dispatch({
			source: form.sourcePadId,
			destination: form.targetPadId,
			mode: form.mode,
			fuelPolicy: form.fuelPolicy,
			outboundPayload: form.outboundPayload,
			returnPayload: form.returnPayload,
			typeId: form.typeId,
			rocketId: form.rocketId,
			profileId: form.profileId,
			contractId: form.contractId,
			overhaul: form.overhaul
		});

		if (!result.ok) {
			deck.announce(result.reason);
			return;
		}
		// The contract is flying with the rocket now; the form starts clean.
		form.contractId = null;
		form.overhaul = false;
		deck.openOverride = false;
		deck.announce('Mission ' + padName(form.sourcePadId) + ' to ' + padName(form.targetPadId) + ' launched on autopilot.');
		ui.send.blur();
		R.input.pointerActive = false;
	}

	function onSwap() {
		var padId = form.sourcePadId;
		var payload = form.outboundPayload;

		form.sourcePadId = form.targetPadId;
		form.targetPadId = padId;
		form.outboundPayload = form.returnPayload;
		form.returnPayload = payload;
		form.rocketId = null;
		form.overhaul = false;
		clearStaleContract();
		R.operations.touch();
	}

	// ----------------------------------------------------------------- market

	// Loading a contract pins the pads and the payload; the dispatch card then
	// quotes its posted rate. Changing any of those drops it back to a standing
	// service rather than silently flying someone else's cargo.
	function clearStaleContract() {
		var contract = form.contractId ? R.market.find(form.contractId) : null;

		if (contract && (contract.status !== 'open' || contract.fromPadId !== form.sourcePadId ||
			contract.toPadId !== form.targetPadId || contract.payloadMass !== form.outboundPayload)) {
			form.contractId = null;
		}
	}

	function loadContract(contract) {
		form.sourcePadId = contract.fromPadId;
		form.targetPadId = contract.toPadId;
		form.mode = 'oneway';
		form.fuelPolicy = 'refuel';
		form.outboundPayload = contract.payloadMass;
		form.rocketId = null;
		form.contractId = contract.id;
		deck.setTab('dispatch');
		deck.announce('Contract loaded: ' + padName(contract.fromPadId) + ' to ' + padName(contract.toPadId) +
			', ' + mass(contract.payloadMass) + ' at $' + contract.perKg.toFixed(2) + '/kg.');
	}

	function contractRow(contract) {
		var row = el('div', 'contract-row');
		var detail = el('div', 'contract-detail');
		var load = cardButton('Load into dispatch', function() {
			loadContract(contract);
		});

		load.className = 'ghost-button contract-load';

		detail.appendChild(el('strong', null, '→ ' + padName(contract.toPadId)));
		detail.appendChild(el('span', null, mass(contract.payloadMass) + ' at $' + contract.perKg.toFixed(2) + '/kg · ' +
			money(R.market.contractReward(contract)) + (contract.fragile ? ' · FRAGILE' : '')));
		detail.appendChild(el('span', contract.turnsLeft <= 1 ? 'contract-turns urgent' : 'contract-turns',
			contract.turnsLeft + ' turn' + (contract.turnsLeft === 1 ? '' : 's') + ' left'));
		row.appendChild(detail);
		if (contract.status === 'assigned') {
			row.appendChild(el('span', 'contract-tag', 'IN FLIGHT'));
		} else {
			row.appendChild(load);
		}
		return row;
	}

	function marketCard(pad) {
		var card = el('article', 'market-card');
		var head = el('header');
		var prices = el('dl', 'route-detail');
		var contracts = R.market.contractsAt(pad.id);
		var i;

		head.appendChild(el('strong', null, pad.name));
		head.appendChild(el('span', 'market-served', R.market.servedAt(pad.id) + ' served'));
		card.appendChild(head);
		prices.appendChild(summaryRow('FUEL', '$' + R.market.price(pad.id, 'fuel').toFixed(2) + '/kg'));
		prices.appendChild(summaryRow('STEEL', '$' + R.market.price(pad.id, 'steel').toFixed(2) + '/kg'));
		prices.appendChild(summaryRow('DELIVERY', '$' + R.market.price(pad.id, 'delivery').toFixed(2) + '/kg'));
		card.appendChild(prices);
		for (i = 0; i < contracts.length; i += 1) {
			card.appendChild(contractRow(contracts[i]));
		}
		return card;
	}

	function renderMarket() {
		var pads = R.world.pads;
		var i;

		ui.marketList.innerHTML = '';
		for (i = 0; i < pads.length; i += 1) {
			ui.marketList.appendChild(marketCard(pads[i]));
		}
	}

	// ----------------------------------------------------------------- routes

	function routeCard(route) {
		var card = el('article', 'route-card');
		var head = el('header');
		var toggle = el('button', 'ghost-button', route.enabled ? 'Pause' : 'Enable');
		var detail = el('dl', 'route-detail');
		var actions = el('div', 'route-actions');
		var arrow = route.mode === 'return' ? ' ⇄ ' : ' → ';
		var next = R.operations.routeLeg(route);
		var type = R.operations.findType(route.typeId);
		var autoLaunch = el('label', 'route-auto');
		var autoLaunchBox = doc.createElement('input');

		head.appendChild(el('strong', null, route.name));
		head.appendChild(el('span', 'route-status', route.enabled ?
			(route.status === 'ready' ? 'READY' : route.waitReason) : 'PAUSED'));
		toggle.type = 'button';
		on(toggle, 'click', function() {
			R.operations.setRouteEnabled(route.id, !route.enabled);
			deck.announce(route.enabled ? route.name + ' paused.' : route.name + ' enabled.');
		});
		head.appendChild(toggle);
		card.appendChild(head);

		detail.appendChild(summaryRow('NEXT', padName(next.fromPadId) + ' → ' + padName(next.toPadId)));
		detail.appendChild(summaryRow('TRIP', padName(route.source) + arrow + padName(route.destination) +
			(route.mode === 'return' ? ' · ' + (route.fuelPolicy === 'refuel' ? 'refuels' : 'no refuel') : '')));
		detail.appendChild(summaryRow('PAYLOAD', mass(route.outboundPayload) +
			(route.mode === 'return' ? ' out · ' + mass(route.returnPayload) + ' back' : '')));
		detail.appendChild(summaryRow('ROCKET TYPE', type ? type.name : 'missing'));
		detail.appendChild(summaryRow('LEGS', route.completedLegs + ' delivered · ' + route.failedLegs + ' failed' +
			(route.lastRunAt ? ' · last ' + clockAt(route.lastRunAt) : '')));
		card.appendChild(detail);

		autoLaunchBox.type = 'checkbox';
		autoLaunchBox.checked = route.autoLaunch;
		on(autoLaunchBox, 'change', function() {
			R.operations.setRouteAutoLaunch(route.id, autoLaunchBox.checked);
		});
		autoLaunch.appendChild(autoLaunchBox);
		autoLaunch.appendChild(el('span', null, 'Auto-launch when ready'));
		card.appendChild(autoLaunch);

		actions.appendChild(cardButton('Send next', function() {
			var result = R.operations.dispatchRoute(route.id);

			deck.announce(result.ok ? 'Route leg launched.' : result.reason);
		}));
		actions.appendChild(cardButton('Change rocket type', function() {
			openTypePicker(route.id);
		}));
		actions.appendChild(cardButton('Delete', function() {
			R.operations.deleteRoute(route.id);
			deck.announce(route.name + ' deleted.');
		}));
		card.appendChild(actions);
		return card;
	}

	function cardButton(label, handler) {
		var button = el('button', 'ghost-button', label);

		button.type = 'button';
		on(button, 'click', handler);
		return button;
	}

	function renderRoutes() {
		var routes = R.operations.state.routes;
		var i;

		R.operations.refreshRoutes(null);
		ui.routeList.innerHTML = '';
		for (i = 0; i < routes.length; i += 1) {
			ui.routeList.appendChild(routeCard(routes[i]));
		}
		ui.routesEmpty.hidden = routes.length > 0;
	}

	// -------------------------------------------------------------- flight log

	function logCard(entry) {
		var card = el('article', 'log-card');
		var head = el('header');
		var detail = el('dl', 'log-detail');
		var type = R.operations.findType(entry.rocketTypeId);
		var actions = el('div', 'route-actions');

		head.appendChild(el('strong', null, entry.cargoLost ? 'CARGO LOST' : statusLabel(entry.status)));
		head.appendChild(el('span', 'log-when', clockAt(entry.completedAt) +
			(entry.legCount === 2 ? ' · LEG ' + entry.leg + ' OF 2' : '')));
		card.appendChild(head);

		detail.appendChild(summaryRow('ROUTE FLOWN', padName(entry.departedPadId) + ' → ' + padName(entry.targetPadId) +
			' · landed ' + (entry.landingPadId ? padName(entry.landingPadId) : 'nowhere')));
		detail.appendChild(summaryRow('ROCKET', '#' + entry.rocketId + ' · ' + entry.rocketTypeSnapshot.name));
		detail.appendChild(summaryRow('CARGO', mass(entry.payloadMass) + ' · ' + profileLabel(entry.profileId)));
		detail.appendChild(summaryRow('FLIGHT', entry.elapsed.toFixed(1) + ' s · fuel ' + mass(entry.fuelUsed) +
			' of ' + mass(entry.fuelStart) + ' · ' + mass(entry.fuelRemaining) + ' left'));
		detail.appendChild(summaryRow('TOUCHDOWN', Math.abs(entry.touchdownVerticalSpeed).toFixed(1) + ' m/s down · ' +
			Math.abs(entry.touchdownHorizontalSpeed).toFixed(1) + ' m/s across · ' +
			distance(Math.abs(entry.targetError)) + ' off target'));
		detail.appendChild(summaryRow('CASH', 'revenue ' + money(entry.revenue) +
			(entry.rewardPerKg > 0 ? ' ($' + entry.rewardPerKg.toFixed(2) + '/kg' + (entry.contractId ? ' · contract' : '') + ')' : '') +
			' · fuel ' + money(entry.fuelCost) + ' · turnaround ' + money(entry.turnaroundCost) +
			(entry.overhaulCost > 0 ? ' · overhaul ' + money(entry.overhaulCost) : '') +
			' · fee ' + money(entry.autopilotFee)));
		detail.appendChild(summaryRow('NET', (entry.cashDelta < 0 ? '−' : '+') + money(Math.abs(entry.cashDelta))));
		card.appendChild(detail);

		if (type) {
			actions.appendChild(cardButton('Create route from flight', function() {
				openRouteReview(null, entry.id);
			}));
		} else {
			actions.appendChild(cardButton('Restore type from snapshot', function() {
				var restored = R.operations.restoreTypeFromSnapshot(entry.rocketTypeSnapshot);

				deck.announce('Rocket type ' + restored.name + ' restored.');
			}));
			card.dataset.missingType = 'true';
		}
		card.appendChild(actions);
		return card;
	}

	function renderLog() {
		var entries = R.flightLog.entries;
		var i;

		ui.logList.innerHTML = '';
		for (i = 0; i < entries.length; i += 1) {
			ui.logList.appendChild(logCard(entries[i]));
		}
		ui.logEmpty.hidden = entries.length > 0;
	}

	// ---------------------------------------------------------------- dialogs

	function openTypePicker(routeId) {
		var types = R.operations.state.types;
		var route = R.operations.findRoute(routeId);
		var type;
		var row;
		var i;

		typePickerRouteId = routeId;
		ui.typeList.innerHTML = '';
		for (i = 0; i < types.length; i += 1) {
			type = types[i];
			row = el('button', 'type-row');
			row.type = 'button';
			row.appendChild(el('strong', null, type.name));
			row.appendChild(el('span', null,
				type.stageCount + ' stages · capacity ' + mass(type.payloadLimit) +
				' · TWR ' + R.operations.typeTwr(type, route.outboundPayload).toFixed(2) +
				' · ' + countAt(type.id, route.source) + ' at ' + padName(route.source)));
			row.dataset.typeId = String(type.id);
			on(row, 'click', function() {
				var result = R.operations.changeRouteType(typePickerRouteId, Number(this.dataset.typeId));

				if (!result.ok) {
					ui.typeWarning.textContent = result.reason;
					return;
				}
				ui.typeWarning.textContent = '';
				deck.hideDialog();
			});
			ui.typeList.appendChild(row);
		}
		ui.typeWarning.textContent = '';
		deck.showDialog('route-type');
	}

	function countAt(typeId, padId) {
		var fleet = R.operations.state.fleet;
		var count = 0;
		var i;

		for (i = 0; i < fleet.length; i += 1) {
			count += fleet[i].typeId === typeId && fleet[i].padId === padId && fleet[i].status === 'available' ? 1 : 0;
		}
		return count + ' available';
	}

	function openRouteReview(routeId, logId) {
		var route = routeId ? R.operations.findRoute(routeId) : null;
		var spec;

		if (route) {
			spec = {
				name: route.name,
				source: route.source,
				destination: route.destination,
				mode: route.mode,
				fuelPolicy: route.fuelPolicy,
				outboundPayload: route.outboundPayload,
				returnPayload: route.returnPayload,
				typeId: route.typeId,
				profileId: route.profileId,
				enabled: route.enabled,
				autoLaunch: route.autoLaunch
			};
		} else if (logId) {
			spec = R.operations.routeSpecFromLog(R.flightLog.findById(logId));
			spec.enabled = false;
			spec.autoLaunch = false;
		} else {
			spec = {
				name: padName(form.sourcePadId) + (form.mode === 'return' ? ' ⇄ ' : ' → ') + padName(form.targetPadId),
				source: form.sourcePadId,
				destination: form.targetPadId,
				mode: form.mode,
				fuelPolicy: form.fuelPolicy,
				outboundPayload: form.outboundPayload,
				returnPayload: form.returnPayload,
				typeId: form.typeId,
				profileId: form.profileId,
				enabled: false,
				autoLaunch: false
			};
		}
		if (!spec.typeId && spec.typeSnapshot) {
			spec.typeId = R.operations.restoreTypeFromSnapshot(spec.typeSnapshot).id;
		}
		review.routeId = routeId;
		review.logId = logId || null;
		review.spec = spec;

		ui.reviewTitle.textContent = route ? 'Edit route' : 'Review new route';
		ui.reviewRoute.textContent = padName(spec.source) + (spec.mode === 'return' ? ' ⇄ ' : ' → ') + padName(spec.destination);
		ui.routeName.value = spec.name;
		ui.routeMode.value = spec.mode;
		ui.routePolicy.value = spec.fuelPolicy;
		fillTypes(ui.routeType, spec.typeId);
		fillProfiles(ui.routeProfile, spec.profileId);
		ui.routeEnabled.checked = !!spec.enabled;
		ui.routeAutoLaunch.checked = !!spec.autoLaunch;
		updateReviewPayloads();
		ui.routeWarning.textContent = '';
		deck.showDialog('route-review');
	}

	function updateReviewPayloads() {
		var type = R.operations.findType(Number(ui.routeType.value));
		var capacity = type ? Math.floor(R.operations.typeStats(type).payloadLimit) : R.constants.rocket.maxPayloadMass;

		ui.routeOutbound.max = String(capacity);
		ui.routeReturn.max = String(capacity);
		ui.routeOutbound.value = String(Math.min(review.spec.outboundPayload, capacity));
		ui.routeReturn.value = String(Math.min(review.spec.returnPayload, capacity));
		ui.routeOutboundValue.textContent = ui.routeOutbound.value + ' kg';
		ui.routeReturnValue.textContent = ui.routeReturn.value + ' kg';
		ui.routeReturnRow.hidden = ui.routeMode.value !== 'return';
		ui.routePolicyRow.hidden = ui.routeMode.value !== 'return';
	}

	function saveRouteReview() {
		var spec = review.spec;
		var result;

		spec.name = ui.routeName.value.trim() || spec.name;
		spec.mode = ui.routeMode.value;
		spec.fuelPolicy = ui.routePolicy.value;
		spec.outboundPayload = Number(ui.routeOutbound.value);
		spec.returnPayload = Number(ui.routeReturn.value);
		spec.typeId = Number(ui.routeType.value);
		spec.profileId = ui.routeProfile.value;
		spec.enabled = ui.routeEnabled.checked;
		spec.autoLaunch = ui.routeAutoLaunch.checked;
		result = R.operations.saveRoute(review.routeId, spec);
		if (!result.ok) {
			// The dialog stays open and says why: a route that cannot carry its
			// own payload is not saved with a guessed one.
			ui.routeWarning.textContent = result.reason;
			return;
		}
		deck.hideDialog();
		deck.setTab('routes');
		deck.announce('Route ' + spec.name + ' saved.');
	}

	// ------------------------------------------------------------------- sync

	function updateSelection(game) {
		var selection = game.selection;
		var mission = R.operations.state.mission;

		if (mission && mission.legFrom) {
			selection.sourcePadId = mission.legFrom;
			selection.targetPadId = mission.legTo;
			selection.mode = mission.mode;
			selection.visible = true;
			return;
		}
		selection.sourcePadId = form.sourcePadId;
		selection.targetPadId = form.targetPadId;
		selection.mode = form.mode;
		selection.visible = deck.tab === 'dispatch';
	}

	function renderFlightStrip(game) {
		var mission = game.mission;
		var flight = game.flight;
		var route;

		ui.flightStrip.hidden = game.phase !== 'flying' || !flight;
		if (game.phase !== 'flying' || !flight) {
			return;
		}
		route = mission && mission.routeId ? R.operations.findRoute(mission.routeId) : null;
		ui.flightStripText.textContent = 'LEG ' + flight.leg + ' OF ' + flight.legCount + ' · ' +
			padName(flight.departedPadId) + ' → ' + padName(flight.targetPadId) + ' · ' +
			(route ? route.name : 'manual dispatch');
	}

	deck.render = function(game) {
		renderHeader(game);
		updateSelection(game);
		renderFlightStrip(game);
		ui.panel.hidden = game.phase === 'flying' && !deck.openOverride;
		ui.viewDispatch.hidden = deck.tab !== 'dispatch';
		ui.viewMarket.hidden = deck.tab !== 'market';
		ui.viewRoutes.hidden = deck.tab !== 'routes';
		ui.viewLog.hidden = deck.tab !== 'log';
		ui.tabDispatch.setAttribute('aria-selected', String(deck.tab === 'dispatch'));
		ui.tabMarket.setAttribute('aria-selected', String(deck.tab === 'market'));
		ui.tabRoutes.setAttribute('aria-selected', String(deck.tab === 'routes'));
		ui.tabLog.setAttribute('aria-selected', String(deck.tab === 'log'));
		if (deck.tab === 'dispatch') {
			renderDispatch(game);
		} else if (deck.tab === 'market') {
			renderMarket();
		} else if (deck.tab === 'routes') {
			renderRoutes();
		} else {
			renderLog();
		}
	};

	deck.setTab = function(tabId) {
		deck.tab = tabId;
		R.operations.touch();
	};

	deck.sync = function(game) {
		var state = R.operations.state;
		var second;

		if (!state || !ui.panel) {
			return;
		}
		if (state.revision !== deck.revision || game.phase !== deck.phase) {
			deck.revision = state.revision;
			deck.phase = game.phase;
			lastCountdownSecond = -1;
			deck.render(game);
			return;
		}
		if (state.offer && state.offer.autoLaunch && deck.tab === 'dispatch' && !ui.offer.hidden) {
			second = Math.max(0, Math.ceil(state.countdown));
			if (second !== lastCountdownSecond) {
				lastCountdownSecond = second;
				ui.offerSend.textContent = 'Launch now (' + second + 's)';
			}
		}
	};

	deck.reset = function(game) {
		var type = R.operations.state.types[0];

		form.sourcePadId = R.world.currentPadId;
		form.targetPadId = R.world.targetPadId;
		form.mode = 'oneway';
		form.fuelPolicy = 'refuel';
		form.typeId = type.id;
		form.rocketId = null;
		form.contractId = null;
		form.profileId = type.defaultProfileId;
		form.outboundPayload = type.nominalPayload;
		form.returnPayload = type.nominalPayload;
		form.overhaul = false;
		deck.tab = 'dispatch';
		deck.openOverride = false;
		deck.revision = -1;
		deck.phase = '';
		R.operations.touch();
	};

	deck.initialize = function(game) {
		if (!doc || !doc.getElementById) {
			return;
		}
		ui.panel = doc.getElementById('deck');
		if (!ui.panel) {
			return;
		}
		ui.announcer = doc.getElementById('deck-announcer');
		ui.world = doc.getElementById('deck-world');
		ui.cash = doc.getElementById('deck-cash');
		ui.fleetCount = doc.getElementById('deck-fleet');
		ui.planetButton = doc.getElementById('deck-planet-button');
		ui.tabDispatch = doc.getElementById('tab-dispatch');
		ui.tabMarket = doc.getElementById('tab-market');
		ui.tabRoutes = doc.getElementById('tab-routes');
		ui.tabLog = doc.getElementById('tab-log');
		ui.viewDispatch = doc.getElementById('view-dispatch');
		ui.viewMarket = doc.getElementById('view-market');
		ui.marketList = doc.getElementById('market-list');
		ui.viewRoutes = doc.getElementById('view-routes');
		ui.viewLog = doc.getElementById('view-log');
		ui.report = doc.getElementById('dispatch-report');
		ui.reportTitle = doc.getElementById('dispatch-report-title');
		ui.reportDetail = doc.getElementById('dispatch-report-detail');
		ui.offer = doc.getElementById('dispatch-offer');
		ui.offerText = doc.getElementById('dispatch-offer-text');
		ui.offerSend = doc.getElementById('dispatch-offer-send');
		ui.offerCancel = doc.getElementById('dispatch-offer-cancel');
		ui.returnCard = doc.getElementById('dispatch-return');
		ui.returnText = doc.getElementById('dispatch-return-text');
		ui.returnCost = doc.getElementById('dispatch-return-cost');
		ui.returnSend = doc.getElementById('dispatch-return-send');
		ui.contract = doc.getElementById('dispatch-contract');
		ui.contractText = doc.getElementById('dispatch-contract-text');
		ui.contractClear = doc.getElementById('dispatch-contract-clear');
		ui.from = doc.getElementById('dispatch-from');
		ui.swap = doc.getElementById('dispatch-swap');
		ui.to = doc.getElementById('dispatch-to');
		ui.modeOneway = doc.getElementById('dispatch-mode-oneway');
		ui.modeReturn = doc.getElementById('dispatch-mode-return');
		ui.policy = doc.getElementById('dispatch-policy');
		ui.policyRefuel = doc.getElementById('dispatch-policy-refuel');
		ui.policyNone = doc.getElementById('dispatch-policy-none');
		ui.outbound = doc.getElementById('dispatch-outbound');
		ui.outboundValue = doc.getElementById('dispatch-outbound-value');
		ui.returnPayloadRow = doc.getElementById('dispatch-return-row');
		ui.returnPayload = doc.getElementById('dispatch-return-payload');
		ui.returnPayloadValue = doc.getElementById('dispatch-return-payload-value');
		ui.type = doc.getElementById('dispatch-type');
		ui.rocket = doc.getElementById('dispatch-rocket');
		ui.build = doc.getElementById('dispatch-build');
		ui.maintenance = doc.getElementById('dispatch-maintenance');
		ui.maintenanceText = doc.getElementById('dispatch-maintenance-text');
		ui.maintenanceBuy = doc.getElementById('dispatch-maintenance-buy');
		ui.buildLabel = doc.getElementById('dispatch-build-label');
		ui.profile = doc.getElementById('dispatch-profile');
		ui.profileHint = doc.getElementById('dispatch-profile-hint');
		ui.summary = doc.getElementById('dispatch-summary');
		ui.blocked = doc.getElementById('dispatch-blocked');
		ui.send = doc.getElementById('dispatch-send');
		ui.saveRoute = doc.getElementById('dispatch-save-route');
		ui.workshopButton = doc.getElementById('dispatch-workshop');
		ui.routeList = doc.getElementById('routes-list');
		ui.routesEmpty = doc.getElementById('routes-empty');
		ui.logList = doc.getElementById('log-list');
		ui.logEmpty = doc.getElementById('log-empty');
		ui.flightStrip = doc.getElementById('flight-strip');
		ui.flightStripText = doc.getElementById('flight-strip-text');
		ui.flightStripDeck = doc.getElementById('flight-strip-deck');
		ui.dialogs = {
			workshop: doc.getElementById('workshop'),
			'route-type': doc.getElementById('route-type-dialog'),
			'route-review': doc.getElementById('route-review-dialog')
		};
		ui.typeList = doc.getElementById('route-type-list');
		ui.typeWarning = doc.getElementById('route-type-warning');
		ui.reviewTitle = doc.getElementById('route-review-title');
		ui.reviewRoute = doc.getElementById('route-review-route');
		ui.routeName = doc.getElementById('route-name');
		ui.routeMode = doc.getElementById('route-mode');
		ui.routePolicy = doc.getElementById('route-policy');
		ui.routeOutbound = doc.getElementById('route-outbound');
		ui.routeOutboundValue = doc.getElementById('route-outbound-value');
		ui.routeReturnRow = doc.getElementById('route-return-row');
		ui.routeReturn = doc.getElementById('route-return');
		ui.routeReturnValue = doc.getElementById('route-return-value');
		ui.routePolicyRow = doc.getElementById('route-policy-row');
		ui.routeType = doc.getElementById('route-type');
		ui.routeProfile = doc.getElementById('route-profile');
		ui.routeEnabled = doc.getElementById('route-enabled');
		ui.routeAutoLaunch = doc.getElementById('route-auto-launch');
		ui.routeWarning = doc.getElementById('route-warning');
		ui.routeSave = doc.getElementById('route-review-save');

		on(ui.planetButton, 'click', function() {
			R.menu.show();
		});
		on(ui.tabDispatch, 'click', function() {
			deck.setTab('dispatch');
		});
		on(ui.tabMarket, 'click', function() {
			deck.setTab('market');
		});
		on(ui.tabRoutes, 'click', function() {
			deck.setTab('routes');
		});
		on(ui.tabLog, 'click', function() {
			deck.setTab('log');
		});
		on(ui.from, 'change', function() {
			form.sourcePadId = ui.from.value;
			form.rocketId = null;
			// The authorization was priced against the pad it was quoted at.
			form.overhaul = false;
			if (form.targetPadId === form.sourcePadId) {
				form.targetPadId = R.world.pads[(R.world.padIndex(form.sourcePadId) + 1) % R.world.pads.length].id;
			}
			clearStaleContract();
			R.operations.touch();
		});
		on(ui.to, 'change', function() {
			form.targetPadId = ui.to.value;
			clearStaleContract();
			R.operations.touch();
		});
		on(ui.contractClear, 'click', function() {
			form.contractId = null;
			R.operations.touch();
		});
		on(ui.swap, 'click', onSwap);
		on(ui.modeOneway, 'change', function() {
			form.mode = 'oneway';
			R.operations.touch();
		});
		on(ui.modeReturn, 'change', function() {
			form.mode = 'return';
			R.operations.touch();
		});
		on(ui.policyRefuel, 'change', function() {
			form.fuelPolicy = 'refuel';
			R.operations.touch();
		});
		on(ui.policyNone, 'change', function() {
			form.fuelPolicy = 'none';
			R.operations.touch();
		});
		on(ui.outbound, 'input', function() {
			form.outboundPayload = Number(ui.outbound.value);
			clearStaleContract();
			R.operations.touch();
		});
		on(ui.returnPayload, 'input', function() {
			form.returnPayload = Number(ui.returnPayload.value);
			R.operations.touch();
		});
		on(ui.type, 'change', function() {
			var type = R.operations.findType(Number(ui.type.value));

			form.typeId = type.id;
			form.outboundPayload = Math.min(form.outboundPayload, type.nominalPayload);
			form.returnPayload = Math.min(form.returnPayload, type.nominalPayload);
			form.rocketId = null;
			form.overhaul = false;
			R.operations.touch();
		});
		on(ui.rocket, 'change', function() {
			form.rocketId = ui.rocket.value ? Number(ui.rocket.value) : null;
			// The authorization was for the rocket it was quoted against.
			form.overhaul = false;
			R.operations.touch();
		});
		on(ui.profile, 'change', function() {
			form.profileId = ui.profile.value;
			R.operations.touch();
		});
		on(ui.build, 'click', function() {
			R.builder.open(R.game, { typeId: form.typeId, padId: form.sourcePadId });
		});
		on(ui.maintenanceBuy, 'click', function() {
			form.overhaul = true;
			R.operations.touch();
		});
		on(ui.workshopButton, 'click', function() {
			R.builder.open(R.game, { typeId: form.typeId, padId: form.sourcePadId });
		});
		on(ui.send, 'click', onSend);
		on(ui.saveRoute, 'click', function() {
			openRouteReview(null, null);
		});
		on(ui.offerSend, 'click', function() {
			var result = R.operations.acceptOffer();

			deck.announce(result.ok ? 'Route leg launched.' : result.reason);
		});
		on(ui.offerCancel, 'click', function() {
			R.operations.cancelOffer();
		});
		on(ui.returnSend, 'click', function() {
			var result = R.operations.sendReturnLeg();

			deck.announce(result.ok ? 'Return leg launched.' : result.reason);
		});
		on(ui.routeSave, 'click', saveRouteReview);
		on(doc.getElementById('route-review-cancel'), 'click', function() {
			deck.hideDialog();
		});
		on(doc.getElementById('route-type-cancel'), 'click', function() {
			deck.hideDialog();
		});
		on(ui.routeMode, 'change', updateReviewPayloads);
		on(ui.routeType, 'change', updateReviewPayloads);
		on(ui.routeOutbound, 'input', function() {
			ui.routeOutboundValue.textContent = ui.routeOutbound.value + ' kg';
		});
		on(ui.routeReturn, 'input', function() {
			ui.routeReturnValue.textContent = ui.routeReturn.value + ' kg';
		});
		on(ui.flightStripDeck, 'click', function() {
			deck.openOverride = !deck.openOverride;
			R.operations.touch();
		});
		on(doc.getElementById('workshop-close'), 'click', function() {
			deck.hideDialog();
		});
		doc.addEventListener('keydown', onDialogKeydown);

		deck.reset(game);
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = deck;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
