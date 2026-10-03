(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var aerodynamics = R.aerodynamics || (R.aerodynamics = {});

	// Cd0 preserves the 0.3.0 axial drag; CdAlpha adds broadside penalty.
	aerodynamics.Cd0 = 0.22;
	aerodynamics.CdAlpha = 0.5;
	aerodynamics.speedEpsilon = 1e-6;

	aerodynamics.dynamicPressure = function(density, speed) {
		return 0.5 * Math.max(0, density) * speed * speed;
	};

	aerodynamics.calculate = function(density, relativeVx, relativeVy, heading, mass, out) {
		var speed = Math.sqrt(relativeVx * relativeVx + relativeVy * relativeVy);
		var axisDot;
		var sineAlpha;
		var dynamicPressure;
		var dragScale;

		if (speed > aerodynamics.speedEpsilon) {
			axisDot = Math.abs((Math.sin(heading) * relativeVx + Math.cos(heading) * relativeVy) / speed);
			axisDot = Math.max(0, Math.min(1, axisDot));
			out.angleOfAttack = Math.acos(axisDot);
		} else {
			out.angleOfAttack = 0;
		}

		dynamicPressure = aerodynamics.dynamicPressure(density, speed);
		sineAlpha = Math.sin(out.angleOfAttack);
		out.speed = speed;
		out.dynamicPressure = dynamicPressure;
		out.dragCoefficient = aerodynamics.Cd0 + aerodynamics.CdAlpha * sineAlpha * sineAlpha;
		out.dragAccelX = 0;
		out.dragAccelY = 0;
		if (speed <= aerodynamics.speedEpsilon || dynamicPressure <= 0) {
			return out;
		}

		dragScale = dynamicPressure * out.dragCoefficient * R.constants.rocket.referenceArea /
			Math.max(1, mass) / speed;
		out.dragAccelX = -dragScale * relativeVx;
		out.dragAccelY = -dragScale * relativeVy;
		return out;
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = aerodynamics;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
