'use strict';

var assert = require('node:assert/strict');
var R = require('../js/namespaces.js');

require('../js/util.js');
require('../js/constants.js');
require('../js/coords.js');
require('../js/camera.js');
require('../js/world.js');
require('../js/rocket.js');
require('../js/economy.js');
require('../js/mission.js');
require('../js/physics.js');
require('../js/builder.js');

function Element(value) {
	this.value = value || '';
	this.hidden = false;
	this.disabled = false;
	this.textContent = '';
	this.dataset = {};
	this.options = [];
	this.listeners = {};
	this.children = [];
}

Element.prototype.addEventListener = function(type, listener) {
	this.listeners[type] = listener;
};

Element.prototype.appendChild = function(child) {
	this.children.push(child);
	this.options.push(child);
};

Element.prototype.removeAttribute = function(name) {
	delete this.dataset[name.replace('data-', '').replace(/-([a-z])/g, function(match, letter) {
		return letter.toUpperCase();
	})];
};

Element.prototype.blur = function() {
	this.wasBlurred = true;
};

Object.defineProperty(Element.prototype, 'innerHTML', {
	set: function(value) {
		if (value === '') {
			this.children.length = 0;
			this.options.length = 0;
			this.value = '';
		}
	}
});

Element.prototype.dispatch = function(type) {
	this.listeners[type]();
};

var elements = {
	'builder-panel': new Element(),
	'builder-report': new Element(),
	'builder-target': new Element(),
	'builder-stage-count': new Element('3'),
	'builder-payload': new Element('120'),
	'builder-payload-value': new Element(),
	'builder-cash': new Element(),
	'builder-report-title': new Element(),
	'builder-report-detail': new Element(),
	'builder-mass': new Element(),
	'builder-steel': new Element(),
	'builder-fuel': new Element(),
	'builder-dv': new Element(),
	'builder-twr': new Element(),
	'builder-cost': new Element(),
	'builder-warning': new Element(),
	'launch-button': new Element()
};
var i;

for (i = 0; i < 3; i += 1) {
	elements['builder-stage-' + i] = new Element();
	elements['builder-fuel-' + i] = new Element(String(R.constants.rocket.defaultStageFuel[i]));
	elements['builder-strength-' + i] = new Element(String(R.constants.rocket.defaultStageStrength[i]));
	elements['builder-fuel-value-' + i] = new Element();
	elements['builder-strength-value-' + i] = new Element();
}

global.document = {
	getElementById: function(id) {
		return elements[id] || null;
	},
	createElement: function() {
		return new Element();
	}
};

R.world.initialize();
var home = R.world.findPadById('homeport');
var game = {
	currentPadId: home.id,
	targetPadId: 'eastport',
	rocket: R.rocket.create(home),
	phase: 'building',
	cash: R.economy.startingCash,
	ledger: [],
	flight: null,
	lastReport: null,
	physicsAccumulator: 0
};
R.game = game;
R.builder.initialize(game);

assert.equal(R.builder.initialized, true);
assert.equal(elements['builder-panel'].hidden, false);
assert.equal(elements['builder-stage-2'].hidden, false);
assert.equal(elements['launch-button'].disabled, false);
assert.equal(elements['builder-warning'].textContent, '');
assert.equal(elements['builder-target'].options.length, R.world.pads.length - 1);

var target = elements['builder-target'];
target.value = 'farport';
target.dispatch('change');
assert.equal(game.targetPadId, 'farport');

elements['launch-button'].dispatch('click');
assert.equal(game.phase, 'flying');
assert.equal(game.targetPadId, 'farport');
assert.equal(elements['builder-panel'].hidden, true);
assert.equal(elements['launch-button'].wasBlurred, true);

var farport = R.world.findPadById('farport');
game.rocket.wx = farport.wx;
game.rocket.wy = 0;
game.rocket.vx = 0;
game.rocket.vy = 0;
R.mission.touchdown(game);
assert.equal(game.lastReport.status, 'delivered');
assert.equal(elements['builder-panel'].hidden, false);
assert.equal(elements['builder-report'].hidden, false);
assert.equal(elements['builder-report'].dataset.status, 'delivered');
assert.equal(game.currentPadId, 'farport');
assert.equal(elements['builder-target'].value, 'homeport');

console.log('Builder and launch-flow tests passed.');
delete global.document;
