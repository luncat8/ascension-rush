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
		crosshair: { x: 0, y: 0 }
	};

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
		var circumference = R.constants.world.circumference;
		var width = render.width;
		var surfaceY = camera.groundY;
		var i;
		var pad;
		var padWorldX;
		var sx;
		var isCurrent;
		var isTarget;

		for (i = 0; i < pads.length; i += 1) {
			pad = pads[i];
			padWorldX = R.coords.nearestPeriodicX(pad.wx, camera.leftWx, circumference);
			camera.project(padWorldX, 0, render.scratch.pad);
			sx = render.scratch.pad.x;
			isCurrent = pad.id === game.currentPadId;
			isTarget = pad.id === game.targetPadId;

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
		var mark;
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

	function drawMissionPanel(context, game) {
		var source = R.world.findPadById(game.currentPadId);
		var target = R.world.findPadById(game.targetPadId);
		var margin = Math.min(24, render.width * 0.05);
		var panelWidth = Math.min(354, render.width - margin * 2);
		var panelHeight = 126;
		var x = margin;
		var y = 20;

		drawPanel(context, x, y, panelWidth, panelHeight);
		context.textAlign = 'left';
		context.fillStyle = R.constants.render.accent;
		context.font = '700 11px system-ui, sans-serif';
		context.fillText('ASCENSION RUSH', x + 18, y + 24);
		context.fillStyle = R.constants.render.mutedText;
		context.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
		context.fillText('PAYLOAD DELIVERY  /  NETWORK 01', x + 18, y + 42);

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
		context.fillText('0 m', x + 83, y + 105);
		context.fillStyle = R.constants.render.mutedText;
		context.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
		context.fillText('VELOCITY', x + 145, y + 105);
		context.fillStyle = R.constants.render.text;
		context.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
		context.fillText('0 m/s', x + 213, y + 105);
	}

	function drawWorldPanel(context) {
		var margin = Math.min(24, render.width * 0.05);
		var panelWidth = 230;
		var panelHeight = 93;
		var x = render.width - panelWidth - margin;
		var y = 20;
		var world = R.constants.world;

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
		context.fillText('1,000 km', x + panelWidth - 16, y + 68);
		context.textAlign = 'left';
		context.fillStyle = '#93aebc';
		context.fillText('SURFACE GRAVITY', x + 16, y + 83);
		context.textAlign = 'right';
		context.fillStyle = '#d3e0e1';
		context.fillText('9.81 m/s²', x + panelWidth - 16, y + 83);
	}

	function drawStatusStrip(context) {
		var margin = Math.min(24, render.width * 0.05);
		var width = Math.min(350, render.width - margin * 2);
		var y = R.camera.groundY - 46;

		drawPanel(context, margin, y, width, 30);
		context.fillStyle = '#7de0ca';
		context.beginPath();
		context.arc(margin + 16, y + 15, 3, 0, Math.PI * 2);
		context.fill();
		context.textAlign = 'left';
		context.fillStyle = '#c8ddd9';
		context.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
		context.fillText('ON PAD  ·  FLIGHT SYSTEMS STANDBY', margin + 29, y + 19);
	}

	function drawCrosshair(context) {
		var input = R.input;
		var point = render.scratch.crosshair;
		var alignRight;
		var textX;
		var textY;

		if (!input.pointerActive) {
			return;
		}

		R.camera.project(input.worldPoint.x, input.worldPoint.y, point);
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

		alignRight = input.pointerX > render.width * 0.68;
		textX = input.pointerX + (alignRight ? -14 : 14);
		textY = Math.max(18, input.pointerY - 15);
		context.textAlign = alignRight ? 'right' : 'left';
		context.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
		context.fillStyle = '#e7f2f2';
		context.fillText(input.debugText, textX, textY);
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

		context.clearRect(0, 0, render.width, render.height);
		context.fillStyle = render.skyGradient;
		context.fillRect(0, 0, render.width, render.height);
		drawStars(context);
		drawAltitudeScale(context);
		drawGround(context);
		drawPads(context, game);

		R.camera.project(rocket.wx, rocket.wy, render.scratch.rocket);
		R.rocket.draw(context, render.scratch.rocket.x, render.scratch.rocket.y, rocket.heading);
		drawMissionPanel(context, game);
		drawWorldPanel(context);
		drawStatusStrip(context);
		drawCrosshair(context);
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = render;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
