'use strict';

var assert = require('node:assert/strict');
var R = require('../js/namespaces.js');
require('../js/parts.js');

require('../js/util.js');
require('../js/constants.js');
require('../js/planets.js');
require('../js/coords.js');
require('../js/camera.js');
require('../js/world.js');
require('../js/physics.js');

var camera = R.camera;
var screen = { x: 0, y: 0 };
var world = { x: 0, y: 0 };
var planet;
var cases;
var i;
var farthest;
var airY;
var before;
var body;

R.world.initialize('verdant');
planet = R.world.planet;
cases = [
	{ x: -12500, y: 0 },
	{ x: -1200, y: 10 },
	{ x: 0, y: 100 },
	{ x: 2600, y: 1000 },
	{ x: 10000, y: 5000 },
	{ x: 32500, y: 20000 }
];

camera.resize(1440, 900);
camera.follow(0);

assert.equal(R.util.mod(-1, planet.circumference), planet.circumference - 1);
assert.equal(R.util.wrapDelta(planet.circumference * 0.75, planet.circumference), -planet.circumference * 0.25);
assert.equal(camera.groundY, 810);
assert.equal(planet.circumference, 20000);

for (i = 0; i < cases.length; i += 1) {
	camera.project(cases[i].x, cases[i].y, screen);
	camera.unproject(screen.x, screen.y, world);
	assert.ok(Math.abs(world.x - cases[i].x) < 1e-7, 'longitude round trip at case ' + i);
	assert.ok(Math.abs(world.y - cases[i].y) < 1e-6, 'altitude round trip at case ' + i);
}

camera.project(0, 0, screen);
assert.ok(Math.abs(screen.x - 480) < 1e-9, 'rocket anchor sits one-third across the view');
camera.project(0, camera.ceiling, screen);
assert.equal(screen.y, camera.topY(), 'the charted extent maps to the top edge');
camera.project(0, 200, screen);
assert.ok(screen.y < camera.groundY && screen.y > 0, 'low altitude stays inside the playable band');

// ---------------------------------------------------------------------------
// The ladder: the air column gets the height, the top layers are compressed.
// ---------------------------------------------------------------------------

// Chart the whole system the way sky.js does: the farthest far limb is the
// extent, and that is what the deck's top edge means.
farthest = 0;
for (i = 0; i < R.constants.sky.bodies.length; i += 1) {
	body = R.constants.sky.bodies[i];
	farthest = Math.max(farthest, (body.distanceRadii + body.radiusRadii) * planet.radius);
}
camera.setExtent(farthest);
camera.follow(0, 0, 0);
assert.ok(Math.abs(camera.ceiling - farthest) < 1e-6, 'the charted extent is the deck ceiling');

camera.project(0, camera.ceiling, screen);
assert.equal(screen.y, camera.topY(), 'the far limb maps to the top edge');
camera.project(0, R.physics.atmosphereTop(), screen);
airY = screen.y;
assert.ok(airY < camera.groundY * 0.78 && airY > camera.groundY * 0.3,
	'the atmosphere top sits between 22% and 70% up the deck (got ' +
	Math.round(100 * (1 - airY / camera.groundY)) + '%)');
// The air column keeps more room than the whole rest of the system: that is
// the point of compressing the top layers.
assert.ok(camera.groundY - airY > airY, 'the air column is taller than the space above it');
// And the flight band is still usable: 1 km is a clear band, not a hairline.
camera.project(0, 1000, screen);
assert.ok(screen.y > airY && screen.y < camera.groundY - 100, '1 km sits inside the air column band');

// ---------------------------------------------------------------------------
// Drag pans one pixel per pixel, and a zoom keeps the ship on its anchor.
// ---------------------------------------------------------------------------

camera.project(1000, 500, screen);
before = { x: screen.x, y: screen.y };
camera.panBy(37, -23);
assert.equal(camera.panX, 37);
camera.project(1000, 500, screen);
assert.ok(Math.abs(screen.x - before.x - 37) < 1e-9, 'a drag moves the chart with the pointer in x');
assert.ok(Math.abs(screen.y - before.y + 23) < 1e-9, 'and in y');
camera.resetPan();
assert.equal(camera.panX, 0);
assert.equal(camera.zoom, 1);

camera.follow(1000, 0, 0);
camera.project(1000, 0, screen);
assert.ok(Math.abs(screen.x - 480) < 1e-9, 'the ship sits on the anchor before the zoom');
camera.zoomBy(2);
camera.follow(1000, 0, 0);
camera.project(1000, 0, screen);
assert.ok(Math.abs(screen.x - 480) < 1e-9, 'and after a zoom');
assert.ok(Math.abs(screen.y - camera.groundY) < 1e-6, 'the surface stays on the ground line');
camera.project(1000, 1000, screen);
assert.ok(screen.y < airY, 'a zoom magnifies the flight band');
camera.resetPan();

// A ship above the charted extent is still placed: sky.js widens the extent to
// include it, and the deck follows without losing the ground line.
camera.setExtent(Math.max(farthest, 200000));
camera.follow(0, 200000, 0);
camera.project(0, 200000, screen);
assert.ok(screen.y > 0 && screen.y < camera.groundY, 'a high ship stays between the top edge and the ground');
camera.project(0, 0, screen);
assert.ok(Math.abs(screen.y - camera.groundY) < 1e-9, 'and the ground line does not move');

// A planet switch must rebuild the horizontal scale and pad longitudes.
R.world.initialize('gossamer');
camera.resize(1440, 900);
assert.equal(planet.circumference, 26000, 'gossamer circumference is live');
assert.equal(R.world.pads.length, 4);
assert.equal(R.world.pads[2].wx, R.world.planet.circumference * 0.45);
assert.ok(Math.abs(camera.pixelsPerMeterX - 1440 / 26000) < 1e-12, 'horizontal scale follows the planet');

console.log('Coordinate tests passed.');
