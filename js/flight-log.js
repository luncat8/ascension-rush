(function(root) {
	'use strict';

	var R = root.R || (root.R = {});
	var flightLog = R.flightLog || (R.flightLog = {});

	// Append-only history of finished legs, newest first. A leg that failed is
	// a record like any other: the log is the durable source of history, while
	// `game.lastReport` is only the current debrief. Route totals live on the
	// route, so trimming the log never loses a counter.
	flightLog.limit = R.constants.operations.flightLogLimit;
	flightLog.entries = [];

	flightLog.append = function(entry) {
		flightLog.entries.unshift(entry);
		while (flightLog.entries.length > flightLog.limit) {
			flightLog.entries.pop();
		}
		return entry;
	};

	flightLog.findById = function(id) {
		var entries = flightLog.entries;
		var i;

		for (i = 0; i < entries.length; i += 1) {
			if (entries[i].id === id) {
				return entries[i];
			}
		}
		return null;
	};

	flightLog.countByRoute = function(routeId) {
		var entries = flightLog.entries;
		var count = 0;
		var i;

		for (i = 0; i < entries.length; i += 1) {
			count += entries[i].routeId === routeId ? 1 : 0;
		}
		return count;
	};

	flightLog.reset = function() {
		flightLog.entries.length = 0;
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = flightLog;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
