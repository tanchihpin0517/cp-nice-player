import { randomBytes } from 'crypto';

export interface AudioEntry {
	fsPath: string;
	registeredAt: number;
}

export class Registry {
	private readonly entries = new Map<string, AudioEntry>();

	registerAudio(fsPath: string): string {
		let audioId = randomBytes(4).toString('hex');
		while (this.entries.has(audioId)) {
			audioId = randomBytes(4).toString('hex');
		}

		this.entries.set(audioId, { fsPath, registeredAt: Date.now() });
		return audioId;
	}

	unregisterAudio(audioId: string): void {
		this.entries.delete(audioId);
	}

	resolveAudioId(audioId: string): string | undefined {
		return this.entries.get(audioId)?.fsPath;
	}

	clear(): void {
		this.entries.clear();
	}
}
