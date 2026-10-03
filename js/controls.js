(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var controls = R.controls || (R.controls = {});
	var game = null;
	var throttleUp = false;
	var throttleDown = false;
	var headingScreen = { x: 0, y: 0 };

	function isFormTarget(event) {
		var target = event.target;
		var tagName = target && target.tagName;
		return tagName === 'INPUT' || tagName === 'SELECT' || tagName === 'TEXTAREA' || tagName === 'BUTTON';
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
		if (event.code !== 'Space') {
			return;
		}

		event.preventDefault();
		if (event.repeat || !game || game.phase !== 'flying') {
			return;
		}
		R.rocket.separateStage(game.rocket);
	}

	function onKeyUp(event) {
		if (event.code === 'ShiftLeft' || event.code === 'ShiftRight' || event.key === 'Shift') {
			throttleUp = false;
		}
		if (event.code === 'ControlLeft' || event.code === 'ControlRight' || event.key === 'Control') {
			throttleDown = false;
		}
	}

	controls.initialize = function(currentGame) {
		game = currentGame;
		root.addEventListener('keydown', onKeyDown);
		root.addEventListener('keyup', onKeyUp);
		root.addEventListener('blur', controls.reset);
	};

	controls.reset = function() {
		throttleUp = false;
		throttleDown = false;
	};

	controls.update = function(currentGame, dt) {
		var state = currentGame.rocket;
		var input = R.input;
		var dx;
		var dy;
		var desiredHeading;
		var headingDelta;
		var maxTurn;

		if (currentGame.phase !== 'flying') {
			controls.reset();
			return;
		}

		state.throttle = R.util.clamp(state.throttle + (Number(throttleUp) - Number(throttleDown)) * R.constants.rocket.throttleRate * dt, 0, 1);
		if (!input.pointerActive) {
			return;
		}

		R.camera.project(state.wx, state.wy, headingScreen);
		dx = input.pointerX - headingScreen.x;
		dy = headingScreen.y - input.pointerY;
		if (dx * dx + dy * dy < 64) {
			return;
		}

		desiredHeading = Math.atan2(dx, dy);
		headingDelta = R.util.wrapDelta(desiredHeading - state.heading, Math.PI * 2);
		maxTurn = R.constants.rocket.turnRate * dt;
		state.heading = R.util.mod(state.heading + R.util.clamp(headingDelta, -maxTurn, maxTurn), Math.PI * 2);
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = controls;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
