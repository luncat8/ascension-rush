(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var rocket = R.rocket || (R.rocket = {});

	rocket.create = function(pad) {
		return {
			wx: pad.wx,
			wy: 0,
			vx: 0,
			vy: 0,
			heading: 0,
			onGround: true,
			padId: pad.id,
			stages: []
		};
	};

	rocket.draw = function(context, sx, sy, heading) {
		context.save();
		context.translate(sx, sy);
		context.rotate(heading);

		context.beginPath();
		context.moveTo(0, -28);
		context.lineTo(9, 0);
		context.lineTo(0, -4);
		context.lineTo(-9, 0);
		context.closePath();
		context.fillStyle = '#e9f0f2';
		context.fill();
		context.lineWidth = 1.5;
		context.strokeStyle = '#152635';
		context.stroke();

		context.beginPath();
		context.moveTo(0, -28);
		context.lineTo(0, -36);
		context.lineWidth = 2;
		context.strokeStyle = '#f4c76a';
		context.stroke();

		context.beginPath();
		context.moveTo(-3, 0);
		context.lineTo(0, 4);
		context.lineTo(3, 0);
		context.lineWidth = 2;
		context.strokeStyle = '#8498a2';
		context.stroke();

		context.restore();
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = rocket;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
