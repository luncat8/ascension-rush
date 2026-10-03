(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var render = R.render || (R.render = {});
	var altitudeMarks = [
		{ altitude: 100, label: '100 m' },
		{ altitude: 1000, label: '1 km' },
		{ altitude: 10000, label: '10 km' },
		{ altitude: 100000, label: '100 km' },
		{ altitude: 1000000, label: '1,000 km' }
	];

	render.context = null;
	render.width = 1;
	render.height = 1;
	render.skyGradient = null;
	render.groundPattern = null;
	render.stars = null;
	render.scratch = {
		pad: { x: 0, y: 0 },
		rocket: { x: 0, y: 0 },
		crosshair: { x: 0, y: 0 },
		coast: { x: 0, y: 0 }
	};
	render.timeLabel = { index: -1, text: 'x1' };
	// The pad pair the map highlights: the leg in flight, a mission waiting for
	// its return, or the dispatch form's selection. Filled in place per frame.
	render.focus = {
		fromPadId: '',
		toPadId: '',
		showReturn: false,
		leg: 0,
		legCount: 0,
		active: false
	};
	// Coast marker: crash, safe landing elsewhere, delivery on the target pad.
	var coastColors = ['#f28b82', '#f4c76a', '#64d5c2'];
	// Distance unit and side of the pad, so the HUD never builds a string.
	var coastUnits = [' m W', ' m E', ' km W', ' km E'];

	function drawPanel(context, x, y, width, height) {
		var radius = 10;

		context.beginPath();
		context.moveTo(x + radius, y);
		context.lineTo(x + width - radius, y);
		context.quadraticCurveTo(x + width, y, x + width, y + radius);
		context.lineTo(x + width, y + height - radius);
		context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
		context.lineTo(x + radius, y + height);
		context.quadraticCurveTo(x, y + height, x, y + height - radius);
		context.lineTo(x, y + radius);
		context.quadraticCurveTo(x, y, x + radius, y);
		context.closePath();
		context.fillStyle = R.constants.render.panel;
		context.fill();
		context.lineWidth = 1;
		context.strokeStyle = 'rgba(191, 214, 227, 0.18)';
		context.stroke();
	}

	// Which pad pair the map is talking about right now. A mission outranks the
	// dispatch selection so the deck keeps showing the flight it is working on.
	function legFocus(game) {
		var focus = render.focus;
		var mission = game.mission;
		var selection = game.selection;

		if (mission && mission.legFrom) {
			focus.fromPadId = mission.legFrom;
			focus.toPadId = mission.legTo;
			focus.showReturn = mission.mode === 'return';
			focus.leg = mission.currentLeg || 1;
			focus.legCount = mission.mode === 'return' ? 2 : 1;
			focus.active = true;
			return focus;
		}
		focus.fromPadId = selection ? selection.sourcePadId : game.currentPadId;
		focus.toPadId = selection ? selection.targetPadId : game.targetPadId;
		focus.showReturn = !!selection && selection.mode === 'return';
		focus.leg = 0;
		focus.legCount = focus.showReturn ? 2 : 1;
		focus.active = false;
		return focus;
	}

	function padScreenX(pad) {
		R.camera.project(R.coords.nearestPeriodicX(pad.wx, R.camera.leftWx, R.world.planet.circumference), 0, render.scratch.pad);
		return render.scratch.pad.x;
	}

	function drawArrowHead(context, sx, y, direction, color) {
		context.beginPath();
		context.moveTo(sx, y);
		context.lineTo(sx - direction * 9, y - 4);
		context.lineTo(sx - direction * 9, y + 4);
		context.closePath();
		context.fillStyle = color;
		context.fill();
	}

	// The shortest wrapped direction between the two pads, drawn on the surface
	// strip. A return mission adds the leg back above it, so the player can see
	// the whole trip rather than one arrow at a time.
	function drawLegArc(context, game) {
		var focus = legFocus(game);
		var from = R.world.findPadById(focus.fromPadId);
		var to = R.world.findPadById(focus.toPadId);
		var groundY = R.camera.groundY;
		var width = render.width;
		var x1;
		var x2;

		if (!from || !to || from.id === to.id) {
			return;
		}
		x1 = padScreenX(from);
		x2 = padScreenX(to);
		if (x2 - x1 > width * 0.5) {
			x2 -= width;
		} else if (x1 - x2 > width * 0.5) {
			x2 += width;
		}

		context.lineWidth = 3;
		context.strokeStyle = focus.active ? 'rgba(100, 213, 194, 0.75)' : 'rgba(100, 213, 194, 0.42)';
		context.beginPath();
		context.moveTo(x1, groundY - 3);
		context.lineTo(x2, groundY - 3);
		context.stroke();
		drawArrowHead(context, x2, groundY - 3, x2 >= x1 ? 1 : -1, 'rgba(140, 232, 216, 0.9)');

		if (!focus.showReturn) {
			return;
		}
		context.setLineDash([6, 6]);
		context.lineWidth = 2;
		context.strokeStyle = 'rgba(244, 199, 106, 0.55)';
		context.beginPath();
		context.moveTo(x2, groundY - 12);
		context.lineTo(x1, groundY - 12);
		context.stroke();
		context.setLineDash([]);
		drawArrowHead(context, x1, groundY - 12, x2 >= x1 ? -1 : 1, 'rgba(244, 199, 106, 0.8)');
	}

	function drawPadMarker(context, pad, sx, surfaceY, isCurrent, isTarget, showLabel) {
		if (isTarget) {
			context.beginPath();
			context.arc(sx, surfaceY - 13, 12, 0, Math.PI * 2);
			context.lineWidth = 1;
			context.strokeStyle = 'rgba(100, 213, 194, 0.9)';
			context.stroke();
		}

		if (isCurrent) {
			context.beginPath();
			context.arc(sx, surfaceY - 13, 17, 0, Math.PI * 2);
			context.lineWidth = 1;
			context.strokeStyle = 'rgba(244, 199, 106, 0.45)';
			context.stroke();
		}

		context.fillStyle = '#17232a';
		context.fillRect(sx - 12, surfaceY - 7, 24, 7);
		context.fillStyle = pad.color;
		context.fillRect(sx - 10, surfaceY - 6, 20, 4);
		context.fillStyle = 'rgba(236, 243, 235, 0.68)';
		context.fillRect(sx - 1, surfaceY - 21, 2, 14);
		context.fillStyle = pad.color;
		context.beginPath();
		context.arc(sx, surfaceY - 22, 3, 0, Math.PI * 2);
		context.fill();

		if (!showLabel) {
			return;
		}

		context.textAlign = 'center';
		context.font = '600 11px system-ui, sans-serif';
		context.fillStyle = isTarget ? '#a9eee2' : (isCurrent ? '#ffe1a0' : '#c5d1cc');
		context.fillText(pad.name, sx, surfaceY - 31);
	}

	function drawPads(context, game) {
		var pads = R.world.pads;
		var camera = R.camera;
		var circumference = R.world.planet.circumference;
		var width = render.width;
		var surfaceY = camera.groundY;
		var i;
		var pad;
		var padWorldX;
		var sx;
		var isCurrent;
		var isTarget;
		var focus = legFocus(game);

		for (i = 0; i < pads.length; i += 1) {
			pad = pads[i];
			padWorldX = R.coords.nearestPeriodicX(pad.wx, camera.leftWx, circumference);
			camera.project(padWorldX, 0, render.scratch.pad);
			sx = render.scratch.pad.x;
			isCurrent = pad.id === focus.fromPadId;
			isTarget = pad.id === focus.toPadId;

			drawPadMarker(context, pad, sx, surfaceY, isCurrent, isTarget, sx > 40 && sx < width - 40);
			if (sx < 14) {
				drawPadMarker(context, pad, sx + width, surfaceY, isCurrent, isTarget, false);
			}
			if (sx > width - 14) {
				drawPadMarker(context, pad, sx - width, surfaceY, isCurrent, isTarget, false);
			}
		}
	}

	function drawStars(context) {
		var stars = render.stars;
		var count = stars.length / 3;
		var i;

		context.fillStyle = '#e5f0f5';
		for (i = 0; i < count; i += 1) {
			context.globalAlpha = stars[i * 3 + 2];
			context.fillRect(stars[i * 3] * render.width, stars[i * 3 + 1] * render.height, 1.4, 1.4);
		}
		context.globalAlpha = 1;
	}

	function drawGround(context) {
		var groundY = R.camera.groundY;
		var height = render.height - groundY;

		context.fillStyle = render.groundPattern;
		context.fillRect(0, groundY, render.width, height);
		context.fillStyle = 'rgba(202, 219, 185, 0.12)';
		context.fillRect(0, groundY + height * 0.28, render.width, 1);
		context.fillStyle = 'rgba(8, 15, 17, 0.24)';
		context.fillRect(0, groundY + height * 0.72, render.width, 1);
		context.fillStyle = '#b4c7ad';
		context.fillRect(0, groundY, render.width, 1);
	}

	function drawAltitudeScale(context) {
		var marks = altitudeMarks;
		var i;
		var y;

		context.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
		context.textAlign = 'left';
		context.fillStyle = 'rgba(184, 207, 218, 0.72)';
		context.fillText('ALTITUDE  /  LOG SCALE', 24, 173);

		for (i = 0; i < marks.length; i += 1) {
			R.camera.project(0, marks[i].altitude, render.scratch.pad);
			y = render.scratch.pad.y;
			if (y < 12) {
				y = 12;
			}
			context.fillStyle = 'rgba(190, 215, 224, 0.26)';
			context.fillRect(20, y, 12, 1);
			context.fillStyle = 'rgba(202, 220, 226, 0.72)';
			context.fillText(marks[i].label, 39, y + 4);
		}
	}

	var missionLabels = [
		'PAYLOAD DELIVERY  /  OPERATIONS DECK',
		'PAYLOAD DELIVERY  /  FLIGHT',
		'PAYLOAD DELIVERY  /  LEG 1 OF 2',
		'PAYLOAD DELIVERY  /  LEG 2 OF 2',
		'PAYLOAD DELIVERY  /  RETURN LEG WAITING'
	];

	// Route identity and fuel policy for the flight HUD. Rebuilt only when the
	// mission changes, so the frame loop stays allocation-free.
	render.missionTag = { key: '', text: '' };

	function missionTag(game) {
		var mission = game.mission;
		var route;
		var key;

		if (!mission) {
			return 'MANUAL DISPATCH FROM THE DECK';
		}
		route = mission.routeId ? R.operations.findRoute(mission.routeId) : null;
		key = mission.id + ':' + mission.status;
		if (render.missionTag.key === key) {
			return render.missionTag.text;
		}
		render.missionTag.key = key;
		render.missionTag.text = (route ? 'ROUTE ' + route.name.toUpperCase() : 'DISPATCH') +
			(mission.mode === 'return' ?
				(mission.fuelPolicy === 'refuel' ? '  ·  REFUELS AT DESTINATION' : '  ·  FLIES HOME ON REMAINING FUEL') :
				'  ·  ONE WAY');
		return render.missionTag.text;
	}

	// Indexed, so the panel never builds a string per frame.
	function missionLine(game) {
		var mission = game.mission;
		var focus = render.focus;

		if (!mission) {
			return missionLabels[0];
		}
		if (game.phase !== 'flying') {
			return missionLabels[4];
		}
		return missionLabels[focus.legCount === 2 ? focus.leg : 1];
	}

	function drawMissionPanel(context, game) {
		var focus = legFocus(game);
		var source = R.world.findPadById(focus.fromPadId);
		var target = R.world.findPadById(focus.toPadId);
		var rocket = game.rocket;
		var margin = Math.min(24, render.width * 0.05);
		var panelWidth = Math.min(354, render.width - margin * 2);
		var panelHeight = 143;
		var horizontalSpeed = Math.round(Math.abs(rocket.vx));
		var x = margin;
		var y = 20;

		drawPanel(context, x, y, panelWidth, panelHeight);
		context.textAlign = 'left';
		context.fillStyle = R.constants.render.accent;
		context.font = '700 11px system-ui, sans-serif';
		context.fillText('ASCENSION RUSH', x + 18, y + 24);
		context.fillStyle = R.constants.render.mutedText;
		context.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
		context.fillText(missionLine(game), x + 18, y + 42);

		context.strokeStyle = 'rgba(190, 215, 224, 0.16)';
		context.beginPath();
		context.moveTo(x + 18, y + 54);
		context.lineTo(x + panelWidth - 18, y + 54);
		context.stroke();

		context.fillStyle = '#f4c76a';
		context.font = '600 15px system-ui, sans-serif';
		context.fillText(source ? source.name : '—', x + 18, y + 80);
		context.textAlign = 'center';
		context.fillStyle = R.constants.render.mutedText;
		context.font = '11px system-ui, sans-serif';
		context.fillText('TO', x + panelWidth * 0.5, y + 80);
		context.textAlign = 'right';
		context.fillStyle = '#8fe4d6';
		context.font = '600 15px system-ui, sans-serif';
		context.fillText(target ? target.name : '—', x + panelWidth - 18, y + 80);

		context.textAlign = 'left';
		context.fillStyle = R.constants.render.mutedText;
		context.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
		context.fillText('ALTITUDE', x + 18, y + 105);
		context.fillStyle = R.constants.render.text;
		context.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
		context.fillText(Math.round(rocket.wy), x + 83, y + 105);
		context.fillStyle = R.constants.render.mutedText;
		context.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
		context.fillText('H-SPEED', x + 153, y + 105);
		context.fillStyle = R.constants.render.text;
		context.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
		context.fillText(horizontalSpeed, x + 214, y + 105);

		context.fillStyle = game.mission ? '#f4c76a' : R.constants.render.mutedText;
		context.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
		context.fillText(missionTag(game), x + 18, y + 128);
	}

	function drawWorldPanel(context) {
		var margin = Math.min(24, render.width * 0.05);
		var panelWidth = 230;
		var panelHeight = 93;
		var x = render.width - panelWidth - margin;
		var y = 20;
		var world = R.world.planet;

		if (render.width < 650) {
			return;
		}

		drawPanel(context, x, y, panelWidth, panelHeight);
		context.textAlign = 'left';
		context.fillStyle = R.constants.render.mutedText;
		context.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
		context.fillText('PLANET PROFILE', x + 16, y + 23);
		context.fillStyle = R.constants.render.text;
		context.font = '600 15px system-ui, sans-serif';
		context.fillText(world.name, x + 16, y + 46);
		context.fillStyle = '#93aebc';
		context.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
		context.fillText('CIRCUMFERENCE', x + 16, y + 68);
		context.textAlign = 'right';
		context.fillStyle = '#d3e0e1';
		context.fillText(Math.round(world.circumference / 1000), x + panelWidth - 36, y + 68);
		context.fillText('km', x + panelWidth - 16, y + 68);
		context.textAlign = 'left';
		context.fillStyle = '#93aebc';
		context.fillText('SURFACE GRAVITY', x + 16, y + 83);
		context.textAlign = 'right';
		context.fillStyle = '#d3e0e1';
		context.fillText(world.surfaceGravity, x + panelWidth - 55, y + 83);
		context.fillText('m/s²', x + panelWidth - 16, y + 83);
	}

	function drawBar(context, x, y, width, fraction, color) {
		context.fillStyle = 'rgba(173, 197, 207, 0.14)';
		context.fillRect(x, y, width, 6);
		if (fraction <= 0) {
			return;
		}
		context.fillStyle = color;
		context.fillRect(x, y, width * Math.min(1, fraction), 6);
	}

	function drawFlightTelemetry(context, game) {
		var rocket = game.rocket;
		var stage = R.rocket.activeStage(rocket);
		var target = R.world.findPadById(game.targetPadId);
		var targetDistance = target ? Math.abs(R.util.wrapDelta(target.wx - rocket.wx, R.world.planet.circumference)) : 0;
		var fuelFraction = stage && stage.fuelMax > 0 ? stage.fuelMass / stage.fuelMax : 0;
		var heading = Math.round(R.util.mod(rocket.heading, Math.PI * 2) * 180 / Math.PI);
		var impact = R.trajectory.impact;
		var coastError;
		var margin = Math.min(24, render.width * 0.05);
		var panelWidth = 230;
		var panelHeight = 387;
		var x = render.width - panelWidth - margin;
		var y = 20;

		if (render.width < 650) {
			// Narrow viewport: the panel moves to the left, as low as it can go
			// without covering the ground strip, and never off the bottom.
			x = margin;
			y = R.util.clamp(Math.max(152, R.camera.groundY - panelHeight - 20), 12,
				Math.max(12, render.height - panelHeight - 12));
		}

		drawPanel(context, x, y, panelWidth, panelHeight);
		context.textAlign = 'left';
		context.fillStyle = R.constants.render.mutedText;
		context.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
		context.fillText('FLIGHT TELEMETRY', x + 16, y + 22);
		context.fillStyle = '#e7eff6';
		context.font = '600 12px system-ui, sans-serif';
		context.fillText(target ? target.name : 'NO DESTINATION', x + 16, y + 43);
		context.textAlign = 'right';
		context.fillStyle = '#91e3d3';
		context.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
		if (targetDistance < 20000) {
			context.fillText(Math.round(targetDistance), x + panelWidth - 37, y + 43);
			context.fillText('m', x + panelWidth - 16, y + 43);
		} else {
			context.fillText(Math.round(targetDistance / 1000), x + panelWidth - 37, y + 43);
			context.fillText('km', x + panelWidth - 16, y + 43);
		}

		context.textAlign = 'left';
		context.fillStyle = '#a8bac2';
		context.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
		context.fillText('STAGE', x + 16, y + 65);
		// Why the stage number just changed: the guidance dropped a stage that
		// could not hold the rocket up, rather than waiting for it to run dry.
		if (R.autopilot.enabled && R.autopilot.stagedEarly) {
			context.fillStyle = '#f4c76a';
			context.fillText('EARLY', x + 74, y + 65);
		}
		context.textAlign = 'right';
		context.fillStyle = '#e7eff6';
		if (stage) {
			context.fillText(rocket.currentStage + 1, x + panelWidth - 54, y + 65);
			context.fillText('/', x + panelWidth - 34, y + 65);
			context.fillText(rocket.stageCount, x + panelWidth - 16, y + 65);
		} else {
			context.fillText('NO STAGES LEFT', x + panelWidth - 16, y + 65);
		}

		context.textAlign = 'left';
		context.fillStyle = '#a8bac2';
		context.fillText('FUEL', x + 16, y + 86);
		context.textAlign = 'right';
		context.fillStyle = '#e7eff6';
		if (stage) {
			context.fillText(Math.round(stage.fuelMass), x + panelWidth - 38, y + 86);
			context.fillText('kg', x + panelWidth - 16, y + 86);
		} else {
			context.fillText('—', x + panelWidth - 16, y + 86);
		}
		drawBar(context, x + 16, y + 93, panelWidth - 32, fuelFraction, '#65d5c1');

		context.textAlign = 'left';
		context.fillStyle = '#a8bac2';
		context.fillText('THROTTLE', x + 16, y + 115);
		context.textAlign = 'right';
		context.fillStyle = '#e7eff6';
		context.fillText(Math.round(rocket.throttle * 100), x + panelWidth - 37, y + 115);
		context.fillText('%', x + panelWidth - 16, y + 115);
		drawBar(context, x + 16, y + 122, panelWidth - 32, rocket.throttle, '#f4c76a');

		context.textAlign = 'left';
		context.fillStyle = '#a8bac2';
		context.fillText('VX', x + 16, y + 145);
		context.fillStyle = '#e7eff6';
		context.fillText(Math.round(rocket.vx), x + 43, y + 145);
		context.fillStyle = '#a8bac2';
		context.fillText('VY', x + 91, y + 145);
		context.fillStyle = '#e7eff6';
		context.fillText(Math.round(rocket.vy), x + 118, y + 145);
		context.fillStyle = '#a8bac2';
		context.fillText('HDG', x + 158, y + 145);
		context.fillStyle = '#e7eff6';
		context.fillText(heading, x + 192, y + 145);
		context.fillText('°', x + 208, y + 145);

		context.fillStyle = '#a8bac2';
		context.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
		context.textAlign = 'left';
		context.fillText('Q', x + 16, y + 168);
		context.fillStyle = '#e7eff6';
		context.textAlign = 'right';
		context.fillText((game.flight.currentDynamicPressure / 1000).toFixed(1), x + panelWidth - 38, y + 168);
		context.fillStyle = '#a8bac2';
		context.fillText('kPa', x + panelWidth - 16, y + 168);

		context.textAlign = 'left';
		context.fillStyle = '#a8bac2';
		context.fillText('ANGLE OF ATTACK', x + 16, y + 188);
		context.textAlign = 'right';
		context.fillStyle = '#e7eff6';
		context.fillText((game.flight.currentAngleOfAttack * 180 / Math.PI).toFixed(1), x + panelWidth - 32, y + 188);
		context.fillStyle = '#a8bac2';
		context.fillText('°', x + panelWidth - 16, y + 188);

		context.textAlign = 'left';
		context.fillStyle = '#a8bac2';
		context.fillText('PEAK Q', x + 16, y + 208);
		context.textAlign = 'right';
		context.fillStyle = '#e7eff6';
		context.fillText((game.flight.peakDynamicPressure / 1000).toFixed(1), x + panelWidth - 38, y + 208);
		context.fillStyle = '#a8bac2';
		context.fillText('kPa', x + panelWidth - 16, y + 208);

		context.fillStyle = '#a8bac2';
		context.textAlign = 'left';
		context.fillText('BALANCE', x + 16, y + 234);
		context.fillStyle = '#e7eff6';
		context.textAlign = 'right';
		context.fillText('$', x + panelWidth - 58, y + 234);
		context.fillText(Math.round(game.cash), x + panelWidth - 16, y + 234);

		context.textAlign = 'left';
		context.fillStyle = '#a8bac2';
		context.fillText('FLIGHT Δ', x + 16, y + 254);
		context.textAlign = 'right';
		context.fillStyle = game.flight.cashDelta >= 0 ? '#91e3d3' : '#f1a89d';
		context.fillText(game.flight.cashDelta < 0 ? '−$' : '+$', x + panelWidth - 58, y + 254);
		context.fillText(Math.round(Math.abs(game.flight.cashDelta)), x + panelWidth - 16, y + 254);

		context.fillStyle = '#a8bac2';
		context.textAlign = 'left';
		context.fillText('AUTOPILOT', x + 16, y + 275);
		context.textAlign = 'right';
		if (R.autopilot.enabled) {
			context.fillStyle = '#7de0ca';
			context.fillText(R.autopilot.label(), x + panelWidth - 16, y + 275);
		} else {
			context.fillStyle = '#829ba6';
			context.fillText('OFF', x + panelWidth - 16, y + 275);
		}

		// Why the guidance is holding back, with the profile whose limits it flies.
		context.textAlign = 'left';
		context.fillStyle = '#a8bac2';
		context.fillText('LIMITER', x + 16, y + 296);
		context.textAlign = 'right';
		if (!R.autopilot.enabled) {
			context.fillStyle = '#829ba6';
			context.fillText('OFF', x + panelWidth - 16, y + 296);
		} else {
			context.fillStyle = R.autopilot.limiter ? '#f4c76a' : '#829ba6';
			context.fillText(R.autopilot.limiter ? R.autopilot.limiterLabel() : '—', x + panelWidth - 16, y + 296);
			context.textAlign = 'left';
			context.fillStyle = '#829ba6';
			context.fillText(R.autopilot.profileById(game.flight.autopilotProfile).label, x + 74, y + 296);
		}

		// The coast forecast: where an engine-off trajectory from this state
		// reaches the ground, how far that is from the selected pad, and how
		// hard it arrives. It is a projection, not a promise: the autopilot
		// keeps burning and lands where its own guidance takes it.
		context.textAlign = 'left';
		context.fillStyle = '#a8bac2';
		context.fillText('COAST IMPACT', x + 16, y + 317);
		context.textAlign = 'right';
		if (!impact.valid) {
			context.fillStyle = '#829ba6';
			context.fillText('OUT OF HORIZON', x + panelWidth - 16, y + 317);
		} else if (impact.onTargetPad) {
			context.fillStyle = '#7de0ca';
			context.fillText('ON TARGET PAD', x + panelWidth - 16, y + 317);
		} else {
			coastError = Math.abs(impact.targetError);
			context.fillStyle = impact.safeTouchdown ? '#f4c76a' : '#f1a89d';
			context.fillText(coastError >= 1000 ? (coastError / 1000).toFixed(1) : String(Math.round(coastError)), x + panelWidth - 50, y + 317);
			context.textAlign = 'left';
			context.fillText(coastUnits[(impact.targetError >= 0 ? 1 : 0) + (coastError >= 1000 ? 2 : 0)], x + panelWidth - 48, y + 317);
		}

		context.textAlign = 'left';
		context.fillStyle = '#a8bac2';
		context.fillText('COAST TOUCHDOWN', x + 16, y + 337);
		context.textAlign = 'right';
		if (!impact.valid) {
			context.fillStyle = '#829ba6';
			context.fillText('—', x + panelWidth - 16, y + 337);
		} else {
			context.fillStyle = impact.safeTouchdown ? '#7de0ca' : '#f1a89d';
			context.fillText('V', x + panelWidth - 116, y + 337);
			context.fillText(Math.abs(impact.vy).toFixed(1), x + panelWidth - 66, y + 337);
			context.fillText('H', x + panelWidth - 56, y + 337);
			context.fillText(Math.abs(impact.vx).toFixed(1), x + panelWidth - 16, y + 337);
		}

		context.textAlign = 'left';
		context.fillStyle = '#a8bac2';
		context.fillText('TIME SCALE', x + 16, y + 358);
		context.textAlign = 'right';
		context.fillStyle = '#e7eff6';
		context.fillText(timeLabel(game), x + panelWidth - 16, y + 358);

		context.fillStyle = '#829ba6';
		context.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
		context.textAlign = 'left';
		context.fillText('A  AUTOPILOT    [ ]  TIME    SHIFT/CTRL  THROTTLE', x + 16, y + 378);
	}

	// Cached so the frame loop does not build a new string every tick.
	function timeLabel(game) {
		if (render.timeLabel.index !== game.timeScaleIndex) {
			render.timeLabel.index = game.timeScaleIndex;
			render.timeLabel.text = game.timeScale.toFixed(2).replace(/\.?0+$/, '') + 'x';
		}
		return render.timeLabel.text;
	}

	function drawStatusStrip(context, game) {
		var margin = Math.min(24, render.width * 0.05);
		var width = Math.min(350, render.width - margin * 2);
		var y = R.camera.groundY - 46;
		var label = game.phase === 'flying' ? 'MOUSE AIM  ·  SHIFT / CTRL THROTTLE  ·  SPACE STAGE  ·  A AUTOPILOT' : 'OPERATIONS DECK  ·  DISPATCH  ·  ROUTES  ·  FLIGHT LOG';

		drawPanel(context, margin, y, width, 30);
		context.fillStyle = game.phase === 'flying' ? '#f4c76a' : '#7de0ca';
		context.beginPath();
		context.arc(margin + 16, y + 15, 3, 0, Math.PI * 2);
		context.fill();
		context.textAlign = 'left';
		context.fillStyle = '#c8ddd9';
		context.font = '600 9px ui-monospace, SFMono-Regular, Menlo, monospace';
		context.fillText(label, margin + 27, y + 19);
	}

	function drawCrosshair(context, game) {
		var input = R.input;
		var point = render.scratch.crosshair;
		var alignRight;
		var textX;
		var textY;

		if (!input.pointerActive) {
			return;
		}

		if (game.phase === 'flying') {
			point.x = input.pointerX;
			point.y = input.pointerY;
		} else {
			R.camera.project(input.worldPoint.x, input.worldPoint.y, point);
		}
		context.strokeStyle = 'rgba(229, 246, 247, 0.88)';
		context.lineWidth = 1;
		context.beginPath();
		context.arc(point.x, point.y, 6, 0, Math.PI * 2);
		context.moveTo(point.x - 11, point.y);
		context.lineTo(point.x - 4, point.y);
		context.moveTo(point.x + 4, point.y);
		context.lineTo(point.x + 11, point.y);
		context.moveTo(point.x, point.y - 11);
		context.lineTo(point.x, point.y - 4);
		context.moveTo(point.x, point.y + 4);
		context.lineTo(point.x, point.y + 11);
		context.stroke();

		if (game.phase === 'flying') {
			return;
		}
		alignRight = input.pointerX > render.width * 0.68;
		textX = input.pointerX + (alignRight ? -14 : 14);
		textY = Math.max(18, input.pointerY - 15);
		context.textAlign = alignRight ? 'right' : 'left';
		context.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
		context.fillStyle = '#e7f2f2';
		context.fillText(input.debugText, textX, textY);
	}

	// The label sits above the pad-name band so a coast that lands on a pad
	// still reads as two labels, not as one overprint.
	function drawCoastMarkerAt(context, sx, groundY, color) {
		context.globalAlpha = 0.3;
		context.fillStyle = color;
		context.fillRect(sx - 0.5, groundY - 16, 1, 16);
		context.globalAlpha = 0.92;
		context.beginPath();
		context.moveTo(sx, groundY - 16);
		context.lineTo(sx - 6, groundY - 27);
		context.lineTo(sx + 6, groundY - 27);
		context.closePath();
		context.fill();
		context.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
		context.textAlign = 'center';
		context.fillText('COAST', sx, groundY - 44);
		context.globalAlpha = 1;
	}

	// Where the rocket reaches the ground if the engine is cut now. The colour
	// separates a coast that would deliver from one that would merely land and
	// one that would break the world's touchdown limits.
	function drawCoastMarker(context, game) {
		var impact = R.trajectory.impact;
		var point = render.scratch.coast;
		var groundY = R.camera.groundY;
		var color;

		if (game.phase !== 'flying' || !impact.valid) {
			return;
		}
		// The periodic copy always projects inside the viewport, so a coast that
		// wraps the world keeps its marker; near an edge it is drawn twice, like
		// the pads are.
		R.camera.project(R.trajectory.markerX(impact), 0, point);
		color = impact.safeTouchdown ? (impact.onTargetPad ? coastColors[2] : coastColors[1]) : coastColors[0];
		drawCoastMarkerAt(context, point.x, groundY, color);
		if (point.x < 20) {
			drawCoastMarkerAt(context, point.x + render.width, groundY, color);
		}
		if (point.x > render.width - 20) {
			drawCoastMarkerAt(context, point.x - render.width, groundY, color);
		}
	}

	render.initialize = function(context) {
		var tile = root.document.createElement('canvas');
		var tileContext;
		var seed = 9487;
		var i;

		render.context = context;
		tile.width = 48;
		tile.height = 48;
		tileContext = tile.getContext('2d');
		tileContext.fillStyle = R.constants.render.ground;
		tileContext.fillRect(0, 0, tile.width, tile.height);
		tileContext.fillStyle = R.constants.render.groundDetail;
		for (i = 0; i < 18; i += 1) {
			seed = seed * 16807 % 2147483647;
			tileContext.fillRect(seed % tile.width, (seed * 7) % tile.height, 1, 1);
		}
		render.groundPattern = context.createPattern(tile, 'repeat');
		render.stars = new Float32Array(84 * 3);
		for (i = 0; i < 84; i += 1) {
			seed = seed * 16807 % 2147483647;
			render.stars[i * 3] = seed / 2147483647;
			seed = seed * 16807 % 2147483647;
			render.stars[i * 3 + 1] = seed / 2147483647 * 0.83;
			seed = seed * 16807 % 2147483647;
			render.stars[i * 3 + 2] = 0.22 + seed / 2147483647 * 0.62;
		}
	};

	render.resize = function(width, height) {
		render.width = Math.max(1, width);
		render.height = Math.max(1, height);
		R.camera.resize(render.width, render.height);
		render.skyGradient = render.context.createLinearGradient(0, 0, 0, render.height);
		render.skyGradient.addColorStop(0, R.constants.render.backgroundTop);
		render.skyGradient.addColorStop(0.68, R.constants.render.backgroundBottom);
		render.skyGradient.addColorStop(1, '#243742');
	};

	render.draw = function(game) {
		var context = render.context;
		var rocket = game.rocket;
		var stage = R.rocket.activeStage(rocket);
		var flameThrottle = stage && stage.fuelMass > 0 ? rocket.throttle : 0;

		context.clearRect(0, 0, render.width, render.height);
		context.fillStyle = render.skyGradient;
		context.fillRect(0, 0, render.width, render.height);
		drawStars(context);
		drawAltitudeScale(context);
		drawGround(context);
		drawLegArc(context, game);
		drawPads(context, game);
		drawCoastMarker(context, game);

		R.camera.project(rocket.wx, rocket.wy, render.scratch.rocket);
		R.rocket.draw(context, render.scratch.rocket.x, render.scratch.rocket.y, rocket.heading, flameThrottle);
		drawMissionPanel(context, game);
		if (game.phase === 'flying') {
			drawFlightTelemetry(context, game);
		} else {
			drawWorldPanel(context);
			drawStatusStrip(context, game);
		}
		drawCrosshair(context, game);
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = render;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
