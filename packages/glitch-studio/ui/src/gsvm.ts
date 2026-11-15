import { isCustomShaderEffectReference } from '@gs/subsystems_effect_shared/custom-shader-effect.ts';
import { readFileSource } from '@gs/shared/file-source.ts';
import * as msgpack from '@msgpack/msgpack';
import semverGt from 'semver/functions/gt.js';
import { genId } from '@gs/shared/utility/id.ts';
import { collectVisualModuleResources, visitVisualModuleResourceReferences } from '@gs/glitch-studio_shared/visual-module-resources.ts';
import type { Asset, Player } from '@gs/shared/types.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { VisualModule } from '@gs/subsystems_visual-module_shared/types.ts';
import type { ProjectVisualModule } from '@gs/glitch-studio_shared/project/types.ts';
import type { ProjectAsset } from './Project.ts';

type EffectDefinitions = Readonly<Record<string, Pick<EffectDefinition, 'paramDefs' | 'staticSettingDefs'> & Partial<Pick<EffectDefinition, 'displayName'>>>>;

export type VisualModuleFile = {
	kind: 'glitch-studio-visual-module';
	formatVersion: 1;
	gsVersion: string;
	name: string;
	visualModule: VisualModule;
	assets: Asset[];
	players: Player[];
};

export type VisualModuleImport = {
	visualModule: ProjectVisualModule;
	assets: ProjectAsset[];
	players: Player[];
	unassignedPlayerNames: string[];
};

export function collectVisualModuleFile(input: {
	name: string; gsVersion: string; visualModule: VisualModule; assets: Asset[]; players: Player[];
}, definitions: EffectDefinitions): VisualModuleFile {
	// ProjectVisualModuleやインラインのレイヤーから渡されても、所属先のID・設定はファイルへ持ち込まない。
	for (const node of input.visualModule.nodes) {
		if (node.type === 'effect' && isCustomShaderEffectReference(node.effectId)) throw new Error(`Custom Shader Effect Node is not supported in Visual Module export: ${definitions[node.effectId]?.displayName ?? node.effectId}`);
	}
	return {
		kind: 'glitch-studio-visual-module',
		formatVersion: 1,
		gsVersion: input.gsVersion,
		name: input.name,
		...collectVisualModuleResources(input, definitions),
	};
}

export async function encodeVisualModuleFile(file: VisualModuleFile): Promise<Uint8Array> {
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

export function decodeVisualModuleFile(data: Uint8Array, currentVersion: string): VisualModuleFile {
	const file = msgpack.decode(data) as Omit<VisualModuleFile, 'assets'> & {
		assets: (Omit<Asset, 'fileData'> & { fileData: Uint8Array })[];
	};
	if (file?.kind !== 'glitch-studio-visual-module' || file.formatVersion !== 1
		|| typeof file.name !== 'string' || typeof file.gsVersion !== 'string'
		|| !Array.isArray(file.assets) || !Array.isArray(file.players)
		|| !Array.isArray(file.visualModule?.nodes) || !Array.isArray(file.visualModule.paramDefs)
		|| !Array.isArray(file.visualModule.outputDefs) || !Array.isArray(file.visualModule.automationGraphs)) {
		throw new Error('Unsupported Visual Module file.');
	}
	if (semverGt(file.gsVersion, currentVersion)) throw new Error(`This Visual Module requires a newer version of Glitch Studio (${file.gsVersion}).`);
	return {
		...file,
		assets: file.assets.map(asset => {
			if (!(asset.fileData instanceof Uint8Array)) throw new Error(`Invalid Asset data: ${asset.name}`);
			return { ...asset, fileData: new Blob([new Uint8Array(asset.fileData)], { type: asset.fileDataType }) };
		}),
	};
}

export function prepareVisualModuleImport(file: VisualModuleFile, definitions: EffectDefinitions, createId = genId): VisualModuleImport {
	// 読み込み成立に必要なエフェクト・素材・Playerの参照を、プロジェクトを変更する前に解決する。
	const collected = collectVisualModuleFile(file, definitions);
	const assetIds = new Map(collected.assets.map(asset => [asset.id, createId()]));
	const playerIds = new Map(collected.players.map(player => [player.id, createId()]));
	visitVisualModuleResourceReferences(collected.visualModule, definitions, (reference, replaceId) => {
		replaceId((reference.kind === 'asset' ? assetIds : playerIds).get(reference.id)!);
	});
	const unassignedPlayerNames: string[] = [];
	const players = collected.players.map(player => {
		const id = playerIds.get(player.id)!;
		if (player.sourceType === 'asset') return { ...player, id, assetId: player.assetId == null ? null : assetIds.get(player.assetId)! };
		// マイクやカメラは別PCで同じ入力を再現できず、自動起動も行わない。
		// Playerへの配線は新しいIDで維持し、取り込み後に入力だけを選び直せるようにする。
		if (player.sourceType != null) unassignedPlayerNames.push(player.name);
		return { id, name: player.name, sourceType: null };
	});
	return {
		visualModule: { ...collected.visualModule, id: createId(), name: collected.name },
		assets: collected.assets.map(asset => ({
			...asset,
			id: assetIds.get(asset.id)!,
			isExternalReference: false,
			sourceFilePath: null,
			thumbnailSequence: null,
		})),
		players,
		unassignedPlayerNames,
	};
}
