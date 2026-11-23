import { readFileSource } from '@gs/shared/file-source.ts';
import * as msgpack from '@msgpack/msgpack';
import semverGt from 'semver/functions/gt.js';
import { genId } from '@gs/shared/utility/id.ts';
import { collectCustomNodeGraphEffectResources } from '@gs/glitch-studio_shared/custom-node-graph-effect-resources.ts';
import type { CustomNodeGraphEffectResources } from '@gs/glitch-studio_shared/custom-node-graph-effect-resources.ts';
import type { Asset } from '@gs/shared/types.ts';
import type { NativeEffectDefinitions } from '@gs/glitch-studio_shared/project/effects.ts';
import type { ProjectEffectRegistrations, ProjectCustomNodeGraphEffect } from '@gs/glitch-studio_shared/project/types.ts';
import type { ProjectAsset } from './Project.ts';

export type CustomNodeGraphEffectFile = CustomNodeGraphEffectResources & {
	kind: 'glitch-studio-custom-node-graph-effect';
	formatVersion: 2;
	gsVersion: string;
	name: string;
};

export type CustomNodeGraphEffectImport = ProjectEffectRegistrations & {
	customNodeGraphEffect: ProjectCustomNodeGraphEffect;
	assets: ProjectAsset[];
};

/** 定義とノードの編集情報を持ち出す。登録IDやレイヤーの設定は所属プロジェクトに残す。 */
export function collectCustomNodeGraphEffectFile(input: CustomNodeGraphEffectResources & { name: string; gsVersion: string }, definitions: NativeEffectDefinitions): CustomNodeGraphEffectFile {
	return {
		kind: 'glitch-studio-custom-node-graph-effect',
		formatVersion: 2,
		gsVersion: input.gsVersion,
		name: input.name,
		...collectCustomNodeGraphEffectResources(input, definitions),
	};
}

export async function encodeCustomNodeGraphEffectFile(file: CustomNodeGraphEffectFile): Promise<Uint8Array> {
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

export function decodeCustomNodeGraphEffectFile(data: Uint8Array, currentVersion: string): CustomNodeGraphEffectFile {
	const file = msgpack.decode(data) as Omit<CustomNodeGraphEffectFile, 'assets'> & {
		assets: (Omit<Asset, 'fileData'> & { fileData: Uint8Array })[];
	};
	if (file?.kind !== 'glitch-studio-custom-node-graph-effect' || file.formatVersion !== 2
		|| typeof file.name !== 'string' || typeof file.gsVersion !== 'string'
		|| !Array.isArray(file.assets)
		|| !Array.isArray(file.customNodeGraphEffect?.nodes) || file.customNodeGraphEffect.paramDefs == null
		|| file.customNodeGraphEffect.outputDefs == null || file.customNodeGraphEffect.outputSources == null
		|| !Array.isArray(file.customNodeGraphEffects) || !Array.isArray(file.customShaderEffects)) {
		throw new Error('Unsupported Custom Node Graph Effect file.');
	}
	if (semverGt(file.gsVersion, currentVersion)) throw new Error(`This Custom Node Graph Effect requires a newer version of Glitch Studio (${file.gsVersion}).`);
	return {
		...file,
		assets: file.assets.map(asset => {
			if (!(asset.fileData instanceof Uint8Array)) throw new Error(`Invalid Asset data: ${asset.name}`);
			return { ...asset, fileData: new Blob([new Uint8Array(asset.fileData)], { type: asset.fileDataType }) };
		}),
	};
}

export function prepareCustomNodeGraphEffectImport(file: CustomNodeGraphEffectFile, definitions: NativeEffectDefinitions, createId = genId): CustomNodeGraphEffectImport {
	// 読み込み成立に必要なエフェクト・素材の参照を、プロジェクトを変更する前に解決する。
	const collected = collectCustomNodeGraphEffectResources(file, definitions, () => createId());
	return {
		customNodeGraphEffect: { id: createId(), name: file.name, definition: collected.customNodeGraphEffect, nodeMetadata: collected.nodeMetadata },
		customNodeGraphEffects: collected.customNodeGraphEffects,
		customShaderEffects: collected.customShaderEffects,
		assets: collected.assets.map(asset => ({ ...asset, isExternalReference: false, sourceFilePath: null, thumbnailSequence: null })),
	};
}
