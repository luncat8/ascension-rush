(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var render = R.render || (R.render = {});
	// Decade ladder; only marks inside the camera's live ceiling are drawn, so
	// a zoom never stacks clamped labels on the top edge.
	var altitudeMarks = [
		{ altitude: 10, label: '10 m' },
		{ altitude: 100, label: '100 m' },
		{ altitude: 1000, label: '1 km' },
		{ altitude: 10000, label: '10 km' },
		{ altitude: 100000, label: '100 km' },
		{ altitude: 1000000, label: '1,000 km' },
		{ altitude: 10000000, label: '10,000 km' }
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
		explosion: { x: 0, y: 0 },
		crosshair: { x: 0, y: 0 },
		coast: { x: 0, y: 0 },
		marker: { x: 0, y: 0 },
		path: { x: 0, y: 0 }
	};
	// Cached so the atmosphere label does not build a string per frame.
	render.airLabel = { key: -1, text: 'ATMOSPHERE TOP' };
	render.airY = 0;
	// Half-height, in pixels, of the thinnest lens drawn. A distant body's true
	// silhouette is only a couple of pixels tall at this scale; below this the
	// drawn shape is stretched about its own centre for readability. Its
	// placement is never altered.
	render.minBodyHeight = 3.5;
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
	var stageLabels = ['S1', 'S2', 'S3'];
	var dashAim = [4, 4];
	var dashSolid = [];
	// Pilot mode label for the HUD header; rebuilt only when the pilot or the
	// profile changes, never per frame.
	var modeCacheKey = '';
	var modeCacheText = '';
	// The cold manual start is the one moment a procedure prompt earns its
	// place: the rocket does not move until the player lights the engine.
	var launchPrompt = 'HOLD SHIFT TO LIFT OFF';
	var launchPromptDetail = 'mouse aims · space stages · A = autopilot';

	function pilotModeLabel() {
		var key = R.autopilot.enabled ? 'a:' + R.autopilot.profileId : 'manual';

		if (key !== modeCacheKey) {
			modeCacheKey = key;
			modeCacheText = R.autopilot.enabled ?
				'AUTOPILOT · ' + R.autopilot.profileById(R.autopilot.profileId).label :
				'MANUAL · YOU FLY';
		}
		return modeCacheText;
	}

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
			padWorldX = camera.flat ? R.coords.nearestPeriodicX(pad.wx, camera.leftWx, circumference) : pad.wx;
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

	// Space above the atmosphere ceiling is darker than the air column below
	// it. Both read the eased ceiling, so a world switch moves the line instead
	// of replacing it.
	function drawSkyShade(context) {
		var camera = R.camera;
		var point = render.scratch.marker;

		R.camera.project(0, R.sky.view.atmosphereTop, point);
		render.airY = R.util.clamp(point.y, 0, camera.groundY);
		context.fillStyle = 'rgba(3, 8, 20, 0.34)';
		context.fillRect(0, 0, render.width, render.airY);
	}

	function drawAirBand(context) {
		var camera = R.camera;
		var airTop = R.sky.view.atmosphereTop;
		var key = Math.round(airTop / 100);
		var y = render.airY;
		var label;

		// The air column belongs to the deck, where the ground line is the
		// world's surface. Charted on another body, the world's air is a band at
		// its own lens, not a wash down to the pivot's ground.
		if (!camera.flat) {
			render.airLabel.key = -1;
			return;
		}
		// An airless world has no ceiling line to draw or to name.
		if (airTop <= 0 || y >= camera.groundY) {
			render.airLabel.key = -1;
			return;
		}
		context.fillStyle = 'rgba(36, 84, 112, 0.20)';
		context.fillRect(0, y, render.width, camera.groundY - y);
		context.fillStyle = 'rgba(150, 205, 224, 0.34)';
		context.fillRect(0, y, render.width, 1);
		if (key !== render.airLabel.key) {
			render.airLabel.key = key;
			label = key >= 10 ? (key / 10).toFixed(1) + ' km' : Math.round(airTop) + ' m';
			render.airLabel.text = 'ATMOSPHERE TOP  ·  ' + label;
		}
		if (y < 26) {
			// The line is at the very top: a label there would collide with the
			// altitude ladder's own heading.
			return;
		}
		context.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
		context.textAlign = 'left';
		context.fillStyle = 'rgba(174, 216, 230, 0.82)';
		context.fillText(render.airLabel.text, 20, y - 6);
	}

	// A body's lens. Both limbs are already in screen space: each sample angle
	// gives the two intersections of its ray with the sphere, and the chart's
	// own log-polar map puts them where they belong. The shape is then the
	// closed polygon between the near limb and the far limb.
	function lensPath(context, lens) {
		var i;

		context.beginPath();
		for (i = 0; i < lens.xs.length; i += 1) {
			if (i === 0) {
				context.moveTo(lens.xs[0], lens.nearYs[0]);
			} else {
				context.lineTo(lens.xs[i], lens.nearYs[i]);
			}
		}
		for (i = lens.xs.length - 1; i >= 0; i -= 1) {
			context.lineTo(lens.xs[i], lens.farYs[i]);
		}
		context.closePath();
	}

	// A body is drawn as its true lens when the lens has size, and as a small
	// disc when the log chart has squeezed it to a hairline: distant bodies stay
	// visible and clickable without pretending they are wide.
	function drawSkyBody(context, body, lens, index) {
		var star = body.kind === 'star';
		var icon = R.sky.iconRadius(index);
		var halfWidth;
		var halfHeight;
		var thin;
		var x;
		var mid;
		var angle;
		var i;

		if (!lens.visible || lens.alpha <= 0.01) {
			return;
		}
		halfWidth = Math.max(1, lens.halfWidth);
		halfHeight = Math.max(render.minBodyHeight, (lens.nearY - lens.farY) * 0.5);
		x = lens.centerX;
		mid = lens.centerY;
		if (x < -halfWidth * 4 || x > render.width + halfWidth * 4) {
			return;
		}
		if (mid - halfHeight > R.camera.groundY || mid + halfHeight < 0) {
			return;
		}
		thin = halfWidth < icon || halfHeight < icon;
		if (thin) {
			halfWidth = icon;
			halfHeight = icon;
			mid = lens.centerY;
		}
		if (index === R.input.hoverIndex) {
			context.beginPath();
			context.arc(x, mid, Math.max(halfWidth, halfHeight) + 6, 0, Math.PI * 2);
			context.setLineDash(dashAim);
			context.lineWidth = 1;
			context.strokeStyle = 'rgba(244, 199, 106, 0.75)';
			context.stroke();
			context.setLineDash(dashSolid);
		}
		context.save();
		if (star) {
			for (i = 4; i >= 1; i -= 1) {
				context.globalAlpha = lens.alpha * (0.05 + (5 - i) * 0.045);
				context.beginPath();
				context.arc(x, mid, Math.max(halfWidth, halfHeight) * (1 + i * 0.65), 0, Math.PI * 2);
				context.fillStyle = body.color;
				context.fill();
			}
			context.strokeStyle = 'rgba(255, 231, 174, 0.55)';
			context.lineWidth = 1;
			for (i = 0; i < 8; i += 1) {
				angle = i * Math.PI / 4;
				context.beginPath();
				context.moveTo(x + Math.cos(angle) * halfWidth * 1.25, mid + Math.sin(angle) * halfWidth * 1.25);
				context.lineTo(x + Math.cos(angle) * halfWidth * 1.7, mid + Math.sin(angle) * halfWidth * 1.7);
				context.stroke();
			}
		}
		context.globalAlpha = lens.alpha;
		if (thin) {
			// The disc, lit from the same side as the lens would be.
			context.beginPath();
			context.arc(x, mid, icon, 0, Math.PI * 2);
			context.fillStyle = body.color;
			context.fill();
			context.save();
			context.clip();
			context.globalAlpha = lens.alpha * 0.5;
			context.fillStyle = body.shade;
			context.fillRect(x + (1 - lens.shade) * icon * 1.2, mid - icon,
				icon * 2, icon * 2);
			context.restore();
			context.beginPath();
			context.arc(x, mid, icon, 0, Math.PI * 2);
			context.globalAlpha = lens.alpha;
			context.lineWidth = 1;
			context.strokeStyle = 'rgba(226, 240, 247, 0.45)';
			context.stroke();
		} else {
			lensPath(context, lens);
			context.fillStyle = body.color;
			context.fill();
			// The shaded side is turned away from the star, the same lighting
			// rule the ship uses.
			context.save();
			context.clip();
			context.globalAlpha = lens.alpha * 0.55;
			context.fillStyle = body.shade;
			context.fillRect(x + (1 - lens.shade) * halfWidth * 1.4, mid - halfHeight * 2,
				halfWidth * 1.6, halfHeight * 4);
			context.restore();
			lensPath(context, lens);
			context.globalAlpha = lens.alpha;
			context.lineWidth = 1;
			context.strokeStyle = 'rgba(226, 240, 247, 0.35)';
			context.stroke();
		}
		context.restore();
		if (render.width >= 650) {
			// Above the disc normally; under it when the body is charted close to
			// the top edge, so the name is never clipped away.
			context.font = '600 9px ui-monospace, SFMono-Regular, Menlo, monospace';
			context.textAlign = 'center';
			context.fillStyle = 'rgba(211, 228, 235, 0.82)';
			context.fillText(body.name.toUpperCase(), x,
				mid - halfHeight - 6 > 12 ? mid - halfHeight - 6 : mid + halfHeight + 12);
		}
	}

	// The body the chart is seated on is the ground, so its whole sphere is
	// drawn as the cutaway below the ground line: the same map that puts its
	// surface on the line sends its interior down the screen.
	function drawGroundBody(context, body) {
		var camera = R.camera;
		var top = camera.groundY;
		var bottom = camera.height;
		var radius = R.sky.pivot.radius;
		var y;

		if (bottom - top < 2) {
			return;
		}
		// The interior is the log band from the surface down to the centre. A
		// single fill is enough: the layers are a later slice.
		y = camera.oy - camera.scalePx * Math.log(radius * 0.35);
		context.fillStyle = body.shade;
		context.fillRect(0, top, render.width, bottom - top);
		context.fillStyle = 'rgba(180, 199, 173, 0.16)';
		context.fillRect(0, Math.min(bottom, y), render.width, 1);
	}

	// The orbits of the catalog, charted by the same map as the lenses. Each
	// polyline is drawn in every periodic copy that touches the viewport, and a
	// sample the chart cannot place (inside the pivot body, or ON the pole)
	// breaks the path instead of flinging a chord across the screen.
	function drawOrbits(context, game) {
		var bodies = R.constants.sky.bodies;
		var lens = R.sky.orbitShape;
		var width = render.width;
		var x;
		var y;
		var copy;
		var copies;
		var started;
		var b;
		var j;

		context.save();
		context.lineWidth = 1;
		context.strokeStyle = R.camera.flat ? 'rgba(150, 190, 214, 0.16)' : 'rgba(150, 190, 214, 0.22)';
		for (b = 0; b < bodies.length; b += 1) {
			R.sky.orbit(b);
			if (!lens.valid || lens.count < 2) {
				continue;
			}
			copies = Math.max(1, Math.ceil(width / Math.max(1, lens.period)) + 1);
			for (copy = -copies; copy <= copies; copy += 1) {
				started = false;
				context.beginPath();
				for (j = 0; j <= lens.xs.length - 1; j += 1) {
					x = lens.xs[j] + copy * lens.period;
					y = lens.ys[j];
					if (!Number.isFinite(x) || !Number.isFinite(y)) {
						started = false;
						continue;
					}
					if (x < -width * 0.25 || x > width * 1.25) {
						started = false;
						continue;
					}
					if (!started) {
						context.moveTo(x, y);
						started = true;
					} else {
						context.lineTo(x, y);
					}
				}
				context.stroke();
			}
		}
		context.restore();
	}

	function drawSkyBodies(context, game) {
		var bodies = R.constants.sky.bodies;
		var lens = R.sky.shape;
		var ground = R.sky.pivot.index;
		var i;

		for (i = -1; i < bodies.length; i += 1) {
			if (i === ground && !R.sky.pivot.reseating) {
				drawGroundBody(context, i < 0 ? R.sky.world : bodies[i]);
				continue;
			}
			R.sky.outline(i, game);
			drawSkyBody(context, i < 0 ? R.sky.world : bodies[i], lens, i);
		}
	}

	// On the deck a longitude is wrapped to the copy nearest the viewport, so a
	// path that crosses the world seam breaks instead of drawing a line across
	// the whole chart. Away from the world the chart already has the seam built
	// in (X is an angle), so the longitude goes through untouched.
	function chartWorldX(wx) {
		return R.camera.flat ?
			R.coords.nearestPeriodicX(wx, R.camera.leftWx, R.world.planet.circumference) : wx;
	}

	function projectPathPoint(wx, wy, out) {
		return R.camera.project(chartWorldX(wx), wy, out);
	}

	function drawCoastTrace(context) {
		var trace = R.trajectory.trace;
		var point = render.scratch.path;
		var previousX = 0;
		var began = false;
		var i;

		if (!trace || trace.count < 2) {
			return;
		}
		context.save();
		context.setLineDash(dashAim);
		context.lineWidth = 1.4;
		context.strokeStyle = 'rgba(100, 213, 194, 0.5)';
		context.beginPath();
		for (i = 0; i < trace.count; i += 1) {
			projectPathPoint(trace.points[i * 2], trace.points[i * 2 + 1], point);
			if (!began || Math.abs(point.x - previousX) > render.width * 0.5) {
				context.moveTo(point.x, point.y);
			} else {
				context.lineTo(point.x, point.y);
			}
			began = true;
			previousX = point.x;
		}
		context.stroke();
		context.setLineDash(dashSolid);
		context.restore();
	}

	function drawTrailRange(context, first, length, alpha) {
		var path = R.flightPath;
		var point = render.scratch.path;
		var start = (path.head - path.count + path.capacity) % path.capacity;
		var previousX = 0;
		var began = false;
		var index;
		var i;

		context.globalAlpha = alpha;
		context.lineWidth = 1.8;
		context.strokeStyle = '#f4c76a';
		context.beginPath();
		for (i = first; i < first + length; i += 1) {
			index = (start + i) % path.capacity;
			projectPathPoint(path.points[index * 2], path.points[index * 2 + 1], point);
			if (!began || Math.abs(point.x - previousX) > render.width * 0.5) {
				context.moveTo(point.x, point.y);
			} else {
				context.lineTo(point.x, point.y);
			}
			began = true;
			previousX = point.x;
		}
		context.stroke();
		context.globalAlpha = 1;
	}

	function drawTrajectories(context) {
		var count = R.flightPath.count;
		var tail;

		drawCoastTrace(context);
		if (count < 2) {
			return;
		}
		drawTrailRange(context, 0, count, 0.26);
		tail = Math.max(2, Math.floor(count * 0.35));
		drawTrailRange(context, count - tail, tail, 0.85);
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
		var camera = R.camera;
		var point = render.scratch.marker;
		var i;
		var y;

		// The ladder is the active world's altimeter. On the deck it is the
		// chart's own Y axis; seated elsewhere the axis is distance from the
		// pivot, so a world-relative scale would lie.
		if (!camera.flat) {
			return;
		}
		context.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
		context.textAlign = 'left';
		context.fillStyle = 'rgba(184, 207, 218, 0.72)';
		context.fillText('ALTITUDE  /  LOG SCALE', 24, 173);

		for (i = 0; i < marks.length; i += 1) {
			if (marks[i].altitude > camera.ceiling) {
				continue;
			}
			R.camera.project(0, marks[i].altitude, point);
			y = point.y;
			if (y < 20 || y > camera.groundY - 16) {
				continue;
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
		var panelHeight = 112;
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
		context.textAlign = 'left';
		context.fillStyle = '#93aebc';
		context.fillText('ESCAPE SPEED', x + 16, y + 101);
		context.textAlign = 'right';
		context.fillStyle = '#f4c76a';
		context.fillText(Math.round(R.physics.escapeSpeedAtAltitude(0)), x + panelWidth - 55, y + 101);
		context.fillText('m/s', x + panelWidth - 16, y + 101);
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
		var panelHeight = 452;
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

		// Damage: how far the stage that is burning is from scrap, and the
		// failure that has just happened. Both come from the same model the
		// log and the repair bill read.
		context.fillStyle = '#a8bac2';
		context.textAlign = 'left';
		context.fillText('STRUCTURE', x + 16, y + 228);
		context.textAlign = 'right';
		context.fillStyle = R.damage.stageStress >= R.constants.damage.scrapStress ? '#f1a89d' :
			(R.damage.stageStress > 0 ? '#f4c76a' : '#829ba6');
		context.fillText(R.damage.stageStress > 0 ? Math.round(R.damage.stageStress * 100) + ' %' : '—',
			x + panelWidth - 16, y + 228);
		drawBar(context, x + 16, y + 235, panelWidth - 32, R.damage.stageStress,
			R.damage.stageStress >= R.constants.damage.scrapStress ? '#f1a89d' : '#f4c76a');

		context.textAlign = 'left';
		context.fillStyle = '#a8bac2';
		context.fillText('ALARM', x + 16, y + 254);
		context.textAlign = 'right';
		context.fillStyle = R.damage.alarmTime > 0 ? '#f1a89d' : '#829ba6';
		context.fillText(R.damage.alarmTime > 0 ? R.damage.alarmLabel() : '—', x + panelWidth - 16, y + 254);

		context.fillStyle = '#a8bac2';
		context.textAlign = 'left';
		context.fillText('BALANCE', x + 16, y + 274);
		context.fillStyle = '#e7eff6';
		context.textAlign = 'right';
		context.fillText('$', x + panelWidth - 58, y + 274);
		context.fillText(Math.round(game.cash), x + panelWidth - 16, y + 274);

		context.textAlign = 'left';
		context.fillStyle = '#a8bac2';
		context.fillText('FLIGHT Δ', x + 16, y + 294);
		context.textAlign = 'right';
		context.fillStyle = game.flight.cashDelta >= 0 ? '#91e3d3' : '#f1a89d';
		context.fillText(game.flight.cashDelta < 0 ? '−$' : '+$', x + panelWidth - 58, y + 294);
		context.fillText(Math.round(Math.abs(game.flight.cashDelta)), x + panelWidth - 16, y + 294);

		context.fillStyle = '#a8bac2';
		context.textAlign = 'left';
		context.fillText('AUTOPILOT', x + 16, y + 315);
		context.textAlign = 'right';
		if (R.autopilot.enabled) {
			context.fillStyle = '#7de0ca';
			context.fillText(R.autopilot.label(), x + panelWidth - 16, y + 315);
		} else {
			context.fillStyle = '#829ba6';
			context.fillText('OFF', x + panelWidth - 16, y + 315);
		}

		// Why the guidance is holding back, with the profile whose limits it flies.
		context.textAlign = 'left';
		context.fillStyle = '#a8bac2';
		context.fillText('LIMITER', x + 16, y + 336);
		context.textAlign = 'right';
		if (!R.autopilot.enabled) {
			context.fillStyle = '#829ba6';
			context.fillText('OFF', x + panelWidth - 16, y + 336);
		} else {
			context.fillStyle = R.autopilot.limiter ? '#f4c76a' : '#829ba6';
			context.fillText(R.autopilot.limiter ? R.autopilot.limiterLabel() : '—', x + panelWidth - 16, y + 336);
			context.textAlign = 'left';
			context.fillStyle = '#829ba6';
			context.fillText(R.autopilot.profileById(game.flight.autopilotProfile).label, x + 74, y + 336);
		}

		// The coast forecast: where an engine-off trajectory from this state
		// reaches the ground, how far that is from the selected pad, and how
		// hard it arrives. It is a projection, not a promise: the autopilot
		// keeps burning and lands where its own guidance takes it.
		context.textAlign = 'left';
		context.fillStyle = '#a8bac2';
		context.fillText('COAST IMPACT', x + 16, y + 357);
		context.textAlign = 'right';
		if (!impact.valid) {
			context.fillStyle = '#829ba6';
			context.fillText('OUT OF HORIZON', x + panelWidth - 16, y + 357);
		} else if (impact.onTargetPad) {
			context.fillStyle = '#7de0ca';
			context.fillText('ON TARGET PAD', x + panelWidth - 16, y + 357);
		} else {
			coastError = Math.abs(impact.targetError);
			context.fillStyle = impact.safeTouchdown ? '#f4c76a' : '#f1a89d';
			context.fillText(coastError >= 1000 ? (coastError / 1000).toFixed(1) : String(Math.round(coastError)), x + panelWidth - 50, y + 357);
			context.textAlign = 'left';
			context.fillText(coastUnits[(impact.targetError >= 0 ? 1 : 0) + (coastError >= 1000 ? 2 : 0)], x + panelWidth - 48, y + 357);
		}

		context.textAlign = 'left';
		context.fillStyle = '#a8bac2';
		context.fillText('COAST TOUCHDOWN', x + 16, y + 377);
		context.textAlign = 'right';
		if (!impact.valid) {
			context.fillStyle = '#829ba6';
			context.fillText('—', x + panelWidth - 16, y + 377);
		} else {
			context.fillStyle = impact.safeTouchdown ? '#7de0ca' : '#f1a89d';
			context.fillText('V', x + panelWidth - 116, y + 377);
			context.fillText(Math.abs(impact.vy).toFixed(1), x + panelWidth - 66, y + 377);
			context.fillText('H', x + panelWidth - 56, y + 377);
			context.fillText(Math.abs(impact.vx).toFixed(1), x + panelWidth - 16, y + 377);
		}

		context.textAlign = 'left';
		context.fillStyle = '#a8bac2';
		context.fillText('TIME SCALE', x + 16, y + 398);
		context.textAlign = 'right';
		context.fillStyle = '#e7eff6';
		context.fillText(timeLabel(game), x + panelWidth - 16, y + 398);

		// Escape speed is read from the same GM the integrator uses. Above the
		// atmosphere a faster rocket is unbound in this model, which is a
		// readout, not a mission result.
		context.textAlign = 'left';
		context.fillStyle = '#a8bac2';
		context.fillText('ESCAPE', x + 16, y + 416);
		if (R.physics.isUnbound(rocket)) {
			context.fillStyle = '#f4c76a';
			context.fillText('UNBOUND', x + 74, y + 416);
		}
		context.textAlign = 'right';
		context.fillStyle = '#e7eff6';
		context.fillText(Math.round(R.physics.escapeSpeedAtAltitude(rocket.wy)), x + panelWidth - 38, y + 416);
		context.fillStyle = '#a8bac2';
		context.fillText('m/s', x + panelWidth - 16, y + 416);

		context.fillStyle = '#829ba6';
		context.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
		context.textAlign = 'left';
		context.fillText('A  AUTOPILOT    [ ]  TIME    SHIFT/CTRL  THROTTLE', x + 16, y + 438);
	}

	function drawPilotHud(context, game) {
		var rocket = game.rocket;
		var flight = game.flight;
		var margin = Math.min(24, render.width * 0.05);
		var panelWidth = 250;
		var stageRows = rocket.stageCount;
		var panelHeight = 220 + stageRows * 26;
		var x = margin;
		var y = 172;
		var safeVy = rocket.fragileCargo ?
			R.world.planet.landingVerticalSpeed * R.constants.market.fragileSpeedFactor :
			R.world.planet.landingVerticalSpeed;
		var dvLeft = R.rocket.remainingDeltaV(rocket);
		var dvMax = flight.launchDeltaV > 0 ? flight.launchDeltaV : Math.max(dvLeft, 1);
		var fuelTotal = 0;
		var fuelCap = 0;
		var activeIndex = R.rocket.nextAliveStageIndex(rocket, rocket.currentStage);
		var nextIndex = activeIndex >= 0 ? R.rocket.nextAliveStageIndex(rocket, activeIndex + 1) : -1;
		var st;
		var rowY;
		var i;

		if (render.width < 650) {
			return;
		}
		for (i = 0; i < stageRows; i += 1) {
			st = rocket.stages[i];
			fuelCap += st.fuelMax;
			if (st.alive) {
				fuelTotal += st.fuelMass;
			}
		}

		drawPanel(context, x, y, panelWidth, panelHeight);
		context.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
		context.textAlign = 'left';
		context.fillStyle = R.constants.render.mutedText;
		context.fillText('PILOT & CARGO', x + 16, y + 22);
		context.textAlign = 'right';
		context.fillStyle = R.autopilot.enabled ? '#7de0ca' : '#f4c76a';
		context.fillText(pilotModeLabel(), x + panelWidth - 16, y + 22);

		// Vertical speed against the world or fragile touchdown limit.
		context.textAlign = 'left';
		context.fillStyle = '#a8bac2';
		context.fillText('V-SPEED', x + 16, y + 44);
		context.fillStyle = '#829ba6';
		context.fillText('MAX', x + 76, y + 44);
		context.fillText(safeVy.toFixed(1), x + 101, y + 44);
		context.textAlign = 'right';
		context.fillStyle = rocket.vy < -safeVy ? '#f1a89d' : (rocket.vy < 0 ? '#7de0ca' : '#e7eff6');
		context.fillText(rocket.vy >= 0 ? '▲' : '▼', x + panelWidth - 82, y + 44);
		context.fillText(Math.abs(rocket.vy).toFixed(1), x + panelWidth - 42, y + 44);
		context.fillStyle = '#a8bac2';
		context.fillText('m/s', x + panelWidth - 16, y + 44);

		// Cargo mass, fragile warning and payout aboard.
		context.textAlign = 'left';
		context.fillStyle = '#a8bac2';
		context.fillText('CARGO', x + 16, y + 64);
		if (rocket.fragileCargo) {
			context.fillStyle = '#f4c76a';
			context.fillText('FRAGILE', x + 64, y + 64);
		}
		if (flight.rewardQuote > 0) {
			context.fillStyle = '#91e3d3';
			context.fillText('$', x + 124, y + 64);
			context.fillText(Math.round(flight.rewardQuote), x + 132, y + 64);
		}
		context.textAlign = 'right';
		context.fillStyle = '#e7eff6';
		context.fillText(Math.round(rocket.payloadMass), x + panelWidth - 38, y + 64);
		context.fillStyle = '#a8bac2';
		context.fillText('kg', x + panelWidth - 16, y + 64);

		// Remaining ideal staged delta-v.
		context.textAlign = 'left';
		context.fillStyle = '#a8bac2';
		context.fillText('DELTA-V LEFT', x + 16, y + 85);
		context.textAlign = 'right';
		context.fillStyle = '#e7eff6';
		context.fillText(Math.round(dvLeft), x + panelWidth - 44, y + 85);
		context.fillStyle = '#a8bac2';
		context.fillText('m/s', x + panelWidth - 16, y + 85);
		drawBar(context, x + 16, y + 92, panelWidth - 32, dvLeft / dvMax, '#64d5c2');

		// Total fuel left across all attached stages.
		context.textAlign = 'left';
		context.fillStyle = '#a8bac2';
		context.fillText('TOTAL FUEL', x + 16, y + 114);
		context.textAlign = 'right';
		context.fillStyle = '#e7eff6';
		context.fillText(Math.round(fuelTotal), x + panelWidth - 38, y + 114);
		context.fillStyle = '#a8bac2';
		context.fillText('kg', x + panelWidth - 16, y + 114);
		drawBar(context, x + 16, y + 121, panelWidth - 32, fuelCap > 0 ? fuelTotal / fuelCap : 0, '#65d5c1');

		// One row per stage so multistage burns and separations are readable at a glance.
		for (i = 0; i < stageRows; i += 1) {
			st = rocket.stages[i];
			rowY = y + 144 + i * 26;
			context.textAlign = 'left';
			context.fillStyle = i === activeIndex ? '#e7eff6' : '#829ba6';
			context.fillText(stageLabels[i], x + 16, rowY);
			if (!st.alive) {
				context.fillStyle = '#829ba6';
				context.fillText('SPENT', x + 44, rowY);
			} else if (i === activeIndex) {
				context.fillStyle = st.fuelMass <= 0 && nextIndex >= 0 ? '#f4c76a' : '#7de0ca';
				context.fillText(st.fuelMass <= 0 && nextIndex >= 0 ? 'EMPTY · SPACE!' : 'BURNING', x + 44, rowY);
			} else if (i === nextIndex) {
				context.fillStyle = '#c8ddd9';
				context.fillText(R.autopilot.enabled ? 'NEXT · AUTO' : 'NEXT · SPACE', x + 44, rowY);
			} else {
				context.fillStyle = '#829ba6';
				context.fillText('UPPER', x + 44, rowY);
			}
			context.textAlign = 'right';
			context.fillStyle = st.alive ? '#e7eff6' : '#829ba6';
			if (st.alive) {
				context.fillText(Math.round(st.fuelMass), x + panelWidth - 38, rowY);
				context.fillStyle = '#a8bac2';
				context.fillText('kg', x + panelWidth - 16, rowY);
			} else {
				context.fillText('—', x + panelWidth - 16, rowY);
			}
			drawBar(context, x + 16, rowY + 6, panelWidth - 32,
				st.alive && st.fuelMax > 0 ? st.fuelMass / st.fuelMax : 0,
				i === activeIndex ? '#65d5c1' : '#4a6b78');
		}

		// Explicit controls legend inside the HUD.
		rowY = y + 146 + stageRows * 26;
		context.textAlign = 'left';
		context.fillStyle = '#a8bac2';
		context.fillText('AIM', x + 16, rowY);
		context.textAlign = 'right';
		context.fillStyle = '#e7eff6';
		context.fillText(R.autopilot.enabled ? 'AUTO GUIDANCE' : 'MOUSE CURSOR', x + panelWidth - 16, rowY);

		context.textAlign = 'left';
		context.fillStyle = '#a8bac2';
		context.fillText('THRUST', x + 16, rowY + 18);
		context.textAlign = 'right';
		context.fillStyle = '#e7eff6';
		context.fillText(R.autopilot.enabled ? 'AUTO THROTTLE' : 'SHIFT ▲ / CTRL ▼', x + panelWidth - 16, rowY + 18);

		context.textAlign = 'left';
		context.fillStyle = '#a8bac2';
		context.fillText('STAGE', x + 16, rowY + 36);
		context.textAlign = 'right';
		context.fillStyle = nextIndex >= 0 && !R.autopilot.enabled ? '#f4c76a' : '#e7eff6';
		context.fillText(nextIndex >= 0 ? (R.autopilot.enabled ? 'AUTO STAGE' : 'SPACE SEPARATES') : 'FINAL STAGE',
		x + panelWidth - 16, rowY + 36);

		// How to switch pilots is a control row like the three above it: the
		// key named here is the same one the flight strip button presses.
		context.textAlign = 'left';
		context.fillStyle = '#a8bac2';
		context.fillText('PILOT', x + 16, rowY + 54);
		context.textAlign = 'right';
		context.fillStyle = '#e7eff6';
		context.fillText(R.autopilot.enabled ? 'A · TAKE OVER' : 'A · HAND TO AUTOPILOT',
		x + panelWidth - 16, rowY + 54);
	}

	// A cold manual start sits on the pad until the player lights the engine,
	// so the prompt is drawn attached to the rocket and disappears on thrust.
	function drawLaunchPrompt(context, rx, ry) {
		var y = ry - 118;

		drawPanel(context, rx - 148, y, 296, 44);
		context.textAlign = 'center';
		context.fillStyle = '#f4c76a';
		context.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
		context.fillText(launchPrompt, rx, y + 18);
		context.fillStyle = '#c8ddd9';
		context.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
		context.fillText(launchPromptDetail, rx, y + 34);
	}

	function drawFlightGuides(context, game) {
		var rocket = game.rocket;
		var rx = render.scratch.rocket.x;
		var ry = render.scratch.rocket.y;
		var speed = Math.hypot(rocket.vx, rocket.vy);
		var vLen;
		var vxDir;
		var vyDir;
		var target = R.world.findPadById(game.targetPadId);
		var deltaX = target ? R.util.wrapDelta(target.wx - rocket.wx, R.world.planet.circumference) : 0;

		// Aim tick ahead of the nose, and dashed line to cursor in manual flight.
		context.save();
		context.strokeStyle = 'rgba(244, 199, 106, 0.75)';
		context.lineWidth = 1.5;
		context.setLineDash(dashAim);
		context.beginPath();
		context.moveTo(rx + Math.sin(rocket.heading) * 34, ry - Math.cos(rocket.heading) * 34);
		if (!R.autopilot.enabled && R.input.pointerActive) {
			context.lineTo(R.input.pointerX, R.input.pointerY);
		} else {
			context.lineTo(rx + Math.sin(rocket.heading) * 62, ry - Math.cos(rocket.heading) * 62);
		}
		context.stroke();
		context.setLineDash(dashSolid);

		// Prograde velocity vector so drift and sink direction are drawn directly.
		if (speed > 2) {
			vLen = R.util.clamp(speed * 0.25, 20, 66);
			vxDir = rocket.vx / speed;
			vyDir = -rocket.vy / speed;
			context.strokeStyle = 'rgba(100, 213, 194, 0.85)';
			context.lineWidth = 1.8;
			context.beginPath();
			context.moveTo(rx, ry - 12);
			context.lineTo(rx + vxDir * vLen, ry - 12 + vyDir * vLen);
			context.stroke();
			context.beginPath();
			context.arc(rx + vxDir * vLen, ry - 12 + vyDir * vLen, 3, 0, Math.PI * 2);
			context.fillStyle = '#64d5c2';
			context.fill();
		}

		// Target-pad horizontal bearing above the rocket.
		if (Math.abs(deltaX) > 60) {
			context.font = '600 9px ui-monospace, SFMono-Regular, Menlo, monospace';
			context.textAlign = 'center';
			context.fillStyle = '#f4c76a';
			context.fillText(deltaX > 0 ? 'TARGET ►' : '◄ TARGET', rx, ry - 46);
		}
		if (R.physics.isUnbound(rocket)) {
			context.font = '700 10px ui-monospace, SFMono-Regular, Menlo, monospace';
			context.textAlign = 'center';
			context.fillStyle = '#f4c76a';
			context.fillText('ESCAPE', rx, ry - 62);
		}
		// A cold manual start sits at pad level with the engine unlit, and the
		// rocket does not move until the player throttles up.
		if (!R.autopilot.enabled && rocket.throttle <= 0 && rocket.wy <= 0) {
			drawLaunchPrompt(context, rx, ry);
		}
		context.restore();
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
		// Above the ground strip normally; held at the bottom of the viewport
		// when the camera has followed the ship and the ground is off-screen.
		var y = R.util.clamp(R.camera.groundY - 46, 12, Math.max(12, render.height - 42));
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

	function drawExplosion(context, game) {
		var effect = game.explosion;
		var duration = R.constants.damage.ruptureExplosionSeconds;
		var age;
		var progress;
		var radius;
		var center;
		var angle;
		var i;

		if (!effect) {
			return;
		}
		age = game.simTime - effect.startedAt;
		if (age < 0 || age >= duration) {
			return;
		}
		progress = age / duration;
		radius = 8 + progress * 42;
		center = R.camera.project(effect.wx, effect.wy, render.scratch.explosion);
		context.save();
		context.globalAlpha = 1 - progress;
		context.beginPath();
		context.arc(center.x, center.y, radius, 0, Math.PI * 2);
		context.fillStyle = '#f4c76a';
		context.fill();
		context.beginPath();
		for (i = 0; i < 8; i += 1) {
			angle = i * Math.PI / 4;
			context.moveTo(center.x + Math.cos(angle) * radius * 0.55,
				center.y + Math.sin(angle) * radius * 0.55);
			context.lineTo(center.x + Math.cos(angle) * (radius + 16),
				center.y + Math.sin(angle) * (radius + 16));
		}
		context.strokeStyle = '#f28b82';
		context.lineWidth = 3;
		context.stroke();
		context.restore();
	}

	// Just the chart: sky shade, stars, the air band, every body's lens in the
	// system, the altitude ladder and the ground. `render.draw` adds the game
	// on top; the projection test page calls this directly.
	render.drawChart = function(context, game) {
		context.clearRect(0, 0, render.width, render.height);
		context.fillStyle = render.skyGradient;
		context.fillRect(0, 0, render.width, render.height);
		R.sky.ensure();
		drawSkyShade(context);
		drawStars(context);
		drawAirBand(context);
		drawOrbits(context, game);
		drawSkyBodies(context, game);
		drawAltitudeScale(context);
		drawGround(context);
	};

	// A point marker for the projection page: the thing whose motion the chart
	// is being tested against.
	render.drawProbe = function(context, wx, wy) {
		var point = render.scratch.marker;

		R.camera.project(wx, wy, point);
		context.beginPath();
		context.arc(point.x, point.y, 5, 0, Math.PI * 2);
		context.fillStyle = '#f4c76a';
		context.fill();
		context.beginPath();
		context.arc(point.x, point.y, 11, 0, Math.PI * 2);
		context.strokeStyle = 'rgba(244, 199, 106, 0.45)';
		context.lineWidth = 1;
		context.stroke();
	};

	render.draw = function(game) {
		var context = render.context;
		var rocket = game.rocket;
		var stage = R.rocket.activeStage(rocket);
		var flameThrottle = stage && stage.fuelMass > 0 ? rocket.throttle : 0;

		context.clearRect(0, 0, render.width, render.height);
		context.fillStyle = render.skyGradient;
		context.fillRect(0, 0, render.width, render.height);
		R.sky.ensure();
		drawSkyShade(context);
		drawStars(context);
		drawAirBand(context);
		drawOrbits(context, game);
		drawSkyBodies(context, game);
		drawAltitudeScale(context);
		drawGround(context);
		drawLegArc(context, game);
		drawPads(context, game);
		drawTrajectories(context);
		drawCoastMarker(context, game);

		R.camera.project(rocket.wx, rocket.wy, render.scratch.rocket);
		if (game.phase === 'flying') {
			drawFlightGuides(context, game);
		}
		R.rocket.draw(context, render.scratch.rocket.x, render.scratch.rocket.y, rocket.heading, flameThrottle);
		drawExplosion(context, game);
		drawMissionPanel(context, game);
		if (game.phase === 'flying') {
			drawPilotHud(context, game);
			drawFlightTelemetry(context, game);
			if (render.width >= 650) {
				drawStatusStrip(context, game);
			}
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
