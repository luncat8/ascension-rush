(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var util = R.util || (R.util = {});

	util.clamp = function(value, minValue, maxValue) {
		return Math.max(minValue, Math.min(maxValue, value));
	};

	util.mod = function(value, modulus) {
		return ((value % modulus) + modulus) % modulus;
	};

	util.wrapDelta = function(distance, circumference) {
		return util.mod(distance + circumference * 0.5, circumference) - circumference * 0.5;
	};

	util.lerp = function(from, to, amount) {
		return from + (to - from) * amount;
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = util;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
