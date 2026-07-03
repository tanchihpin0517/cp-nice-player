import * as vscode from 'vscode';

export function createMockExtensionContext(): vscode.ExtensionContext {
	const globalStateStore = new Map<string, unknown>();

	return {
		globalState: {
			get: <T>(key: string, defaultValue?: T): T | undefined => {
				if (globalStateStore.has(key)) {
					return globalStateStore.get(key) as T;
				}
				return defaultValue;
			},
			update: async (key: string, value: unknown): Promise<void> => {
				if (value === undefined) {
					globalStateStore.delete(key);
					return;
				}
				globalStateStore.set(key, value);
			},
			keys: () => [...globalStateStore.keys()],
		},
	} as unknown as vscode.ExtensionContext;
}
