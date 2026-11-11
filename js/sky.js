(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var sky = R.sky || (R.sky = {});
	var settings = R.constants.sky;
	var viewSettings = R.constants.view;
	var bodies = settings.bodies;
	var view = {
		planetId: '',
		logScale: 0,
		ceiling: 0,
		gravity: 0,
		radius: 0,
		atmosphereTop: 0,
		morph: 1,
		from: { logScale: 0, ceiling: 0, gravity: 0, radius: 0, atmosphereTop: 0 },
		target: { logScale: 0, ceiling: 0 }
	};

	sky.view = view;
	sky.bodies = bodies;
	sky.focus = { index: -1, distance: 0, altitude: 0, radius: 0, approach: 0 };
	sky.projection = {
		x: 0, y: 0, radius: 0, elevation: 0, azimuth: 0, visible: false,
		shade: 0, distance: 0, angularRadius: 0
	};

	function smoothstep(t) {
		return t * t * (3 - 2 * t);
	}

	function ease(current, target, dt, tau) {
		return current + (target - current) * (1 - Math.exp(-dt / tau));
	}

	function captureOutgoing() {
		view.from.logScale = view.logScale;
		view.from.ceiling = view.ceiling;
		view.from.gravity = view.gravity;
		view.from.radius = view.radius;
		view.from.atmosphereTop = view.atmosphereTop;
	}

	// First draw of a session: seed the view from the active world without a
	// transition. A later world switch is handled by update().
	sky.ensure = function() {
		var planet;

		if (view.planetId !== '') {
			return;
		}
		planet = R.world.planet;
		view.planetId = planet.id;
		view.logScale = planet.logAltitudeScale;
		view.ceiling = planet.maxAltitude;
		view.gravity = planet.surfaceGravity;
		view.radius = planet.radius;
		view.atmosphereTop = R.physics.atmosphereTop();
		view.morph = 1;
		captureOutgoing();
		R.camera.setRange(view.logScale, view.ceiling);
	};

	// Which catalog body the rocket is closest to in log radial distance.
	sky.nearestBody = function(r) {
		var best = Infinity;
		var index = 0;
		var distance;
		var difference;
		var body;
		var i;

		for (i = 0; i < bodies.length; i += 1) {
			distance = bodies[i].distanceRadii * view.radius;
			difference = Math.abs(Math.log(r / distance));
			if (difference < best) {
				best = difference;
				index = i;
			}
		}
		body = bodies[index];
		sky.focus.index = index;
		sky.focus.distance = body.distanceRadii * view.radius;
		sky.focus.altitude = Math.max(0, sky.focus.distance - view.radius);
		sky.focus.radius = body.radiusRadii * view.radius;
		sky.focus.approach = R.util.clamp(1 - best / settings.approachLogSpan, 0, 1);
		return sky.focus;
	};

	function computeTarget(game, planet, blend) {
		var altitude = game && game.rocket ? Math.max(0, game.rocket.wy) : 0;
		var focus = sky.nearestBody(view.radius + altitude);
		var atmosphere = view.atmosphereTop;
		var climb = R.util.clamp((altitude - atmosphere * 0.5) /
			Math.max(1, focus.altitude - atmosphere * 0.5), 0, 1);
		var ceilingGoal = Math.max(planet.maxAltitude, altitude * settings.ceilingMargin,
			focus.altitude * (0.25 + 0.75 * climb));
		var scaleGoal = planet.logAltitudeScale +
			(focus.radius * settings.bodyScaleFraction - planet.logAltitudeScale) * focus.approach;

		view.target.logScale = view.from.logScale + (scaleGoal - view.from.logScale) * blend;
		view.target.ceiling = view.from.ceiling + (ceilingGoal - view.from.ceiling) * blend;
	}

	// Ease the visual transform. Physics reads the new planet immediately at a
	// world switch; only gravity, radius, air ceiling and the log scale morph.
	sky.update = function(game, dt) {
		var planet = R.world.planet;
		var step = R.util.clamp(dt, 0, 0.25);
		var blend;

		sky.ensure();
		if (view.planetId !== planet.id) {
			captureOutgoing();
			view.planetId = planet.id;
			view.morph = 0;
		}
		view.morph = Math.min(1, view.morph + step / viewSettings.transformSeconds);
		blend = smoothstep(view.morph);
		computeTarget(game, planet, blend);
		view.logScale = ease(view.logScale, view.target.logScale, step, settings.easeTau);
		view.ceiling = ease(view.ceiling, view.target.ceiling, step, settings.easeTau);
		view.gravity = view.from.gravity + (planet.surfaceGravity - view.from.gravity) * blend;
		view.radius = view.from.radius + (planet.radius - view.from.radius) * blend;
		view.atmosphereTop = view.from.atmosphereTop +
			(R.physics.atmosphereTop() - view.from.atmosphereTop) * blend;
		R.camera.setRange(view.logScale, view.ceiling);
		return view;
	};

	// Azimuthal equidistant sky dome: a body's direction and angular size come
	// from its polar orbit geometry and the observer's longitude / altitude,
	// never from a hand-picked sprite position.
	sky.projectBody = function(body, game, out) {
		var planet = R.world.planet;
		var camera = R.camera;
		var radius = view.radius;
		var distance = body.distanceRadii * radius;
		var bodyRadius = body.radiusRadii * radius;
		var altitude = game && game.rocket ? Math.max(0, game.rocket.wy) : 0;
		var rocketWx = game && game.rocket ? game.rocket.wx : 0;
		var simTime = game && game.simTime ? game.simTime : 0;
		var circumference = planet.circumference;
		var longitude = body.longitude + simTime * body.orbitRate / (2 * Math.PI);
		var bodyWx = longitude * circumference;
		var theta = 2 * Math.PI * R.util.wrapDelta(bodyWx - rocketWx, circumference) / circumference;
		var horizontal = distance * Math.sin(theta);
		var vertical = distance * Math.cos(theta) - (radius + altitude);
		var observerDistance = Math.sqrt(horizontal * horizontal + vertical * vertical);
		var horizonAngle = Math.acos(R.util.clamp((radius + altitude) / distance, -1, 1));
		var maxAngle = Math.max(0.2, Math.min(viewSettings.skyHorizonAngle, horizonAngle));
		var elevation = Math.atan2(vertical, Math.abs(horizontal));
		var azimuth = Math.atan2(horizontal, Math.max(vertical, 1e-6));
		var angularRadius = Math.asin(R.util.clamp(bodyRadius / Math.max(1, observerDistance), 0, 1));
		var star = bodies[0];
		var starWx = (star.longitude + simTime * star.orbitRate / (2 * Math.PI)) * circumference;
		var starTheta = 2 * Math.PI * R.util.wrapDelta(starWx - rocketWx, circumference) / circumference;
		var skyTop = camera.usableHeight * 0.02;
		var skyBottom = camera.usableHeight * viewSettings.skyBandFraction;

		out.visible = vertical > 0 && elevation > 0;
		out.x = R.util.clamp(camera.width * 0.5 + camera.width * 0.5 * azimuth / maxAngle,
			-camera.width, camera.width * 2);
		out.y = R.util.clamp(skyBottom - (skyBottom - skyTop) * elevation / (Math.PI * 0.5),
			skyTop, skyBottom);
		out.radius = R.util.clamp(angularRadius / maxAngle * camera.width * 0.5,
			viewSettings.minBodyRadius, viewSettings.maxBodyRadius);
		out.elevation = elevation;
		out.azimuth = azimuth;
		out.shade = R.util.clamp(0.55 + 0.45 * Math.cos(theta - starTheta), 0, 1);
		out.distance = observerDistance;
		out.angularRadius = angularRadius;
		return out;
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = sky;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
