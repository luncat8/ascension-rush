(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var planets = R.planets || (R.planets = {});

	// Playable worlds. Every preset is self-consistent in game units, not in
	// physics: circumferences are a few tens of kilometres so a one-quarter
	// hop lasts 20-40 s at 1x, while gravity stays in the 1.6-16 m/s² band
	// that makes staged rockets read like rockets.
	//
	// pads[].frac is a canonical longitude fraction of the circumference.
	planets.padColors = ['#f4c76a', '#64d5c2', '#a78bfa', '#f28b82'];

	planets.list = [
		{
			id: 'verdant',
			name: 'Verdant',
			description: 'Thin sky, Earth gravity, even pad spacing. The reference world.',
			circumference: 20000,
			surfaceGravity: 9.81,
			seaLevelDensity: 1.225,
			atmosphereScaleHeight: 800,
			maxAltitude: 20000,
			logAltitudeScale: 15,
			landingRadius: 250,
			landingVerticalSpeed: 12,
			landingHorizontalSpeed: 25,
			pads: [
				{ name: 'Homeport', frac: 0 },
				{ name: 'Eastport', frac: 0.25 },
				{ name: 'Farport', frac: 0.5 },
				{ name: 'Westport', frac: 0.75 }
			],
			prices: { fuel: 4.1, steel: 2.5, delivery: 18 },
			defaultFuel: [420, 260, 200],
			defaultPayload: 80,
			flight: { maxDynamicPressure: 28000, maxThrustAcceleration: 22, maxAngleOfAttackDeg: 55 }
		},
		{
			id: 'tinmoon',
			name: 'Tinmoon',
			description: 'Airless low-gravity rock. Long coasts, no drag, cheap fuel.',
			circumference: 16000,
			surfaceGravity: 1.62,
			seaLevelDensity: 0,
			atmosphereScaleHeight: 900,
			maxAltitude: 16000,
			logAltitudeScale: 10,
			landingRadius: 180,
			landingVerticalSpeed: 8,
			landingHorizontalSpeed: 18,
			pads: [
				{ name: 'Anchor', frac: 0 },
				{ name: 'Dustfield', frac: 0.16 },
				{ name: 'Rim Relay', frac: 0.5 },
				{ name: 'Tinstack', frac: 0.68 }
			],
			prices: { fuel: 2.6, steel: 2.0, delivery: 4.2 },
			defaultFuel: [200, 140, 100],
			defaultPayload: 80,
			flight: { cruiseAltitudeMax: 1500, glideSlope: 0.5, climbVelocity: 70, maxThrustAcceleration: 16 }
		},
		{
			id: 'cinder',
			name: 'Cinder',
			description: 'High gravity, dense air, expensive fuel and the richest contracts.',
			circumference: 24000,
			surfaceGravity: 16.5,
			seaLevelDensity: 1.9,
			atmosphereScaleHeight: 900,
			maxAltitude: 24000,
			logAltitudeScale: 18,
			landingRadius: 350,
			landingVerticalSpeed: 15,
			landingHorizontalSpeed: 30,
			pads: [
				{ name: 'Bastion', frac: 0 },
				{ name: 'Forge', frac: 0.25 },
				{ name: 'Slagworks', frac: 0.5 },
				{ name: 'Anvil', frac: 0.75 }
			],
			prices: { fuel: 5.5, steel: 3.6, delivery: 130 },
			defaultFuel: [1500, 900, 400],
			defaultPayload: 60,
			flight: { cruiseAltitudeMax: 2500, climbVelocity: 120, maxDynamicPressure: 70000, maxThrustAcceleration: 34, maxAngleOfAttackDeg: 60 }
		},
		{
			id: 'gossamer',
			name: 'Gossamer',
			description: 'Gentle gravity under a deep, heavy atmosphere. Drag decides the flight.',
			circumference: 26000,
			surfaceGravity: 5.4,
			seaLevelDensity: 3.4,
			atmosphereScaleHeight: 2200,
			maxAltitude: 26000,
			logAltitudeScale: 20,
			landingRadius: 400,
			landingVerticalSpeed: 10,
			landingHorizontalSpeed: 22,
			pads: [
				{ name: 'Canopy', frac: 0 },
				{ name: 'Drift', frac: 0.2 },
				{ name: 'Halcyon', frac: 0.45 },
				{ name: 'Zephyr', frac: 0.75 }
			],
			prices: { fuel: 5.0, steel: 2.2, delivery: 22.5 },
			defaultFuel: [380, 240, 180],
			defaultPayload: 80,
			flight: { cruiseAltitudeMax: 2500, glideSlope: 0.55, climbVelocity: 80, maxDynamicPressure: 60000, maxThrustAcceleration: 22, maxAngleOfAttackDeg: 35 }
		}
	];

	planets.defaultId = 'verdant';

	planets.findById = function(id) {
		var i;

		for (i = 0; i < planets.list.length; i += 1) {
			if (planets.list[i].id === id) {
				return planets.list[i];
			}
		}
		return null;
	};

	// Copy a preset into the live world record so gameplay modules never
	// re-read the table and a planet switch is a single assignment pass.
	planets.copyInto = function(preset, target) {
		target.id = preset.id;
		target.name = preset.name;
		target.description = preset.description;
		target.circumference = preset.circumference;
		target.radius = preset.circumference / (2 * Math.PI);
		target.surfaceGravity = preset.surfaceGravity;
		target.seaLevelDensity = preset.seaLevelDensity;
		target.atmosphereScaleHeight = preset.atmosphereScaleHeight;
		target.maxAltitude = preset.maxAltitude;
		target.logAltitudeScale = preset.logAltitudeScale;
		target.landingRadius = preset.landingRadius;
		target.landingVerticalSpeed = preset.landingVerticalSpeed;
		target.landingHorizontalSpeed = preset.landingHorizontalSpeed;
		target.prices = preset.prices;
		target.defaultFuel = preset.defaultFuel;
		target.defaultPayload = preset.defaultPayload;
		target.flight = preset.flight;
		target.pads = preset.pads;
		return target;
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = planets;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
