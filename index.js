#! /usr/bin/env node
/* eslint-env es6 */

const server = require('http').createServer();
const WebSocketServer = require('ws').Server;
const wss = new WebSocketServer({ server: server });
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;
const api = require('./lib/api');
const wsMessaging = require('./lib/ws-routing');
const nodePath = require('path');
const Client = require('./lib/client');
const lockFile = require('lockfile');
const fs = require('fs');
const exec = require('child_process').exec;
const execSync = require('child_process').execSync;
function puts(error, stdout, stderr) { console.log(stdout); console.log(stderr); }

let lastWorkingDir = '';
const args = process.argv.slice(2).join(' ').trim();
const path = args && nodePath.resolve(args);
lastWorkingDir = path || false;
 
const lockfile = require('path').join(__dirname, 'web-code-' + port + '.lock');
lockFile.lock(lockfile, {}, function (err) {

	if (err) {

		const data = fs.readFileSync(lockfile, 'utf8').split('\n');

		data[1] = lastWorkingDir;

		if (lastWorkingDir) {
			// Update the lockfile with new working dir, tell the daemon
			fs.writeFileSync(lockfile, data.join('\n'));

			// Daemon
			execSync('kill -s 13 ' + data[0]);
		} else {

			// Process already exists so try to message to it.
			console.log('Web-code daemon is already running, with pid:', data[0], '!');
		}

		return;
	}

	fs.writeFileSync(lockfile, process.pid + '\n' + lastWorkingDir);

	app.use(express.static(__dirname + '/static', {
		maxAge: 3600 * 1000 * 24
	}));

	app.use(express.static(__dirname + '/node_modules/sw-toolbox', {
		maxAge: 3600 * 1000 * 24
	}));

	app.use('/vs/', express.static(__dirname + '/node_modules/monaco-editor/min/vs', {
		maxAge: 3600 * 1000 * 24
	}));

	app.use('/icons/', express.static(__dirname + '/node_modules/file-icons/fonts', {
		maxAge: 3600 * 1000 * 24
	}));

	app.use('/axe/', express.static(__dirname + '/node_modules/axe-core/', {
		maxAge: 3600 * 1000 * 24
	}));

	app.use('/contextmenu/', express.static(__dirname + '/node_modules/contextmenu/', {
		maxAge: 3600 * 1000 * 24
	}));

	app.use('/fira/', express.static(__dirname + '/node_modules/FiraCode/distr', {
		maxAge: 3600 * 1000 * 24
	}));

	app.use('/api/', api);

	function heartbeat() {
		this.isAlive = true;
	}

	setInterval(function ping() {
		wss.clients.forEach(function each(ws) {
			if (ws.isAlive === false) return ws.terminate();

			ws.isAlive = false;
			ws.ping('', false, true);
		});
	}, 5000);

	wss.on('connection', function connection(ws) {
		ws.on('message', wsMessaging.wsRouting);

		ws.webCodeClient = new Client();
		ws.webCodeClient.on('change', function fn(stats) {
			ws.send(JSON.stringify(['FS_CHANGE', null, stats.toDoc()]), e => e && console.log(e));
		});
		ws.webCodeClient.on('add', function fn(stats) {
			ws.send(JSON.stringify(['FS_ADD', null, stats.toDoc()]), e => e && console.log(e));
		});
		ws.webCodeClient.on('unlink', function fn(obj) {
			ws.send(JSON.stringify(['FS_UNLINK', null, obj]), e => e && console.log(e));
		});
		ws.webCodeClient.on('addDir', function fn(stats) {
			ws.send(JSON.stringify(['FS_ADD', null, stats.toDoc()]), e => e && console.log(e));
		});
		ws.webCodeClient.on('unlinkDir', function fn(obj) {
			ws.send(JSON.stringify(['FS_UNLINK', null, obj]), e => e && console.log(e));
		});

		ws.on('close', function close() {
			ws.webCodeClient.destroy();
			ws.webCodeClient = null;
			console.log('disconnected');
		});

		ws.isAlive = true;
		ws.on('pong', heartbeat);

		ws.send(wsMessaging.wsSendFormat('HANDSHAKE', {
			path: lastWorkingDir || false
		}));

	});

	server.on('request', app);
	server.listen(port, function () {
	/* eslint no-console: 0 */
		console.log('Web Code Server running with PID:', process.pid);
		console.log('Open up: http://127.0.0.1:' + server.address().port);

		// if an address is set to open then do otherwise just run the server
		if (lastWorkingDir) exec('termux-open-url http://127.0.0.1:' + server.address().port, puts);
	});

	function exit() {
		lockFile.unlockSync(lockfile);
	}

	process.on('SIGTERM', function() {
		process.exit();
	});

	process.on('SIGINT', function() {
		process.exit();
	});

	process.on('SIGPIPE', function() {
		const data = fs.readFileSync(lockfile, 'utf8').split('\n');
		lastWorkingDir = data[1];

		// Opening a new browser tab to that location.
		// STUB: Here we should see if the path is within an existing window
		// in that case open it.
		exec('termux-open-url http://127.0.0.1:' + server.address().port, puts);
	});

	process.on('exit', exit);
});
