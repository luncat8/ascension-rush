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
	// The body under the pointer (-2 for empty space), so the renderer can
	// outline it and the cursor can say it is clickable.
	input.hoverIndex = -2;
	input.canvas = null;
	// A page may claim a press for its own object (the chart lab grabs the
	// probe). While a claim is live the camera ignores the gesture, and the
	// page gets the moves instead of a pan.
	input.gestureHook = null;
	input.gestureMove = null;
	input.gestureEnd = null;

	function updateWorldReadout(camera) {
		camera.unproject(input.pointerX, input.pointerY, input.worldPoint);
		input.debugText = 'E ' + Math.round(input.worldPoint.x) + ' m  ·  ALT ' + Math.round(input.worldPoint.y) + ' m';
	}

	function pickAt(x, y, camera) {
		var game = R.game;

		if (!R.sky || !R.sky.pick || !game) {
			return -2;
		}
		if (!R.sky.view || R.sky.view.planetId === '') {
			return -2;
		}
		return R.sky.pick(x, y, game);
	}

	input.resize = function(camera) {
		if (!input.pointerActive) {
			return;
		}

		input.pointerX = input.pointerU * camera.width;
		input.pointerY = input.pointerV * camera.height;
		updateWorldReadout(camera);
	};

	// The chart's three gestures, all of them on the camera and none of them in
	// the game: drag pans, the wheel zooms, a click without a drag re-seats the
	// chart on the body under the pointer. Everything a gesture needs is the
	// camera and the catalog, so the test page and the game get the same
	// controls from the same code.
	input.initialize = function(canvas, camera) {
		var dragging = false;
		var moved = false;
		var downX = 0;
		var downY = 0;
		var lastX = 0;
		var lastY = 0;

		input.canvas = canvas;

		// The test harness has a canvas with no DOM style; the cursor is not
		// worth a guard at every call site.
		function setCursor(shape) {
			if (canvas.style) {
				canvas.style.cursor = shape;
			}
		}

		function pointOf(event) {
			var rect = canvas.getBoundingClientRect();

			return {
				x: (event.clientX - rect.left) / Math.max(1, rect.width) * camera.width,
				y: (event.clientY - rect.top) / Math.max(1, rect.height) * camera.height
			};
		}

		function updateHover() {
			input.hoverIndex = input.pointerActive ? pickAt(input.pointerX, input.pointerY, camera) : -2;
			setCursor(input.hoverIndex > -2 ? 'pointer' : (dragging ? 'grabbing' : 'grab'));
		}

		function onPointerMove(event) {
			var point = pointOf(event);
			var dx;
			var dy;

			input.pointerU = point.x / Math.max(1, camera.width);
			input.pointerV = point.y / Math.max(1, camera.height);
			input.pointerX = point.x;
			input.pointerY = point.y;
			input.pointerActive = true;
			updateWorldReadout(camera);
			if (dragging === 'claimed') {
				if (input.gestureMove) {
					input.gestureMove(point.x, point.y, camera);
				}
				return;
			}
			if (!dragging) {
				updateHover();
				return;
			}
			dx = point.x - lastX;
			dy = point.y - lastY;
			lastX = point.x;
			lastY = point.y;
			if (!moved && Math.abs(point.x - downX) + Math.abs(point.y - downY) <
				R.constants.view.dragSlopPx) {
				return;
			}
			moved = true;
			setCursor('grabbing');
			camera.panBy(dx, dy);
		}

		function onPointerDown(event) {
			var point = pointOf(event);

			if (input.gestureHook && input.gestureHook(point.x, point.y, camera)) {
				input.pointerX = point.x;
				input.pointerY = point.y;
				input.pointerActive = true;
				dragging = 'claimed';
				return;
			}
			dragging = true;
			moved = false;
			downX = lastX = point.x;
			downY = lastY = point.y;
			input.pointerX = point.x;
			input.pointerY = point.y;
			input.pointerActive = true;
			setCursor('grabbing');
			if (canvas.setPointerCapture) {
				canvas.setPointerCapture(event.pointerId);
			}
			updateWorldReadout(camera);
		}

		function onPointerUp(event) {
			var index;

			if (dragging === 'claimed') {
				dragging = false;
				if (input.gestureEnd) {
					input.gestureEnd();
				}
				return;
			}
			if (!dragging) {
				return;
			}
			dragging = false;
			if (canvas.releasePointerCapture && canvas.hasPointerCapture &&
				canvas.hasPointerCapture(event.pointerId)) {
				canvas.releasePointerCapture(event.pointerId);
			}
			if (!moved) {
				// A click is a seat, not a pan: the body under the pointer
				// becomes the chart's pole. Empty space is a no-op, so a stray
				// click never throws the view.
				index = pickAt(input.pointerX, input.pointerY, camera);
				if (index >= -1 && R.game) {
					R.sky.seatPivot(index, R.game);
				}
			}
			updateHover();
		}

		function onPointerLeave() {
			input.pointerActive = false;
			input.hoverIndex = -2;
			if (!dragging) {
				setCursor('');
			}
		}

		function onPointerCancel() {
			dragging = false;
			if (input.gestureEnd) {
				input.gestureEnd();
			}
		}

		function onWheel(event) {
			var notch = Math.max(-3, Math.min(3, event.deltaY * (event.deltaMode === 1 ? 16 : 1) / 120));

			event.preventDefault();
			camera.zoomBy(Math.exp(-notch * 0.35));
		}

		setCursor('grab');
		if (canvas.style) {
			canvas.style.touchAction = 'none';
		}
		canvas.addEventListener('pointerdown', onPointerDown);
		canvas.addEventListener('pointermove', onPointerMove);
		canvas.addEventListener('pointerup', onPointerUp);
		canvas.addEventListener('pointercancel', onPointerCancel);
		canvas.addEventListener('pointerleave', onPointerLeave);
		canvas.addEventListener('wheel', onWheel, { passive: false });
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = input;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
