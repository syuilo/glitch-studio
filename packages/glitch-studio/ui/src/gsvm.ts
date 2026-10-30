import { validateParameterDefaultValues } from '@gs/shared/parameter/static-parameter.ts';
import { createStaticSettingValues, validateStaticSettings } from '@gs/shared/static-setting.ts';
import { readFileSource } from '@gs/shared/file-source.ts';
import * as msgpack from '@msgpack/msgpack';
import semverGt from 'semver/functions/gt.js';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { genId } from '@gs/shared/utility/id.ts';
import { getArrayElementDefinition, getStructFieldDefinitions } from '@gs/shared/parameter/parameter-definition.ts';
import { walkParameterLeaves } from '@gs/shared/parameter/parameter-tree.ts';
import { validatePlayerAudioSourceSelection } from '@gs/glitch-studio_shared/player-audio-source.ts';
import type { Asset, Player } from '@gs/shared/types.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { VisualModule, VisualModuleParameterBinding } from '@gs/subsystems_visual-module_shared/types.ts';
import type { ProjectVisualModule } from '@gs/glitch-studio_shared/project/types.ts';
import type { ProjectAsset } from './Project.ts';

type EffectDefinitions = Readonly<Record<string, Pick<EffectDefinition, 'paramDefs' | 'staticSettingDefs'>>>;

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

type ResourceReference = { kind: 'asset' | 'player'; id: string };

/** 静的設定の参照と、既存の静的な音声ルーティングだけを列挙する。 */
function visitResourceReferences(visualModule: VisualModule, definitions: EffectDefinitions,
	visit: (reference: ResourceReference, replaceId: (id: string) => void) => void) {
	const visitAudioBindings = (defs: Record<string, ParameterDefinition>, bindings: Record<string, VisualModuleParameterBinding>) => {
		for (const { def, param } of walkParameterLeaves<VisualModuleParameterBinding>(defs, bindings)) {
			if (def.dataType.kind !== 'audioSource' || param.inputSource === 'visualModuleCustomParameterReference') continue;
			if (param.inputSource !== 'literal') throw new Error('Audio sources must use a static input');
			validatePlayerAudioSourceSelection(param.value);
			if (param.value != null) visit({ kind: 'player', id: param.value.playerId }, id => { param.value = { type: 'player', playerId: id }; });
		}
	};
	for (const node of visualModule.nodes) {
		if (node.type !== 'effect') continue;
		const definition = definitions[node.effectId];
		if (definition == null) throw new Error(`Unknown effect: ${node.effectId}`);
		const settings = createStaticSettingValues(definition.staticSettingDefs ?? {}, node.staticSettings);
		validateStaticSettings(definition.staticSettingDefs ?? {}, settings);
		for (const [key, setting] of Object.entries(definition.staticSettingDefs ?? {})) {
			const value = settings[key];
			if (value == null) continue;
			if (setting.dataType.kind !== 'assetReference' && setting.dataType.kind !== 'playerReference') continue;
			visit({ kind: setting.dataType.kind === 'assetReference' ? 'asset' : 'player', id: value as string }, id => { settings[key] = id; });
		}
		node.staticSettings = settings;
		visitAudioBindings(definition.paramDefs, node.params);
	}
	const visitDefinition = (definition: ParameterDefinition) => {
		visitAudioBindings({ default: definition }, { default: definition.defaultValue });
		if (definition.dataType.kind === 'array') visitDefinition(getArrayElementDefinition(definition));
		else if (definition.dataType.kind === 'struct') for (const field of Object.values(getStructFieldDefinitions(definition))) visitDefinition(field);
	};
	for (const definition of visualModule.paramDefs) {
		validateParameterDefaultValues(definition);
		visitDefinition(definition);
	}
}

function indexResources<T extends { id: string }>(resources: T[]): Map<string, T> {
	const indexed = new Map(resources.map(resource => [resource.id, resource]));
	if (indexed.size !== resources.length) throw new Error('Duplicate resource IDs in the Visual Module file.');
	return indexed;
}

export function collectVisualModuleFile(input: {
	name: string; gsVersion: string; visualModule: VisualModule; assets: Asset[]; players: Player[];
}, definitions: EffectDefinitions): VisualModuleFile {
	// ProjectVisualModuleやインラインのレイヤーから渡されても、所属先のID・設定はファイルへ持ち込まない。
	const { nodes, paramDefs, outputDefs, primaryInputId, primaryOutputId, primaryAudioInputId, automationGraphs } = input.visualModule;
	const visualModule = deepClone({
		nodes,
		paramDefs,
		outputDefs,
		primaryInputId,
		primaryOutputId,
		primaryAudioInputId,
		automationGraphs,
	});
	const availableAssets = indexResources(input.assets);
	const availablePlayers = indexResources(input.players);
	const assets = new Map<string, Asset>();
	const players = new Map<string, Player>();
	const addAsset = (id: string) => {
		const asset = availableAssets.get(id);
		if (!asset) throw new Error(`Missing Asset: ${id}`);
		// 元ファイルの絶対パスなど、取り込み元PC固有の情報は同梱しない。
		const { name, width, height, fileDataType, fileData, hash } = asset;
		assets.set(id, {
			id,
			name,
			width,
			height,
			fileDataType,
			fileData,
			...(hash == null ? {} : { hash }),
		});
	};
	visitResourceReferences(visualModule, definitions, reference => {
		if (reference.kind === 'asset') { addAsset(reference.id); return; }
		const player = availablePlayers.get(reference.id);
		if (!player) throw new Error(`Missing Player: ${reference.id}`);
		players.set(player.id, {
			id: player.id,
			name: player.name,
			sourceType: player.sourceType,
			...(player.sourceType === 'asset' ? { assetId: player.assetId } : {}),
		});
		if (player.sourceType === 'asset' && player.assetId != null) addAsset(player.assetId);
	});
	return {
		kind: 'glitch-studio-visual-module',
		formatVersion: 1,
		gsVersion: input.gsVersion,
		name: input.name,
		visualModule,
		assets: [...assets.values()],
		players: [...players.values()],
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
	visitResourceReferences(collected.visualModule, definitions, (reference, replaceId) => {
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
