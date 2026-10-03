'use strict';

// A very small DOM, just enough for the operations deck: the smoke test parses
// the real index.html, so a missing id or a wrong tag name fails there instead
// of in a browser. It is a fixture, not a browser: layout, styles and events
// other than the ones wired by hand do not exist.

var voidTags = { input: 1, br: 1, hr: 1, img: 1, meta: 1, link: 1, source: 1 };

function ClassList(node) {
	this.node = node;
}

ClassList.prototype.add = function(name) {
	var names = this.node.className ? this.node.className.split(/\s+/) : [];

	if (names.indexOf(name) < 0) {
		names.push(name);
		this.node.className = names.join(' ');
	}
};

ClassList.prototype.remove = function(name) {
	this.node.className = this.node.className.split(/\s+/).filter(function(entry) {
		return entry && entry !== name;
	}).join(' ');
};

ClassList.prototype.contains = function(name) {
	return this.node.className.split(/\s+/).indexOf(name) >= 0;
};

function Node(tagName) {
	this.tagName = String(tagName || '').toUpperCase();
	this.childNodes = [];
	this.parentNode = null;
	this.attributes = {};
	this.dataset = {};
	this.id = '';
	this.className = '';
	this.value = '';
	this.checked = false;
	this.disabled = false;
	this.hidden = false;
	this.type = '';
	this.max = '';
	this.min = '';
	this.text = '';
	this.listeners = {};
	this.classList = new ClassList(this);
}

Object.defineProperty(Node.prototype, 'textContent', {
	get: function() {
		if (this.childNodes.length === 0) {
			return this.text;
		}
		return this.childNodes.map(function(child) {
			return child.textContent;
		}).join('');
	},
	set: function(value) {
		this.childNodes.length = 0;
		this.text = String(value);
	}
});

Object.defineProperty(Node.prototype, 'innerHTML', {
	get: function() {
		return '';
	},
	set: function(value) {
		if (value === '') {
			this.childNodes.length = 0;
			this.text = '';
		}
	}
});

Object.defineProperty(Node.prototype, 'options', {
	get: function() {
		return this.childNodes.filter(function(child) {
			return child.tagName === 'OPTION';
		});
	}
});

Object.defineProperty(Node.prototype, 'firstChild', {
	get: function() {
		return this.childNodes[0] || null;
	}
});

Node.prototype.appendChild = function(child) {
	child.parentNode = this;
	this.childNodes.push(child);
	return child;
};

Node.prototype.setAttribute = function(name, value) {
	this.attributes[name] = String(value);
	if (name === 'id') {
		this.id = String(value);
	}
	if (name === 'class') {
		this.className = String(value);
	}
};

Node.prototype.getAttribute = function(name) {
	return this.attributes[name] === undefined ? null : this.attributes[name];
};

Node.prototype.removeAttribute = function(name) {
	delete this.attributes[name];
};

Node.prototype.addEventListener = function(type, handler) {
	(this.listeners[type] || (this.listeners[type] = [])).push(handler);
};

Node.prototype.removeEventListener = function(type, handler) {
	var list = this.listeners[type] || [];
	var index = list.indexOf(handler);

	if (index >= 0) {
		list.splice(index, 1);
	}
};

// Dispatches to this node's own handlers only; the deck wires every listener on
// the node it means, so bubbling is not needed.
Node.prototype.dispatch = function(type, event) {
	var list = (this.listeners[type] || []).slice();
	var payload = event || {};
	var i;

	payload.type = type;
	payload.target = payload.target || this;
	payload.preventDefault = payload.preventDefault || function() {};
	for (i = 0; i < list.length; i += 1) {
		list[i].call(this, payload);
	}
	return list.length;
};

Node.prototype.click = function() {
	this.dispatch('click', {});
};

Node.prototype.focus = function() {
	this.ownerDocument.activeElement = this;
};

Node.prototype.blur = function() {
	if (this.ownerDocument.activeElement === this) {
		this.ownerDocument.activeElement = this.ownerDocument.body;
	}
};

