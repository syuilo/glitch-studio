import { readFileSource } from '@gs/shared/file-source.ts';
import * as msgpack from '@msgpack/msgpack';
import semverGt from 'semver/functions/gt.js';
import { genId } from '@gs/shared/utility/id.ts';
import { collectNodesEffectResources } from '@gs/glitch-studio_shared/nodes-effect-resources.ts';
import type { NodesEffectResources } from '@gs/glitch-studio_shared/nodes-effect-resources.ts';
import type { Asset } from '@gs/shared/types.ts';
import type { NativeEffectDefinitions } from '@gs/glitch-studio_shared/project/effects.ts';
import type { ProjectEffectRegistrations, ProjectNodesEffect } from '@gs/glitch-studio_shared/project/types.ts';
import type { ProjectAsset } from './Project.ts';

export type NodesEffectFile = NodesEffectResources & {
	kind: 'glitch-studio-nodes-effect';
	formatVersion: 2;
	gsVersion: string;
	name: string;
};

export type NodesEffectImport = ProjectEffectRegistrations & {
	nodesEffect: ProjectNodesEffect;
	assets: ProjectAsset[];
};

/** 定義とノードの編集情報を持ち出す。登録IDやレイヤーの設定は所属プロジェクトに残す。 */
export function collectNodesEffectFile(input: NodesEffectResources & { name: string; gsVersion: string }, definitions: NativeEffectDefinitions): NodesEffectFile {
	return {
		kind: 'glitch-studio-nodes-effect',
		formatVersion: 2,
		gsVersion: input.gsVersion,
		name: input.name,
		...collectNodesEffectResources(input, definitions),
	};
}

export async function encodeNodesEffectFile(file: NodesEffectFile): Promise<Uint8Array> {
	const assets = await Promise.all(file.assets.map(async asset => {
		try {
			const { id, name, width, height, fileDataType, hash } = asset;
			return {
				id,
				name,
				width,
				height,
				fileDataType,
				...(hash == null ? {} : { hash }),
				fileData: new Uint8Array(await (await readFileSource(asset.fileData)).arrayBuffer()),
			};
		} catch (cause) {
			throw new Error(`Could not read Asset "${asset.name}". Replace it with the source file and try exporting again.`, { cause });
		}
	}));
	return msgpack.encode({ ...file, assets });
}

export function decodeNodesEffectFile(data: Uint8Array, currentVersion: string): NodesEffectFile {
	const file = msgpack.decode(data) as Omit<NodesEffectFile, 'assets'> & {
		assets: (Omit<Asset, 'fileData'> & { fileData: Uint8Array })[];
	};
	if (file?.kind !== 'glitch-studio-nodes-effect' || file.formatVersion !== 2
		|| typeof file.name !== 'string' || typeof file.gsVersion !== 'string'
		|| !Array.isArray(file.assets)
		|| !Array.isArray(file.nodesEffect?.nodes) || file.nodesEffect.paramDefs == null
		|| file.nodesEffect.outputDefs == null || file.nodesEffect.outputSources == null
		|| !Array.isArray(file.nodesEffects) || !Array.isArray(file.customShaderEffects)) {
		throw new Error('Unsupported Nodes Effect file.');
	}
	if (semverGt(file.gsVersion, currentVersion)) throw new Error(`This Nodes Effect requires a newer version of Glitch Studio (${file.gsVersion}).`);
	return {
		...file,
		assets: file.assets.map(asset => {
			if (!(asset.fileData instanceof Uint8Array)) throw new Error(`Invalid Asset data: ${asset.name}`);
			return { ...asset, fileData: new Blob([new Uint8Array(asset.fileData)], { type: asset.fileDataType }) };
		}),
	};
}

export function prepareNodesEffectImport(file: NodesEffectFile, definitions: NativeEffectDefinitions, createId = genId): NodesEffectImport {
	// 読み込み成立に必要なエフェクト・素材の参照を、プロジェクトを変更する前に解決する。
	const collected = collectNodesEffectResources(file, definitions, () => createId());
	return {
		nodesEffect: { id: createId(), name: file.name, definition: collected.nodesEffect, nodeMetadata: collected.nodeMetadata },
		nodesEffects: collected.nodesEffects,
		customShaderEffects: collected.customShaderEffects,
		assets: collected.assets.map(asset => ({ ...asset, isExternalReference: false, sourceFilePath: null, thumbnailSequence: null })),
	};
}
