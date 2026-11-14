'use strict';

// A picture of the chart, drawn by the real renderer into a software canvas and
// printed as text. It exists because a projection is a shape, not a number: the
// suites assert the law, and this shows what the law looks like on the deck,
// above the air, seated on a moon, halfway through a drag and halfway through a
// hand-over. Run it after any change to the chart layer and read the pictures.
//
//   node experiments/chart-picture.js            prints every state
//   node experiments/chart-picture.js deck drag  prints the named states
//
// The output is kept in experiments/logs/chart-picture.txt.

var fs = require('node:fs');
var path = require('node:path');
var R = require('../js/namespaces.js');
require('../js/util.js');
require('../js/constants.js');
require('../js/planets.js');
require('../js/coords.js');
require('../js/camera.js');
require('../js/world.js');
require('../js/physics.js');
require('../js/sky.js');
require('../js/render.js');

var CELL_X = 11;
var CELL_Y = 21;
var PALETTE = '#%@&$*+=-:.~,;\'`^v<>[](){}|/\\!?_abcdeffghijklmnopqrstuvwxyz';
var CANVAS_WIDTH = 1440;
var CANVAS_HEIGHT = 900;
var columns = Math.ceil(CANVAS_WIDTH / CELL_X);
var rows = Math.ceil(CANVAS_HEIGHT / CELL_Y);

var grid;
var legend;
var styles;
var labels;
var currentPath;
var currentFill;
var currentStroke;

function blankGrid() {
	var y;
	var x;

	grid = [];
	for (y = 0; y < rows; y += 1) {
		grid.push(new Array(columns).fill(' '));
	}
}

// One character per paint style, in the order the renderer first uses it, so the
// picture says which region is which without knowing the palette in advance.
function charOf(style) {
	var key = String(style);

	if (!Object.prototype.hasOwnProperty.call(styles, key)) {
		styles[key] = PALETTE[legend.length % PALETTE.length];
		legend.push(styles[key] + ' ' + key);
	}
	return styles[key];
}

function put(px, py, char) {
	var x = Math.floor(px / CELL_X);
	var y = Math.floor(py / CELL_Y);

	if (x < 0 || y < 0 || x >= columns || y >= rows || char === ' ') {
		return;
	}
	grid[y][x] = char;
}

function mark(x, y, inside, char) {
	if (inside) {
		grid[y][x] = char;
	}
}

// Even-odd scanline fill, sampled at cell centres: coarse, and exactly what a
// layout check needs.
function fillPolygon(points, char) {
	var crossings = [];
	var y;
	var x;
	var px;
	var py;
	var i;
	var j;
	var xi;
	var yi;
	var xj;
	var yj;

	if (points.length < 3) {
		return;
	}
	for (y = 0; y < rows; y += 1) {
		py = (y + 0.5) * CELL_Y;
		crossings.length = 0;
		for (i = 0; i < points.length; i += 1) {
			j = (i + 1) % points.length;
			yi = points[i][1];
			yj = points[j][1];
			if ((yi <= py && yj > py) || (yj <= py && yi > py)) {
				crossings.push(points[i][0] + (py - yi) / (yj - yi) * (points[j][0] - points[i][0]));
			}
		}
		crossings.sort(function(a, b) {
			return a - b;
		});
		for (i = 0; i + 1 < crossings.length; i += 2) {
			for (x = Math.floor(crossings[i] / CELL_X); x <= Math.floor(crossings[i + 1] / CELL_X); x += 1) {
				px = (x + 0.5) * CELL_X;
				if (x < 0 || x >= columns || px < crossings[i] || px > crossings[i + 1]) {
					continue;
				}
				mark(x, y, true, char);
			}
		}
	}
}

function strokePolyline(points, char, closed) {
	var count = closed ? points.length : points.length - 1;
	var steps;
	var i;
	var k;

	for (i = 0; i < count; i += 1) {
		steps = Math.max(2, Math.ceil(Math.hypot(points[(i + 1) % points.length][0] - points[i][0],
			points[(i + 1) % points.length][1] - points[i][1]) / 3));
		for (k = 0; k <= steps; k += 1) {
			put(points[i][0] + (points[(i + 1) % points.length][0] - points[i][0]) * k / steps,
				points[i][1] + (points[(i + 1) % points.length][1] - points[i][1]) * k / steps, char);
		}
	}
}

