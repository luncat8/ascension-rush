(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var main = {};
	var game = null;

	// A run is one world's operations save. Nothing crosses a planet change:
	// fleet, routes and pad ids are all rebuilt with the world.
	function createRun() {
		var timeIndex = R.constants.time.defaultIndex;
		var home = R.world.currentPadId;
		var run = {
			currentPadId: home,
			targetPadId: R.world.targetPadId,
			rocket: R.rocket.create(R.world.findPadById(home)),
			phase: 'deck',
			cash: R.economy.startingCash,
			ledger: [],
			flight: null,
			mission: null,
			lastReport: null,
			explosion: null,
			// What the map highlights. Mutated in place by the deck.
			selection: {
				sourcePadId: home,
				targetPadId: R.world.targetPadId,
				mode: 'oneway',
				visible: true
			},
			simTime: 0,
			physicsAccumulator: 0,
			timeScaleIndex: timeIndex,
			timeScale: R.constants.time.scales[timeIndex]
		};

		R.game = run;
		R.operations.initialize();
		return run;
	}

	function update(dt) {
		var simDt = Math.min(Math.max(0, dt), R.constants.rocket.maxFrameStep) * game.timeScale;

		game.simTime += simDt;
		if (game.explosion && game.simTime - game.explosion.startedAt >= R.constants.damage.ruptureExplosionSeconds) {
			game.explosion = null;
		}
		R.controls.update(game, simDt);
		R.physics.advance(game, dt);
		// The coast-impact marker is a forecast for whoever is flying: it says
		// where the engine-off trajectory from this state reaches the ground.
		R.trajectory.update(game);
		// Route scheduling and its cancellable countdown run on the deck's own
		// clock, in real seconds, never inside the physics budget.
		R.operations.run(game, Math.min(Math.max(0, dt), R.constants.rocket.maxFrameStep));
	}

	function start() {
		var canvas = root.document.getElementById('c');
		var context;
		var previousTimestamp = 0;

		if (!canvas) {
			return;
		}

		context = canvas.getContext('2d', { alpha: false });
		if (!context) {
			return;
		}

		R.world.initialize();
		game = createRun();

		R.render.initialize(context);
		R.input.initialize(canvas, R.camera);
		R.controls.initialize();
		R.builder.initialize(game);
		R.deck.initialize(game);
		R.menu.initialize();

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

		function frame(timestamp) {
			var dt = 0;

			if (previousTimestamp !== 0) {
				dt = Math.min((timestamp - previousTimestamp) / 1000, R.constants.rocket.maxFrameStep);
			}
			previousTimestamp = timestamp;
			update(dt);
			R.camera.follow(game.rocket.wx);
			R.render.draw(game);
			R.deck.sync(game);
			root.requestAnimationFrame(frame);
		}

		root.addEventListener('resize', resize);
		resize();
		root.requestAnimationFrame(frame);
	}

	// Start a fresh run, optionally on another world. The deck and key handlers
	// live for the whole session; only game and operations state are replaced.
	main.restart = function(planetId) {
		R.world.initialize(planetId);
		game = createRun();
		R.autopilot.setEnabled(false);
		R.autopilot.reset();
		R.controls.setTimeScaleIndex(R.constants.time.defaultIndex);
		R.builder.refresh(game);
		R.deck.reset(game);
		R.camera.follow(game.rocket.wx);
		R.render.draw(game);
	};

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