function matches(node, selector) {
	var parts = selector.trim().split(/\s*,\s*/);
	var i;
	var part;

	for (i = 0; i < parts.length; i += 1) {
		part = parts[i];
		if (part.charAt(0) === '[') {
			if (node.getAttribute(part.slice(1, -1)) !== null) {
				return true;
			}
			continue;
		}
		if (part.charAt(0) === '.') {
			if (node.classList.contains(part.slice(1))) {
				return true;
			}
			continue;
		}
		if (node.tagName === part.toUpperCase()) {
			return true;
		}
	}
	return false;
}

Node.prototype.querySelectorAll = function(selector) {
	var found = [];

	(function walk(node) {
		node.childNodes.forEach(function(child) {
			if (matches(child, selector)) {
				found.push(child);
			}
			walk(child);
		});
	})(this);
	return found;
};

// A forgiving tokenizer for this repository's own well-formed markup.
function parse(html, document) {
	var root = new Node('html');
	var stack = [root];
	var position = 0;
	var tag;
	var node;
	var name;
	var text;

	root.ownerDocument = document;
	while (position < html.length) {
		tag = html.indexOf('<', position);
		if (tag < 0) {
			break;
		}
		text = html.slice(position, tag).trim();
		if (text) {
			stack[stack.length - 1].appendChild(textNode(text, document));
		}
		if (html.substr(tag, 4) === '<!--') {
			position = html.indexOf('-->', tag) + 3;
			continue;
		}
		if (html.charAt(tag + 1) === '!') {
			position = html.indexOf('>', tag) + 1;
			continue;
		}
		if (html.charAt(tag + 1) === '/') {
			position = html.indexOf('>', tag) + 1;
			stack.pop();
			continue;
		}
		position = readTag(html, tag, stack, document);
	}
	return root;
}

function textNode(text, document) {
	var node = new Node('#text');

	node.ownerDocument = document;
	node.text = text;
	return node;
}

function readTag(html, start, stack, document) {
	var end = html.indexOf('>', start);
	var body = html.slice(start + 1, end);
	var selfClosing = body.charAt(body.length - 1) === '/';
	var node;
	var name;
	var match;
	var attribute = /([\w:-]+)(?:\s*=\s*"([^"]*)")?/g;

	if (selfClosing) {
		body = body.slice(0, -1);
	}
	name = body.split(/[\s/]/)[0];
	node = new Node(name);
	node.ownerDocument = document;
	attribute.lastIndex = name.length;
	while ((match = attribute.exec(body)) !== null) {
		if (!match[1]) {
			continue;
		}
		node.setAttribute(match[1], match[2] === undefined ? '' : match[2]);
	}
	node.id = node.getAttribute('id') || '';
	node.className = node.getAttribute('class') || '';
	node.type = node.getAttribute('type') || '';
	node.value = node.getAttribute('value') || '';
	node.checked = node.getAttribute('checked') !== null;
	node.hidden = node.getAttribute('hidden') !== null;
	node.disabled = node.getAttribute('disabled') !== null;
	stack[stack.length - 1].appendChild(node);
	if (!selfClosing && !voidTags[name.toLowerCase()]) {
		stack.push(node);
	}
	return end + 1;
}

function createDocument(html) {
	var document = {
		readyState: 'complete',
		activeElement: null,
		listeners: {},
		createElement: function(tagName) {
			var node = new Node(tagName);

			node.ownerDocument = document;
			return node;
		},
		getElementById: function(id) {
			var found = null;

			(function walk(node) {
				node.childNodes.forEach(function(child) {
					if (child.id === id) {
						found = child;
					}
					walk(child);
				});
			})(document.documentElement);
			return found;
		},
		addEventListener: function(type, handler) {
			(document.listeners[type] || (document.listeners[type] = [])).push(handler);
		},
		dispatch: function(type, event) {
			var list = (document.listeners[type] || []).slice();
			var i;

			for (i = 0; i < list.length; i += 1) {
				list[i](event);
			}
		}
	};

	document.documentElement = parse(html, document);
	document.body = document.documentElement.querySelectorAll('body')[0] || document.documentElement;
	document.activeElement = document.body;
	return document;
}

module.exports = { createDocument: createDocument, Node: Node };
