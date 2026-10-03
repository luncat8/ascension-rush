(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var main = {};

	function start() {
		var canvas = root.document.getElementById('c');
		var context;
		var game;
		var previousTimestamp = 0;

		if (!canvas) {
			return;
		}

		context = canvas.getContext('2d', { alpha: false });
		if (!context) {
			return;
		}

		R.world.initialize();
		game = {
			currentPadId: R.world.currentPadId,
			targetPadId: R.world.targetPadId,
			rocket: R.rocket.create(R.world.findPadById(R.world.currentPadId)),
			simTime: 0
		};
		R.game = game;

		R.render.initialize(context);
		R.input.initialize(canvas, R.camera);

		function resize() {
			var width = Math.max(1, root.innerWidth);
			var height = Math.max(1, root.innerHeight);
			var pixelRatio = root.devicePixelRatio || 1;

			canvas.width = Math.round(width * pixelRatio);
			canvas.height = Math.round(height * pixelRatio);
			context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
			R.render.resize(width, height);
			R.camera.follow(game.rocket.wx);
			R.input.resize(R.camera);
			R.render.draw(game);
		}

		function update(dt) {
			game.simTime += dt;
		}

		function frame(timestamp) {
			var dt = 0;

			if (previousTimestamp !== 0) {
				dt = Math.min((timestamp - previousTimestamp) / 1000, 1 / 30);
			}
			previousTimestamp = timestamp;
			update(dt);
			R.camera.follow(game.rocket.wx);
			R.render.draw(game);
			root.requestAnimationFrame(frame);
		}

		root.addEventListener('resize', resize);
		resize();
		root.requestAnimationFrame(frame);
	}

	main.start = start;

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = main;
		return;
	}

	if (root.document.readyState === 'loading') {
		root.document.addEventListener('DOMContentLoaded', start, { once: true });
	} else {
		start();
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
