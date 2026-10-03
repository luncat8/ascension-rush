(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var controls = R.controls || (R.controls = {});

	var throttleUp = false;
	var throttleDown = false;
	var headingScreen = { x: 0, y: 0 };

	function isFormTarget(event) {
		var target = event.target;
		var tagName = target && target.tagName;

		return tagName === 'INPUT' || tagName === 'SELECT' || tagName === 'TEXTAREA' || tagName === 'BUTTON';
	}

	function requestStage() {
		if (R.game && R.game.phase === 'flying') {
			R.rocket.separateStage(R.game.rocket);
		}
	}

	function adjustTimeScale(step) {
		var scales = R.constants.time.scales;
		var index;

		if (!R.game) {
			return;
		}
		index = R.util.clamp(R.game.timeScaleIndex + step, 0, scales.length - 1);
		R.game.timeScaleIndex = index;
		R.game.timeScale = scales[index];
	}

	function onKeyDown(event) {
		if (isFormTarget(event)) {
			return;
		}
		if (event.code === 'ShiftLeft' || event.code === 'ShiftRight' || event.key === 'Shift') {
			throttleUp = true;
			return;
		}
		if (event.code === 'ControlLeft' || event.code === 'ControlRight' || event.key === 'Control') {
			throttleDown = true;
			return;
		}
		if (event.code === 'BracketLeft' || event.key === '[') {
			adjustTimeScale(-1);
			return;
		}
		if (event.code === 'BracketRight' || event.key === ']') {
			adjustTimeScale(1);
			return;
		}
		if (event.code === 'KeyA') {
			if (R.game && R.game.phase === 'flying') {
				R.autopilot.toggle();
			}
			return;
		}
		if (event.code !== 'Space') {
			return;
		}

		event.preventDefault();
		if (event.repeat) {
			return;
		}
		requestStage();
	}

	function onKeyUp(event) {
		if (event.code === 'ShiftLeft' || event.code === 'ShiftRight' || event.key === 'Shift') {
			throttleUp = false;
		}
		if (event.code === 'ControlLeft' || event.code === 'ControlRight' || event.key === 'Control') {
			throttleDown = false;
		}
	}

	controls.initialize = function() {
		root.addEventListener('keydown', onKeyDown);
		root.addEventListener('keyup', onKeyUp);
		root.addEventListener('blur', controls.reset);
	};

	controls.reset = function() {
		throttleUp = false;
		throttleDown = false;
	};

	controls.setTimeScaleIndex = function(index) {
		var scales = R.constants.time.scales;

		if (!R.game) {
			return;
		}
		R.game.timeScaleIndex = R.util.clamp(index, 0, scales.length - 1);
		R.game.timeScale = scales[R.game.timeScaleIndex];
	};

	// Shared actuators: player input and autopilot commands both pass through
	// the same turn-rate and throttle-rate limits.
	controls.applyHeading = function(state, desiredHeading, dt) {
		var maxTurn = R.constants.rocket.turnRate * dt;
		var delta = R.util.wrapDelta(desiredHeading - state.heading, Math.PI * 2);

		state.heading = R.util.mod(state.heading + R.util.clamp(delta, -maxTurn, maxTurn), Math.PI * 2);
	};

	controls.applyThrottle = function(state, desiredThrottle, dt) {
		var rate = R.constants.rocket.throttleRate * dt;

		state.throttle = R.util.clamp(state.throttle + R.util.clamp(desiredThrottle - state.throttle, -rate, rate), 0, 1);
	};

	controls.update = function(currentGame, dt) {
		var state = currentGame.rocket;
		var input = R.input;
		var dx;
		var dy;

		if (currentGame.phase !== 'flying') {
			controls.reset();
			return;
		}

		if (R.autopilot.enabled) {
			R.autopilot.update(currentGame);
			controls.applyHeading(state, R.autopilot.command.heading, dt);
			controls.applyThrottle(state, R.autopilot.command.throttle, dt);
			if (R.autopilot.command.stage) {
				// The guidance's throttle carries over, so an ignition cannot
				// break an acceleration cap with a full-throttle start.
				R.rocket.separateStage(state, state.throttle);
			}
			return;
		}

		controls.applyThrottle(state, state.throttle + (Number(throttleUp) - Number(throttleDown)) * R.constants.rocket.throttleRate * dt, dt);
		if (!input.pointerActive) {
			return;
		}

		R.camera.project(state.wx, state.wy, headingScreen);
		dx = input.pointerX - headingScreen.x;
		dy = headingScreen.y - input.pointerY;
		if (dx * dx + dy * dy < 64) {
			return;
		}
		controls.applyHeading(state, Math.atan2(dx, dy), dt);
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = controls;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
