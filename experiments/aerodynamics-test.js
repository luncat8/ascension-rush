'use strict';

var assert = require('node:assert/strict');
var R = require('../js/namespaces.js');
require('../js/constants.js');
require('../js/aerodynamics.js');

var result = {
	speed: 0,
	dynamicPressure: 0,
	angleOfAttack: 0,
	dragCoefficient: 0,
	dragAccelX: 0,
	dragAccelY: 0
};
var atmosphereDensity = 1.225;
var speed = 100;
var aligned;
var broadside;

assert.equal(R.aerodynamics.dynamicPressure(atmosphereDensity, speed), 0.5 * atmosphereDensity * speed * speed, 'the shared helper is half rho v squared');
assert.equal(R.aerodynamics.dynamicPressure(0, speed), 0, 'vacuum has no dynamic pressure');

aligned = R.aerodynamics.calculate(atmosphereDensity, 0, speed, 0, 1000, result);
assert.equal(aligned, result, 'calculation mutates caller-owned telemetry');
assert.equal(aligned.dynamicPressure, 0.5 * atmosphereDensity * speed * speed);
assert.equal(aligned.angleOfAttack, 0, 'axial prograde flight has zero AoA');
assert.equal(aligned.dragCoefficient, R.aerodynamics.Cd0, 'on-axis drag preserves the old Cd calibration');
assert.ok(Math.abs(aligned.dragAccelX) === 0);
assert.ok(aligned.dragAccelY < 0, 'drag opposes upward airflow');

broadside = R.aerodynamics.calculate(atmosphereDensity, speed, 0, 0, 1000, result);
assert.ok(Math.abs(broadside.angleOfAttack - Math.PI / 2) < 1e-12, 'broadside flight is ninety degrees AoA');
assert.ok(broadside.dragCoefficient > R.aerodynamics.Cd0, 'AoA increases drag coefficient');
assert.ok(broadside.dragAccelX < 0 && Math.abs(broadside.dragAccelY) === 0, 'drag opposes broadside airflow');
assert.ok(Math.abs(broadside.dragAccelX) > Math.abs(aligned.dragAccelY), 'broadside orientation increases drag at the same speed');

R.aerodynamics.calculate(0, speed, 0, 0, 1000, result);
assert.equal(result.dynamicPressure, 0, 'vacuum has no dynamic pressure');
assert.equal(result.dragAccelX, 0, 'vacuum has no drag acceleration');
assert.ok(Number.isFinite(result.angleOfAttack));

R.aerodynamics.calculate(atmosphereDensity, 0, 0, 1.2, 0, result);
assert.equal(result.dynamicPressure, 0, 'zero speed has zero dynamic pressure');
assert.equal(result.angleOfAttack, 0, 'zero speed has zero AoA');
assert.equal(result.dragAccelX, 0);
assert.equal(result.dragAccelY, 0);

console.log('Aerodynamics tests passed.');
