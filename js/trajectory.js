(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var trajectory = R.trajectory || (R.trajectory = {});
	var aeroSample = {
		speed: 0,
		dynamicPressure: 0,
		angleOfAttack: 0,
		dragCoefficient: 0,
		dragAccelX: 0,
		dragAccelY: 0
	};

	// Where the rocket reaches the ground if the engine is cut now. The
	// prediction step is the live fixed step: a coarser 1/30 s step is four times
	// cheaper but carries 150 m of range error on a dense-air coast, while this
	// one keeps every measured state inside 1% / 25 m for about 0.1 ms and makes
	// the forecast the same integration the game would fly. The horizon bounds
	// the work, and past it there is no forecast rather than a stale one. The
	// same integrator at a finer step is the reference it is validated against,
	// so the two can only disagree through step size, never through a model.
	trajectory.coastStep = R.constants.rocket.fixedStep;
	trajectory.coastHorizon = 120;
	trajectory.maxCoastSteps = Math.ceil(trajectory.coastHorizon / trajectory.coastStep);

	// A strided copy of the same rollout, so the map can draw the coast path
	// above the atmosphere without integrating a second trajectory. Owned by
	// the caller; nothing in the predictor allocates.
	trajectory.traceCapacity = R.constants.sky.traceCapacity;
	trajectory.traceStride = R.constants.sky.traceStrideSteps;
	trajectory.trace = {
		points: new Float32Array(trajectory.traceCapacity * 2),
		count: 0
	};

	trajectory.impact = {
		wx: 0,
		vx: 0,
		vy: 0,
		seconds: 0,
		steps: 0,
		valid: false,
		targetError: 0,
		onTargetPad: false,
		safeTouchdown: false
	};

	// Engine-off rollout of `state`, at a caller-chosen step and step budget.
	// Same order as the live integrator (gravity and drag from the state at the
	// start of the step, semi-implicit Euler, linear ground interpolation), so
	// a coast marker agrees with what the game would actually fly. Heading and
	// mass are held: a coasting rocket burns nothing and has no attitude
	// dynamics. Writes scalars into `out`; allocates nothing.
	trajectory.rollout = function(state, dt, maxSteps, out, trace) {
		var settings = R.constants.rocket;
		var mass = Math.max(1, R.rocket.totalMass(state));
		var wx = state.wx;
		var wy = state.wy;
		var vx = state.vx;
		var vy = state.vy;
		var heading = state.heading;
		var seconds = 0;
		var steps = 0;
		var density;
		var gravity;
		var accelerationX;
		var accelerationY;
		var acceleration;
		var newVx;
		var newVy;
		var newWx;
		var newWy;
		var crossingFraction;

		out.valid = false;
		out.steps = 0;
		if (trace) {
			trace.count = 1;
			trace.points[0] = wx;
			trace.points[1] = wy;
		}
		while (steps < maxSteps) {
			density = R.physics.densityAtAltitude(wy);
			gravity = R.physics.gravityAtAltitude(wy);
			R.aerodynamics.calculate(density, vx, vy, heading, mass, aeroSample);
			accelerationX = aeroSample.dragAccelX;
			accelerationY = aeroSample.dragAccelY - gravity;
			acceleration = Math.sqrt(accelerationX * accelerationX + accelerationY * accelerationY);
			if (acceleration > settings.maxAcceleration) {
				accelerationX *= settings.maxAcceleration / acceleration;
				accelerationY *= settings.maxAcceleration / acceleration;
			}
			newVx = vx + accelerationX * dt;
			newVy = vy + accelerationY * dt;
			newWx = wx + newVx * dt;
			newWy = wy + newVy * dt;
			steps += 1;
			if (trace && steps % trajectory.traceStride === 0 && trace.count < trajectory.traceCapacity) {
				trace.points[trace.count * 2] = newWx;
				trace.points[trace.count * 2 + 1] = newWy;
				trace.count += 1;
			}
			if (newWy <= 0) {
				crossingFraction = wy > 0 ? wy / (wy - newWy) : 0;
				out.wx = wx + (newWx - wx) * crossingFraction;
				out.vx = vx + (newVx - vx) * crossingFraction;
				out.vy = vy + (newVy - vy) * crossingFraction;
				out.seconds = seconds + dt * crossingFraction;
				out.steps = steps;
				out.valid = true;
				if (trace && trace.count < trajectory.traceCapacity) {
					trace.points[trace.count * 2] = out.wx;
					trace.points[trace.count * 2 + 1] = 0;
					trace.count += 1;
				}
				return out;
			}
			wx = newWx;
			wy = newWy;
			vx = newVx;
			vy = newVy;
			seconds += dt;
		}
		return out;
	};

	// A prediction that did not reach the ground inside the horizon stays
	// invalid: a stale point on the map would read as a promise.
	trajectory.predictCoast = function(state, out, trace) {
		if (state.wy <= 0) {
			out.valid = false;
			if (trace) {
				trace.count = 0;
			}
			return out;
		}
		return trajectory.rollout(state, trajectory.coastStep, trajectory.maxCoastSteps, out, trace);
	};

	// Per-frame prediction plus its wrap-aware relation to the selected pad, so
	// the HUD and the ground marker only read numbers.
	trajectory.update = function(game) {
		var impact = trajectory.impact;
		var planet = R.world.planet;
		var target;

		impact.onTargetPad = false;
		impact.safeTouchdown = false;
		impact.targetError = 0;
		if (game.phase !== 'flying') {
			impact.valid = false;
			trajectory.trace.count = 0;
			return impact;
		}
		target = R.world.findPadById(game.targetPadId);
		trajectory.predictCoast(game.rocket, impact, trajectory.trace);
		if (!impact.valid) {
			return impact;
		}
		impact.safeTouchdown = Math.abs(impact.vy) <= planet.landingVerticalSpeed &&
			Math.abs(impact.vx) <= planet.landingHorizontalSpeed;
		if (target) {
			impact.targetError = R.util.wrapDelta(impact.wx - target.wx, planet.circumference);
			impact.onTargetPad = Math.abs(impact.targetError) <= planet.landingRadius;
		}
		return impact;
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = trajectory;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