function arcPoints(args) {
	var points = [];
	var steps = 48;
	var i;

	for (i = 0; i <= steps; i += 1) {
		points.push([args[0] + args[2] * Math.cos(args[3] + (args[4] - args[3]) * i / steps),
			args[1] + args[2] * Math.sin(args[3] + (args[4] - args[3]) * i / steps)]);
	}
	return points;
}

function makeContext() {
	var context = {};
	var noop = ['save', 'restore', 'clip', 'setTransform', 'translate', 'rotate', 'scale',
		'setLineDash', 'quadraticCurveTo', 'bezierCurveTo'];
	var i;

	context.beginPath = function() {
		currentPath = [];
	};
	context.moveTo = function(x, y) {
		currentPath.push([x, y]);
	};
	context.lineTo = function(x, y) {
		currentPath.push([x, y]);
	};
	context.closePath = function() {
		currentPath.closed = true;
	};
	context.arc = function() {
		arcPoints(arguments).forEach(function(point) {
			currentPath.push(point);
		});
	};
	context.fill = function() {
		fillPolygon(currentPath, charOf(currentFill));
	};
	context.stroke = function() {
		strokePolyline(currentPath, charOf(currentStroke), currentPath.closed);
	};
	context.fillRect = function(x, y, width, height) {
		fillPolygon([[x, y], [x + width, y], [x + width, y + height], [x, y + height]],
			charOf(currentFill));
	};
	context.strokeRect = function(x, y, width, height) {
		strokePolyline([[x, y], [x + width, y], [x + width, y + height], [x, y + height]],
			charOf(currentStroke), true);
	};
	context.fillText = function(text, x, y) {
		labels.push([String(text), x, y]);
		put(x, y, 'T');
	};
	context.clearRect = function() {
		blankGrid();
	};
	// Named by its stops, so the legend says which wash a region is instead of
	// printing an object.
	context.createLinearGradient = function() {
		var stops = [];

		return {
			addColorStop: function(offset, color) {
				if (stops.indexOf(color) < 0) {
					stops.push(color);
				}
			},
			toString: function() {
				return 'gradient(' + stops.join(' > ') + ')';
			}
		};
	};
	context.createPattern = function() {
		return { pattern: true };
	};
	for (i = 0; i < noop.length; i += 1) {
		context[noop[i]] = function() {};
	}
	Object.defineProperty(context, 'fillStyle', {
		get: function() {
			return currentFill;
		},
		set: function(value) {
			currentFill = value && value.pattern ? 'ground pattern' : value;
		}
	});
	Object.defineProperty(context, 'strokeStyle', {
		get: function() {
			return currentStroke;
		},
		set: function(value) {
			currentStroke = value;
		}
	});
	return context;
}

var context = makeContext();
var game = { rocket: { wx: 0, wy: 0 }, simTime: 0, phase: 'demo' };
var picture = [];

// render.initialize builds the ground tile on an offscreen canvas; the picture
// only needs the pattern to be a distinguishable paint, not a real one.
global.document = {
	createElement: function() {
		return {
			width: 0,
			height: 0,
			getContext: function() {
				return { fillRect: function() {} };
			}
		};
	}
};

function step(frames) {
	var i;

	for (i = 0; i < frames; i += 1) {
		R.sky.update(game, 0.016);
	}
}

// The cutaway, read at the column nearest the pole. Each band is a concentric
// sphere at a fixed fraction of the ground radius, so its depth is a log of that
// fraction and the bands spread downward on screen; the picture cannot show
// alpha, so the numbers stand in for it.
function cutawayNote() {
	var curves = R.render.curves;
	var columns = R.constants.view.groundColumns;
	var stride = columns + 1;
	var column = Math.round(R.camera.ox / (R.render.width / columns));
	var note = ['cutaway ' + curves.bands + '/' + R.constants.render.cutawayBands.length];
	var i;

	column = Math.max(0, Math.min(columns, column));
	if (!curves.radial) {
		note.push('pole outside the ground sphere');
	} else {
		note.push('surface y ' + curves.groundYs[column].toFixed(0));
	}
	for (i = 0; i < curves.bands; i += 1) {
		note.push(R.constants.render.cutawayBands[i].fraction.toFixed(2) + 'R y ' +
			curves.bandYs[i * stride + column].toFixed(0));
	}
	return note.join('  ');
}

