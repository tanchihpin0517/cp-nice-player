const Module = require('module');
const stub = require('./vscode-stub.js');

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
	if (request === 'vscode') {
		return stub;
	}
	return originalLoad.call(this, request, parent, isMain);
};
