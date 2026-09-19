import * as msgpack from '@msgpack/msgpack';
import type { Asset, GsAutomation, Macro, NodeGraph, Player, Timeline } from '@glitch/shared/types.js';

export type Project = {
	id: string;
	gsVersion: string;
	author: string;
	name: string;
	nodeGraphs: NodeGraph[];
	macros: Macro[];
	automations: GsAutomation[];
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