function draw(title, note) {
	var camera = R.camera;
	var text;
	var i;

	styles = {};
	legend = [];
	labels = [];
	blankGrid();
	R.render.drawChart(context, game);
	text = [title, note || ''];
	for (i = 0; i < rows; i += 1) {
		text.push('|' + grid[i].join('') + '|');
	}
	text.push('ground ' + camera.groundY.toFixed(0) + '  origin ' + camera.originY.toFixed(0) +
		'  scale ' + camera.scale.toFixed(1) + ' px/nat  range ' + camera.range.toFixed(2) +
		'  period ' + camera.period.toFixed(0) + '  fly ' + camera.fly.toFixed(2) +
		'  ground body ' + R.sky.bodyOf(R.sky.groundBody()).name +
		'  radial ' + R.render.curves.radial);
	text.push(cutawayNote());
	text.push('legend: ' + legend.join('   '));
	text.push('labels: ' + labels.map(function(entry) {
		return entry[0] + '@' + Math.round(entry[1]) + ',' + Math.round(entry[2]);
	}).join('  '));
	picture.push(text.join('\n'));
}

// ---------------------------------------------------------------------------

function state(name, setup, frames, note) {
	return { name: name, setup: setup, frames: frames, note: note };
}

var states = [
	state('deck', function() {
		game.rocket.wy = 0;
	}, 200, 'Landed: the world is the ground, the air column keeps most of the deck, the catalog sits low over the surface.'),
	state('climb', function() {
		game.rocket.wy = 3000;
	}, 300, 'Inside the air: the ground still holds the camera target.'),
	state('above-air', function() {
		game.rocket.wy = 100000;
	}, 500, 'Above the air: the ship is the centre of the scale, it holds the origin line and the ground sinks below it.'),
	state('moon-distance', function() {
		game.rocket.wy = 23 * R.world.planet.radius;
	}, 500, 'Out at the moon: one scale still carries the ship, the moon and the star.'),
	state('seat-moon', function() {
		game.rocket.wy = 0;
		R.sky.seatPivot(3, game);
	}, 200, 'Seated on the moon: its surface is the ground line, its interior the cutaway, the world a lens.'),
	state('hand-over', function() {
		R.sky.seatPivot(2, game);
	}, 20, 'Halfway through the hand-over to Ember: the anchor does not move, the ground sphere travels with the pole.'),
	state('drag-body', function() {
		var lens;

		R.sky.reset();
		step(200);
		lens = R.sky.outline(3, game);
		R.sky.handBegin(lens.centerX, lens.centerY, game);
		R.sky.handMove(lens.centerX, (lens.centerY + R.sky.anchor.line) * 0.5);
	}, 4, 'Halfway through a drag on the moon: the grabbed surface point is held under the pointer, the pole walks toward it.'),
	state('drag-free', function() {
		R.sky.handEnd();
		R.sky.reset();
		step(200);
		R.sky.handBegin(180, 200, game);
		R.sky.handMove(180, R.sky.anchor.line);
	}, 4, 'A drag in empty space, taken all the way down: the pole stands on a surface, the ground is the flat line.'),
	state('zoom', function() {
		R.sky.handEnd();
		R.sky.reset();
		step(200);
		R.camera.zoomBy(3);
	}, 60, 'Zoomed in on the deck: the ground line holds, the air column magnifies, the catalog leaves the top.')
];

var wanted = process.argv.slice(2);
var text;

R.world.initialize('verdant');
R.render.initialize(context);
R.render.resize(CANVAS_WIDTH, CANVAS_HEIGHT);
R.sky.reset();
R.game = game;

states.forEach(function(entry) {
	if (wanted.length > 0 && wanted.indexOf(entry.name) < 0) {
		return;
	}
	R.world.initialize('verdant');
	R.render.resize(CANVAS_WIDTH, CANVAS_HEIGHT);
	R.sky.reset();
	R.camera.resetZoom();
	entry.setup();
	step(entry.frames);
	draw(entry.name.toUpperCase() + '  ·  ' + CANVAS_WIDTH + 'x' + CANVAS_HEIGHT, entry.note);
});

text = 'Chart pictures — ' + new Date().toISOString().slice(0, 10) + '\n\n' + picture.join('\n\n') + '\n';
process.stdout.write(text);
fs.writeFileSync(path.join(__dirname, 'logs', 'chart-picture.txt'), text);
