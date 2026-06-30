const path = require('path');

function uriFromPath(fsPath) {
	return { fsPath };
}

const workspace = {
	getConfiguration() {
		return {
			get(_key, defaultValue) {
				return defaultValue;
			},
		};
	},
};

const window = {
	showInformationMessage() {
		return Promise.resolve(undefined);
	},
	showErrorMessage() {
		return Promise.resolve(undefined);
	},
};

const Uri = {
	joinPath(base, ...segments) {
		const joined = path.join(base.fsPath, ...segments.map((segment) => String(segment)));
		return uriFromPath(joined);
	},
	parse(value) {
		return uriFromPath(String(value).replace(/^file:\/\//, ''));
	},
	file(fsPath) {
		return uriFromPath(fsPath);
	},
};

const env = {
	asExternalUri(uri) {
		return Promise.resolve(uri);
	},
};

module.exports = {
	workspace,
	window,
	Uri,
	env,
};
