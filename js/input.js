(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var input = R.input || (R.input = {});

	input.pointerX = 0;
	input.pointerY = 0;
	input.pointerU = 0;
	input.pointerV = 0;
	input.pointerActive = false;
	input.worldPoint = { x: 0, y: 0 };
	input.debugText = '';

	function updateWorldReadout(camera) {
		camera.unproject(input.pointerX, input.pointerY, input.worldPoint);
		input.debugText = 'E ' + Math.round(input.worldPoint.x) + ' m  ·  ALT ' + Math.round(input.worldPoint.y) + ' m';
	}

	input.resize = function(camera) {
		if (!input.pointerActive) {
			return;
		}

		input.pointerX = input.pointerU * camera.width;
		input.pointerY = input.pointerV * camera.height;
		updateWorldReadout(camera);
	};

	input.initialize = function(canvas, camera) {
		function onPointerMove(event) {
			var rect = canvas.getBoundingClientRect();

			input.pointerU = (event.clientX - rect.left) / rect.width;
			input.pointerV = (event.clientY - rect.top) / rect.height;
			input.pointerX = input.pointerU * camera.width;
			input.pointerY = input.pointerV * camera.height;
			input.pointerActive = true;
			updateWorldReadout(camera);
		}

		function onPointerLeave() {
			input.pointerActive = false;
		}

		canvas.addEventListener('pointermove', onPointerMove);
		canvas.addEventListener('pointerleave', onPointerLeave);
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = input;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
