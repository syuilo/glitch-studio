import * as msgpack from '@msgpack/msgpack';
import type { Asset, Player } from '@glitch/shared/types.js';
import type { VisualModule } from '@glitch/shared/visual-module/types.ts';
import type { Timeline } from '@glitch/shared/timeline/types.ts';

export type Project = {
	id: string;
	gsVersion: string;
	author: string;
	name: string;
	visualModules: VisualModule[];
	assets: Asset[];
	players: Player[];
	timeline: Timeline;
	resolution: { width: number; height: number; };
};

export function encodeProjectFile(project: any): Uint8Array {
	return msgpack.encode(project);
}

export function decodeProjectFile(bin: Uint8Array): Project {
	return msgpack.decode(bin) as Project;
}
