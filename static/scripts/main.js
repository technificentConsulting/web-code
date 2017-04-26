/* global require, monaco, Map, Promise, PouchDB */
/* eslint no-var: 0, no-console: 0 */
'use strict';

require.config({ paths: { 'vs': 'vs' }});
require(['vs/editor/editor.main'], function() {
	var editor = monaco.editor.create(document.getElementById('container'));
	window.editor = editor;
	console.log(editor);
});

var ws = new WebSocket((location.hostname === 'localhost' ? 'ws://' : 'wss://') + location.host);
ws.binaryType = 'arraybuffer';

var promises = new Map();

ws.addEventListener('message', function m(e) {
	if (typeof e.data === 'string') {
		var result = JSON.parse(e.data);
		var promiseResolver = promises.get(result[1]);
		var data = result[2];
		if (promiseResolver) {
			promises.delete(result[1]);

			if (data.error) {
				return promiseResolver[1](Error(data.error));
			} else {
				return promiseResolver[0](data);
			}
		}
	}
});

function remoteCmd(cmd, data) {
	var id = performance.now() + '_' + Math.random();
	ws.send(JSON.stringify([
		'STAT',
		id,
		data
	]));
	return new Promise(function (resolve, reject) {
		promises.set(id, [resolve, reject]);
	});
}

// Connection opened
ws.addEventListener('open', function firstOpen() {
	ws.removeEventListener('open', firstOpen);
	init();
});

var db = new PouchDB('web-code', {});

function init() {
	db.get('INIT_STATE').then(function (doc) {
		if (doc.previous_path) {
			openPath(doc.previous_path);
		}
		promptForOpen();
	})
	.catch(function (err) {
		promptForOpen();
		console.log(err);
	});
}

function openPath(path) {
	remoteCmd('STAT', path).then(function (data) {
		console.log(data);
	});
}

function promptForOpen() {
	openFileDialog('/').then(function () {

	});
}

function populateFileList(el, path) {
	el.path = path;
	return remoteCmd('STAT', path)
		.then(function (data) {
			if (data.isFile) {
				return remoteCmd('STAT', data.dirName);
			}
			return data;
		})
		.then(function (data) {

			el.innerHTML = '';
			data.children
				.filter(function (datum) {
					return datum.name[0] !== '.' || datum.name === '..';
				})
				.sort(function (a, b) {
					if (
						(a.isDir === b.isDir) &&
						(a.isFile === b.isFile)
					) {
						return ([a.name, b.name].sort(function (a, b) {
							return a.toLowerCase().localeCompare(b.toLowerCase());
						})[0] === a.name ? -1 : 1);
					} else {
						if (a.isDir) return -1;
						return 1;
					}
				}).map(function (datum) {
					var li = document.createElement('li');
					li.dataset.mime = datum.mime;
					li.dataset.name = datum.name;
					li.dataset.size = datum.size;
					li.textContent = datum.name;
					li.data = datum;
					el.appendChild(li);
				});
		});
}

function openFileDialog(path) {

	openFileDialog.el = openFileDialog.el || document.querySelector('#file-open-widget');
	openFileDialog.currentPathEl = openFileDialog.currentPathEl || openFileDialog.el.querySelector('input[name="current-path"]');
	openFileDialog.filelistLeft = openFileDialog.filelistLeft || openFileDialog.el.querySelector('.filelist:first-child');
	openFileDialog.filelistRight = openFileDialog.filelistRight || openFileDialog.el.querySelector('.filelist:not(:first-child)');
	openFileDialog.openButton = openFileDialog.openButton || openFileDialog.el.querySelector('#open');

	var highlightedEl;
	var currentPath;
	var resolver;

	function highlight(e) {
		if (e.target.tagName === 'LI') {
			if (highlightedEl) {
				highlightedEl.classList.remove('has-highlight');
			}
			highlightedEl = e.target;
			highlightedEl.classList.add('has-highlight');

			currentPath = e.target.data.path;
			openFileDialog.currentPathEl.value = currentPath;

			if (e.target.data && e.target.data.isDir) {
				if (e.currentTarget === openFileDialog.filelistLeft) {
					if (e.target.data.name === '..') {
						populateFileList(openFileDialog.filelistLeft, e.target.data.path);
						openFileDialog.filelistRight.innerHTML = '';
					} else {
						populateFileList(openFileDialog.filelistRight, e.target.data.path);
					}
				}
				if (e.currentTarget === openFileDialog.filelistRight) {
					populateFileList(openFileDialog.filelistLeft, e.target.data.dirName).then(function () {
						[].slice.call(openFileDialog.filelistLeft.children).forEach(function (el) {
							if (el.data.path === currentPath) {
								highlightedEl = e.target;
								highlightedEl.classList.add('has-highlight');
							}
						});
					});
					populateFileList(openFileDialog.filelistRight, e.target.data.path);
				}
			}
		}
	}

	function ondblclick(e) {
		highlight(e);
		if (e.target.data && e.target.data.isDir) return;
		open(e.target.data.path);
	}

	function open(data) {
		if (!data) data = currentPath;
		resolver = undefined;
		resolver(data);
	}

	if (!openFileDialog.hasEventListeners) {
		openFileDialog.hasEventListeners = true;
		openFileDialog.filelistLeft.addEventListener('click', highlight);
		openFileDialog.filelistRight.addEventListener('click', highlight);
		openFileDialog.filelistLeft.addEventListener('dblclick', ondblclick);
		openFileDialog.filelistRight.addEventListener('dblclick', ondblclick);
		openFileDialog.openButton.addEventListener('click', open);
	}

	return new Promise(function (resolve) {
		if (openFileDialog.open === undefined) openFileDialog.open = false;
		if (openFileDialog.open === true) {
			throw Error('Dialog already open for another task.');
		}
		path = path || '/';
		openFileDialog.el.classList.remove('closed');
		resolver = resolve;

		populateFileList(openFileDialog.filelistLeft, path)
		.catch(function (e) {
			console.log(e);
			return populateFileList(openFileDialog.filelistLeft, '/')
		});
	});
}