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

// BlobはMessagePackで直接保存できないため、フォントを含む素材の原本をバイト列にする。
type StoredProject = Omit<Project, 'assets'> & {
	assets: (Omit<Asset, 'fileData'> & { fileData: Uint8Array })[];
};

export async function encodeProjectFile(project: Project): Promise<Uint8Array> {
	const assets = await Promise.all(project.assets.map(async asset => ({
		...asset,
		fileData: new Uint8Array(await asset.fileData.arrayBuffer()),
	})));
	return msgpack.encode({ ...project, assets } satisfies StoredProject);
}

export function decodeProjectFile(bin: Uint8Array): Project {
	const project = msgpack.decode(bin) as StoredProject;
	return {
		...project,
		assets: project.assets.map(asset => ({
			...asset,
			fileData: new Blob([new Uint8Array(asset.fileData)], { type: asset.fileDataType }),
		})),
	};
}
