'use strict';

var assert = require('node:assert/strict');
var R = require('../js/namespaces.js');

require('../js/util.js');
require('../js/constants.js');
require('../js/planets.js');
require('../js/coords.js');
require('../js/camera.js');
require('../js/world.js');
require('../js/rocket.js');
require('../js/economy.js');
require('../js/mission.js');
require('../js/aerodynamics.js');
require('../js/physics.js');
require('../js/trajectory.js');
require('../js/autopilot.js');
require('../js/builder.js');
require('../js/controls.js');

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
	'builder-planet-name': new Element(),
	'builder-planet-button': new Element(),
	'builder-autopilot': new Element(),
	'builder-autopilot-profile': new Element(),
	'builder-autopilot-profile-hint': new Element(),
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
var home = R.world.pads[0];
var game = {
	currentPadId: home.id,
	targetPadId: R.world.pads[1].id,
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
target.value = R.world.pads[2].id;
target.dispatch('change');
assert.equal(game.targetPadId, R.world.pads[2].id);

// The profile choice lists every profile, defaults to the first, and rides along with the launch.
var profileSelect = elements['builder-autopilot-profile'];
var profileHint = elements['builder-autopilot-profile-hint'];
assert.deepEqual(profileSelect.options.map(function(option) { return option.value; }), R.constants.autopilotProfiles.map(function(profile) { return profile.id; }));
assert.equal(profileSelect.value, 'balanced', 'the first profile is the default');
assert.equal(profileHint.textContent, R.autopilot.profileById('balanced').description);
profileSelect.value = 'gentle';
profileSelect.dispatch('change');
assert.equal(R.autopilot.profileId, 'gentle', 'the select chooses the autopilot profile');
assert.equal(profileHint.textContent, R.autopilot.profileById('gentle').description, 'the hint describes the chosen profile');

elements['launch-button'].dispatch('click');
assert.equal(game.phase, 'flying');
assert.equal(game.targetPadId, R.world.pads[2].id);
assert.equal(elements['builder-panel'].hidden, true);
assert.equal(elements['launch-button'].wasBlurred, true);
assert.equal(game.flight.autopilotProfile, 'gentle', 'the launch snapshots the chosen profile');

var farport = R.world.pads[2];
game.rocket.wx = farport.wx;
game.rocket.wy = 0;
game.rocket.vx = 0;
game.rocket.vy = 0;
R.mission.touchdown(game);
assert.equal(game.lastReport.status, 'delivered');
assert.equal(elements['builder-panel'].hidden, false);
assert.equal(elements['builder-report'].hidden, false);
assert.equal(elements['builder-report'].dataset.status, 'delivered');
assert.equal(game.currentPadId, farport.id);
assert.equal(elements['builder-target'].value, home.id, 'the destination list excludes the pad under the rocket');
assert.equal(profileSelect.value, 'gentle', 'the profile choice outlives the flight');
R.autopilot.setProfile('balanced');

// Switching worlds reloads that planet's reference build and pad list.
R.world.initialize('cinder');
var cinderHome = R.world.pads[0];
game = {
	currentPadId: cinderHome.id,
	targetPadId: R.world.pads[1].id,
	rocket: R.rocket.create(cinderHome),
	phase: 'building',
	cash: R.economy.startingCash,
	ledger: [],
	flight: null,
	lastReport: null,
	physicsAccumulator: 0
};
R.game = game;
R.builder.refresh(game);
assert.equal(elements['builder-planet-name'].textContent, 'Cinder');
assert.equal(elements['builder-payload'].value, '60', 'payload slider adopts the planet default');
assert.equal(elements['builder-fuel-0'].value, '1500', 'booster fuel adopts the planet default');
assert.equal(elements['builder-fuel-2'].value, '400', 'kick stage fuel adopts the planet default');
assert.equal(elements['builder-target'].options.length, 3);
assert.equal(elements['launch-button'].disabled, false, 'cinder reference build clears the launch TWR gate');

console.log('Builder and launch-flow tests passed.');
delete global.document;
