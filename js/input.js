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
	// True between a press and its release once the pointer has moved past the
	// slop, so the renderer can say the chart is being held.
	input.dragging = false;
	input.dragK = 0;
	// A page may claim a press for its own object (the chart lab grabs the
	// probe). While a claim is live the camera ignores the gesture, and the page
	// gets the moves instead of a drag.
	input.gestureHook = null;
	input.gestureMove = null;
	input.gestureEnd = null;

	// One pointer position object for the whole session: a move event is as hot
	// as a frame while the player drags.
	var point = { x: 0, y: 0 };

	function updateWorldReadout(camera) {
		camera.unproject(input.pointerX, input.pointerY, input.worldPoint);
		input.debugText = 'E ' + Math.round(input.worldPoint.x) + ' m  ·  ALT ' +
			Math.round(input.worldPoint.y) + ' m';
	}

	function pickAt(x, y) {
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
	// the game: a press and a drag takes hold of a point of the plane and
	// unwraps the space around it, the wheel zooms, and a click without a drag
	// seats the chart on the body under the pointer. Everything a gesture needs
	// is the camera and the catalog, so the test page and the game get the same
	// controls from the same code.
	input.initialize = function(canvas, camera) {
		var state = 0;
		var downX = 0;
		var downY = 0;

		input.canvas = canvas;

		// The test harness has a canvas with no DOM style; the cursor is not worth
		// a guard at every call site.
		function setCursor(shape) {
			if (canvas.style) {
				canvas.style.cursor = shape;
			}
		}

		function pointOf(event) {
			var rect = canvas.getBoundingClientRect();

			point.x = (event.clientX - rect.left) / Math.max(1, rect.width) * camera.width;
			point.y = (event.clientY - rect.top) / Math.max(1, rect.height) * camera.height;
			return point;
		}

		function updateHover() {
			input.hoverIndex = input.pointerActive ? pickAt(input.pointerX, input.pointerY) : -2;
			setCursor(input.hoverIndex > -2 ? 'pointer' : (input.dragging ? 'grabbing' : 'grab'));
		}

		// A release decides between the two things a drag can mean: far enough
		// toward its ground line and the chart seats on the body that anchor
		// stands on, exactly as a click would; short of it and the chart eases
		// back to the follow, holding the ship still on the way.
		function endDrag() {
			var seat;

			if (state !== 'drag') {
				return;
			}
			state = 0;
			input.dragging = false;
			input.dragK = 0;
			seat = R.sky.handEnd();
			// A seat that cannot start — the chart already stands there, or a
			// hand-over is running — falls back to the follow ease, so a release
			// is never a snap back to the ship.
			if (seat < -1 || !R.sky.seatPivot(seat, R.game)) {
				R.sky.releaseToFollow(R.game);
			}
			updateHover();
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
			if (state === 'claimed') {
				if (input.gestureMove) {
					input.gestureMove(point.x, point.y, camera);
				}
				return;
			}
			if (state === 0) {
				updateHover();
				return;
			}
			dx = point.x - downX;
			dy = point.y - downY;
			if (!input.dragging && Math.abs(dx) + Math.abs(dy) < R.constants.view.dragSlopPx) {
				return;
			}
			if (!input.dragging) {
				// A flat view has no pole to walk: the press stays a click.
				if (!R.sky.handBegin(downX, downY, R.game)) {
					return;
				}
				input.dragging = true;
				state = 'drag';
				setCursor('grabbing');
			}
			input.dragK = R.sky.hand.k;
			R.sky.handMove(point.x, point.y);
		}

		function onPointerDown(event) {
			var point = pointOf(event);

			input.pointerX = point.x;
			input.pointerY = point.y;
			input.pointerActive = true;
			if (input.gestureHook && input.gestureHook(point.x, point.y, camera)) {
				state = 'claimed';
				return;
			}
			state = 'press';
			downX = point.x;
			downY = point.y;
			if (canvas.setPointerCapture) {
				canvas.setPointerCapture(event.pointerId);
			}
			updateWorldReadout(camera);
		}

		function onPointerUp(event) {
			var index;

			if (state === 'claimed') {
				state = 0;
				if (input.gestureEnd) {
					input.gestureEnd();
				}
				return;
			}
			if (state === 'drag') {
				endDrag();
				return;
			}
			if (state !== 'press') {
				return;
			}
			state = 0;
			if (canvas.releasePointerCapture && canvas.hasPointerCapture &&
				canvas.hasPointerCapture(event.pointerId)) {
				canvas.releasePointerCapture(event.pointerId);
			}
			// A click is a seat, not a drag: the body under the pointer becomes
			// the chart's ground. Empty space is a no-op, so a stray click never
			// throws the view.
			index = pickAt(input.pointerX, input.pointerY);
			if (index >= -1 && R.game) {
				R.sky.seatPivot(index, R.game);
			}
			updateHover();
		}

		function onPointerLeave() {
			input.pointerActive = false;
			input.hoverIndex = -2;
			if (state === 0) {
				setCursor('');
			}
		}

		function onPointerCancel() {
			if (state === 'drag') {
				endDrag();
				return;
			}
			state = 0;
			input.dragging = false;
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
