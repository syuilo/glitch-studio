import { getScene, getLayerParameterValues } from './utility/timeline-scene.ts';
import { canReferenceScene, getSceneDuration, validateTimelineScenes } from '@glitch/shared/timeline/scenes.ts';
import { createUntrimmedTimelineLayerTiming, isTimelineLayerTimingValid } from '@glitch/shared/timeline/timing.ts';
import type { TimelineLayerTiming } from '@glitch/shared/timeline/timing.ts';
import { getArrayElementDefinition, isParameterType } from '@glitch/shared/parameter.ts';
import { visualModuleCustomParameterId } from '@glitch/shared/visual-module/types.ts';
import { effectDefinitions } from '@glitch/shared/effect/effect-definitions.ts';
import { AiSON } from '@syuilo/aiscript';
import { deepClone } from '@glitch/shared/utility/deep-clone.ts';
import { getNodeInputDataType, getNodeOutputs } from '@glitch/shared/utility/node-outputs.ts';
import { isTextureDataType } from '@glitch/shared/data-type.ts';
import { timelineAudioParamDefs } from '@glitch/shared/timeline/timeline-audio.ts';
import type { TimelineScene, TimelineSceneLayer, TimelineAudioLayer, TimelineVideoLayer, TimelineLayer, TimelineInlineVisualModuleLayer } from '@glitch/shared/timeline/types.ts';
import { timelineCompositingParamDefs } from '@glitch/shared/timeline/timeline-compositing.ts';
import type { VisualModuleCustomParameterId, VisualModuleEffectNode, VisualModuleNode, NodeOutputReference, VisualModule, VisualModuleParamDef, VisualModuleOutputDef } from '@glitch/shared/visual-module/types.ts';
import type { ParameterDefinition } from '@glitch/shared/parameter.ts';
import type { AppState } from './types.ts';
import type { Asset, AutomationGraphPlaybackOptions, ParameterBinding, Player } from '@glitch/shared/types.ts';
import type { NodeParamTarget as EffectNodeParamTarget } from '@/utility/node-params.ts';
import type { GlobalEnvVariable } from '@glitch/shared/expression.js';
import { canConnectNodeDataTypes } from '@/utility/node-outputs.ts';
import { resolveNodeParam, walkNodeParams } from '@/utility/node-params.ts';
import { createInlineAutomationGraph } from '@/utility/automation-graph.ts';
import { createInlineKeyframesTimeline } from '@/utility/keyframes-timeline.ts';
import { getVisualModule, listVisualModules } from '@/utility/visual-module-target.ts';
import type { VisualModuleTarget } from '@/utility/visual-module-target.ts';
import type { TimelineKeyframeSelection } from '@/utility/timeline-selection.ts';

export type CommandDef<Payload> = {
	label: string;
	create: (payload: Payload) => {
		execute(state: AppState): void;
		undo(state: AppState): void;
	};
};

function defineCommand<Payload>(def: CommandDef<Payload>) {
	return def;
}

type NodeTarget = VisualModuleTarget & { nodeId: string };
type NodeParamTarget = EffectNodeParamTarget & VisualModuleTarget;

const stateUtility = {
	getVisualModule,
	findNode: (state: AppState, target: NodeTarget): VisualModuleNode | undefined => {
		return getVisualModule(state, target).nodes.find(node => node.id === target.nodeId);
	},
};

const editTimelineLayerParamCommandDef = defineCommand<{
	sceneId: string;
	layerId: string;
	paramId: string;
	target?: 'module' | 'compositing' | 'audio';
	edit:
		| { kind: 'literal'; value: any }
		| { kind: 'automationGraphInline'; value: Extract<ParameterBinding, { inputSource: 'automationGraphInline' }> }
		| { kind: 'keyframesTimelineInline'; value: Extract<ParameterBinding, { inputSource: 'keyframesTimelineInline' }> }
		| { kind: 'envVariable' | 'expression'; value: string }
		| { kind: 'automationGraphReference'; value: string | null; options?: Partial<AutomationGraphPlaybackOptions> }
		| { kind: 'inputSource'; inputSource: ParameterBinding['inputSource'] }
		| { kind: 'reset' };
}>({
	label: 'Edit timeline layer param',
	create: payload => {
		let before: ParameterBinding | undefined;
		let after: ParameterBinding | undefined;
		const getLayer = (state: AppState) => {
			const layer = getScene(state, payload.sceneId).layers.find(layer => layer.id === payload.layerId);
			if (layer == null) throw new Error('Timeline layer not found');
			if (layer.layerType !== 'visualModule' && layer.layerType !== 'inlineVisualModule' && layer.layerType !== 'audio' && layer.layerType !== 'scene' && layer.layerType !== 'video') throw new Error('Unsupported timeline layer');
			getLayerParameterValues(layer, payload.target ?? 'module');
			return layer;
		};
		return {
			execute(state) {
				const layer = getLayer(state);
				const values: Record<string, ParameterBinding> = getLayerParameterValues(layer, payload.target ?? 'module');
				if (after === undefined) {
					const module = (layer.layerType === 'visualModule' || layer.layerType === 'inlineVisualModule') && payload.target !== 'compositing'
						? (layer.layerType === 'inlineVisualModule' ? layer.visualModule : stateUtility.getVisualModule(state, layer))
						: null;
					const def = payload.target === 'audio'
						? Object.entries(timelineAudioParamDefs).find(([id]) => id === payload.paramId)?.[1]
						: payload.target === 'compositing'
						? Object.entries(timelineCompositingParamDefs).find(([id]) => id === payload.paramId)?.[1]
						: module?.paramDefs.find(def => def.id === payload.paramId);
					if (def == null || module?.primaryInputId === payload.paramId) throw new Error('Editable visual module parameter not found');
					before = deepClone(values[payload.paramId]);
					const current = before ?? def.defaultValue;
					const edit = payload.edit;
					switch (edit.kind) {
						case 'literal': after = { inputSource: 'literal', value: deepClone(edit.value) }; break;
						case 'automationGraphInline': after = deepClone(edit.value); break;
						case 'keyframesTimelineInline': after = deepClone(edit.value); break;
						case 'envVariable': after = { inputSource: 'envVariable', variable: edit.value as GlobalEnvVariable }; break;
						case 'expression': after = { inputSource: 'expression', expression: edit.value }; break;
						case 'automationGraphReference': after = {
							inputSource: 'automationGraphReference',
							trimmedDurationMs: 1000,
							wrapMode: 'repeat',
							offsetMode: 'start',
							...(current.inputSource === 'automationGraphReference' ? current : {}),
							automationGraphId: edit.value,
							...edit.options,
						}; break;
						case 'reset': after = deepClone(def.defaultValue); break;
						case 'inputSource':
							switch (edit.inputSource) {
								case 'literal': after = deepClone(def.defaultValue); break;
								case 'envVariable': after = { inputSource: 'envVariable', variable: '' }; break;
								case 'expression': after = {
									inputSource: 'expression', expression: AiSON.stringify(current.inputSource === 'literal' ? current.value : def.defaultValue.value),
								}; break;
								case 'automationGraphReference': after = { inputSource: 'automationGraphReference', automationGraphId: null, trimmedDurationMs: 1000, wrapMode: 'repeat', offsetMode: 'start' }; break;
								case 'automationGraphInline': after = createInlineAutomationGraph(); break;
								case 'keyframesTimelineInline':
									if (def.dataType.kind !== 'scalar' && def.dataType.kind !== 'vector' && def.dataType.kind !== 'color') throw new Error('Parameter does not support keyframes');
									after = createInlineKeyframesTimeline(def.dataType);
									break;
								case 'node':
								case 'externalCustomParameterInput': throw new Error('Unsupported layer parameter input source');
							}
							break;
					}
				}
				values[payload.paramId] = deepClone(after);
			},
			undo(state) {
				const layer = getLayer(state);
				const values: Record<string, ParameterBinding> = getLayerParameterValues(layer, payload.target ?? 'module');
				// デフォルト値を参照していた状態も復元し、定義への不要な上書きを残さない。
				if (before === undefined) delete values[payload.paramId];
				else values[payload.paramId] = deepClone(before);
			},
		};
	},
});

const addEffectNodeCommandDef = defineCommand<VisualModuleTarget & { id: string; effectId: string; params?: Record<string, ParameterBinding> }>({
	label: 'Add fx node',
	create: payload => {
		let addedNode: VisualModuleEffectNode | undefined;
		let outputConnection: {
			nodeId: string;
			outputId: string;
			before: { nodeId: string; outputPort: string } | { nodeId: null; outputPort: null } | undefined;
			after: { nodeId: string; outputPort: string };
		} | undefined;
		return {
			execute(state) {
				const visualModule = stateUtility.getVisualModule(state, payload);
				if (addedNode == null) {
					const paramDefs = effectDefinitions[payload.effectId].paramDefs as Record<string, ParameterDefinition>;
					const globalOut = visualModule.nodes.find(node => node.type === 'globalOut');
					const primaryOutput = visualModule.outputDefs.find(def => def.id === visualModule.primaryOutputId);
					const previousInput = primaryOutput == null ? undefined : globalOut?.inputs[primaryOutput.id];
					const previous = previousInput?.nodeId == null ? undefined : visualModule.nodes.find(node => node.id === previousInput.nodeId);
					const params: VisualModuleEffectNode['params'] = {};
					for (const [key, def] of Object.entries(paramDefs)) {
						params[key] = deepClone(def.defaultValue);
						if (key === effectDefinitions[payload.effectId].primaryInputParameter && previousInput?.nodeId != null) {
							// 元の接続が副出力でも、その出力ポートをそのまま引き継ぐ。
							const output = getNodeOutputs(previous, visualModule.paramDefs)[previousInput.outputPort];
							if (canConnectNodeDataTypes(output?.dataType, getNodeInputDataType(def))) {
								params[key] = { inputSource: 'node', ...deepClone(previousInput), fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' };
							}
						}
					}
					// ランダムな初期値や自動接続もRedo時に変えない。
					addedNode = { id: payload.id, type: 'effect', effectId: payload.effectId, isBypass: false, resolution: { mode: 'auto' },
																			params: { ...params, ...deepClone(payload.params ?? {}) }, pos: { x: 0, y: 0 } };
					const primaryPort = effectDefinitions[payload.effectId].primaryOutput;
					const outputPort = primaryPort != null && canConnectNodeDataTypes(effectDefinitions[payload.effectId].outputDefs[primaryPort].dataType, { kind: 'color' }) ? primaryPort : null;
					if (globalOut != null && primaryOutput != null && outputPort != null) {
						outputConnection = {
							nodeId: globalOut.id,
							outputId: primaryOutput.id,
							before: deepClone(previousInput),
							after: { nodeId: addedNode.id, outputPort },
						};
					}
				}
				const outputIndex = visualModule.nodes.findIndex(node => node.type === 'globalOut');
				visualModule.nodes.splice(outputIndex < 0 ? visualModule.nodes.length : outputIndex, 0, deepClone(addedNode));
				if (outputConnection != null) {
					const connection = outputConnection;
					const globalOut = visualModule.nodes.find(node => node.id === connection.nodeId);
					if (globalOut?.type === 'globalOut') globalOut.inputs[outputConnection.outputId] = deepClone(outputConnection.after);
				}
			},
			undo(state) {
				const visualModule = stateUtility.getVisualModule(state, payload);
				visualModule.nodes = visualModule.nodes.filter(node => node.id !== payload.id);
				if (outputConnection != null) {
					const connection = outputConnection;
					const globalOut = visualModule.nodes.find(node => node.id === connection.nodeId);
					if (globalOut?.type === 'globalOut') {
						if (outputConnection.before == null) delete globalOut.inputs[outputConnection.outputId];
						else globalOut.inputs[outputConnection.outputId] = deepClone(outputConnection.before);
					}
				}
			},
		};
	},
});

const moveNodeCommandDef = defineCommand<NodeTarget & { index: number }>({
	label: 'Move node',
	create: payload => {
		let before: number;
		const move = (state: AppState, index: number) => {
			const nodes = stateUtility.getVisualModule(state, payload).nodes;
			const source = nodes.findIndex(node => node.id === payload.nodeId);
			if (source < 0) throw new Error('Node not found');
			if (!Number.isInteger(index) || index < 0 || index >= nodes.length) throw new Error('Invalid node index');
			if (nodes[source].type !== 'effect') throw new Error('In/Out nodes cannot be moved');
			const min = nodes[0]?.type === 'globalIn' ? 1 : 0;
			const max = nodes.at(-1)?.type === 'globalOut' ? nodes.length - 2 : nodes.length - 1;
			index = Math.max(min, Math.min(max, index));
			const [node] = nodes.splice(source, 1);
			nodes.splice(index, 0, node);
			return source;
		};
		return {
			execute(state) { before = move(state, payload.index); },
			undo(state) { move(state, before); },
		};
	},
});

const removeNodeCommandDef = defineCommand<NodeTarget>({
	label: 'Remove node',
	create: payload => {
		let before: VisualModuleNode[];
		return {
			execute(state) {
				const visualModule = stateUtility.getVisualModule(state, payload);
				before = deepClone(visualModule.nodes);
				const removedNode = stateUtility.findNode(state, payload);
				if (removedNode == null) return;
				if (removedNode.type !== 'effect') throw new Error('In/Out nodes cannot be removed');
				const primary = effectDefinitions[removedNode.effectId].primaryInputParameter;
				const input = primary === null ? undefined : removedNode.params[primary];
				const replacement: Pick<NodeOutputReference, 'nodeId' | 'outputPort'> | null = input?.inputSource === 'node' && input.nodeId != null && input.nodeId !== payload.nodeId
					? { nodeId: input.nodeId, outputPort: input.outputPort } : null;
				const replacementOutput = replacement == null ? undefined : getNodeOutputs(visualModule.nodes.find(node => node.id === replacement.nodeId), visualModule.paramDefs)[replacement.outputPort];
				// 削除したノードの主入力へ接続し直す。globalOutの参照も同じ操作で復元可能にする。
				for (const node of visualModule.nodes) {
					if (node.id === payload.nodeId) continue;
					if (node.type === 'globalOut') {
						for (const [id, input] of Object.entries(node.inputs)) {
							if (input.nodeId !== payload.nodeId) continue;
							const def = visualModule.outputDefs.find(def => def.id === id);
							node.inputs[id] = replacement != null && canConnectNodeDataTypes(replacementOutput?.dataType, def?.dataType ?? null)
								? deepClone(replacement) : { nodeId: null, outputPort: null };
						}
						continue;
					}
					if (node.type !== 'effect') continue;
					for (const { path, def, value } of walkNodeParams(node)) {
						if (!def.canNode || value.inputSource !== 'node' || value.nodeId !== payload.nodeId) continue;
						const compatible = replacement != null && canConnectNodeDataTypes(replacementOutput?.dataType, getNodeInputDataType(def));
						// サンプリング設定は受け取り側の入力に属するため、削除後も維持して配線元だけを置き換える。
						resolveNodeParam(node, path).setValue(compatible
							? { ...deepClone(value), ...deepClone(replacement) }
							: { inputSource: 'node', nodeId: null, outputPort: null });
					}
				}
				visualModule.nodes = visualModule.nodes.filter(node => node.id !== payload.nodeId);
			},
			undo(state) {
				stateUtility.getVisualModule(state, payload).nodes = deepClone(before);
			},
		};
	},
});

const addAssetCommandDef = defineCommand<Asset>({
	label: 'Add asset',
	create: (payload) => {
		return {
			execute(state) {
				state.assets.value.push({
					id: payload.id,
					name: payload.name,
					width: payload.width,
					height: payload.height,
					fileDataType: payload.fileDataType,
					fileData: payload.fileData, // blobはimmutableなので多分deepCloneの必要なし
					hash: payload.hash,
				});
			},
			undo(state) {
				state.assets.value = state.assets.value.filter(asset => asset.id !== payload.id);
			},
		};
	},
});

const removeAssetCommandDef = defineCommand<{ assetId: string }>({
	label: 'Remove asset',
	create: payload => {
		let before: {
			assets: Asset[];
			visualModules: { target: VisualModuleTarget; nodes: VisualModuleNode[] }[];
		};
		return {
			execute(state) {
				before = {
					assets: deepClone(state.assets.value),
					visualModules: listVisualModules(state).map(({ target, visualModule }) => ({ target, nodes: deepClone(visualModule.nodes) })),
				};
				state.assets.value = state.assets.value.filter(asset => asset.id !== payload.assetId);
				// Assetはプロジェクト共有なので、全VisualModuleの参照を解除する。
				for (const { visualModule } of listVisualModules(state)) {
					for (const node of visualModule.nodes) {
						if (node.type !== 'effect') continue;
						for (const { path, def, value } of walkNodeParams(node)) {
							if ((def.dataType.kind === 'assetReference' || def.dataType.kind === 'videoAssetReference' || def.dataType.kind === 'fontAssetReference') && value.inputSource === 'literal' && value.value === payload.assetId) {
								resolveNodeParam(node, path).setValue({ inputSource: 'literal', value: null });
							}
						}
					}
				}
			},
			undo(state) {
				state.assets.value = deepClone(before.assets);
				for (const visualModule of before.visualModules) {
					stateUtility.getVisualModule(state, visualModule.target).nodes = deepClone(visualModule.nodes);
				}
			},
		};
	},
});

const renameAssetCommandDef = defineCommand<{ assetId: string; name: string }>({
	label: 'Rename asset',
	create: (payload) => {
		return {
			execute(state) {
				const asset = state.assets.value.find(asset => asset.id === payload.assetId)!;
				asset.name = payload.name;
			},
			undo(state) {
				// TODO
			},
		};
	},
});

const replaceAssetCommandDef = defineCommand<Asset & { assetId: string }>({
	label: 'Replace asset',
	create: (payload) => {
		return {
			execute(state) {
				const asset = state.assets.value.find(asset => asset.id === payload.assetId)!;
				asset.width = payload.width;
				asset.height = payload.height;
				asset.fileDataType = payload.fileDataType;
				asset.fileData = payload.fileData; // blobはimmutableなので多分deepCloneの必要なし
				asset.hash = payload.hash;
			},
			undo(state) {
				// TODO
			},
		};
	},
});

const addPlayerCommandDef = defineCommand<Player>({
	label: 'Add player',
	create: (payload) => {
		return {
			execute(state) {
				state.players.value.push(payload);
			},
			undo(state) {
				state.players.value = state.players.value.filter(player => player.id !== payload.id);
			},
		};
	},
});

const updatePlayerSourceTypeCommandDef = defineCommand<{ playerId: Player['id']; sourceType: Player['sourceType'] }>({
	label: 'Update player sourceType',
	create: (payload) => {
		let previousType: Player['sourceType'];
		return {
			execute(state) {
				const player = state.players.value.find(player => player.id === payload.playerId)!;
				previousType = player.sourceType;
				player.sourceType = payload.sourceType;
			},
			undo(state) {
				const player = state.players.value.find(player => player.id === payload.playerId)!;
				player.sourceType = previousType;
			},
		};
	},
});

// 対象は実行・Undoのたびに解決する。配列の置換やUndo後の古い参照を保持しない。
function defineNodeParamCommand<Payload extends NodeParamTarget>(
	label: string,
	update: (target: ReturnType<typeof resolveNodeParam>, payload: Payload) => ParameterBinding,
) {
	return defineCommand<Payload>({
		label,
		create: payload => {
			let before: ParameterBinding;
			let after: ParameterBinding | undefined;
			return {
				execute(state) {
					const node = stateUtility.findNode(state, payload);
					if (node?.type !== 'effect') throw new Error('Effect node not found');
					const target = resolveNodeParam(node, payload.paramPath);
					if (after === undefined) {
						before = deepClone(target.value);
						// default()が乱数を使っていてもRedoでは同じ値に戻す。
						after = deepClone(update(target, payload));
					}
					target.setValue(deepClone(after));
				},
				undo(state) {
					const node = stateUtility.findNode(state, payload);
					if (node?.type !== 'effect') throw new Error('Effect node not found');
					resolveNodeParam(node, payload.paramPath).setValue(deepClone(before));
				},
			};
		},
	});
}

function assertLeafParam(target: ReturnType<typeof resolveNodeParam>) {
	if (target.def.dataType.kind === 'array' || target.def.dataType.kind === 'struct') {
		throw new Error('Struct and array containers cannot change value type');
	}
}

// TODO: 別のtypeの設定値を失わない(内部的には持ったまま)ようにする
const changeParamValueInputSourceCommandDef = defineNodeParamCommand<NodeParamTarget & { inputSource: ParameterBinding['inputSource'] }>(
	'Change param value type',
	(target, payload) => {
		assertLeafParam(target);
		const currentValue = target.value;
		const defaultValue = deepClone(target.def.defaultValue);
		switch (payload.inputSource) {
			case 'expression': return {
				inputSource: 'expression',
				expression: AiSON.stringify(currentValue.inputSource === 'literal' ? currentValue.value : defaultValue.value),
			};
			case 'envVariable': return { inputSource: 'envVariable', variable: '' };
			case 'literal': return { inputSource: 'literal', value: defaultValue.value };
			case 'automationGraphReference': return { inputSource: 'automationGraphReference', automationGraphId: null, trimmedDurationMs: 1000, wrapMode: 'repeat', offsetMode: 'start' };
			case 'automationGraphInline': return createInlineAutomationGraph();
			case 'keyframesTimelineInline':
				if (target.def.dataType.kind !== 'scalar' && target.def.dataType.kind !== 'vector' && target.def.dataType.kind !== 'color') throw new Error('Parameter does not support keyframes');
				return createInlineKeyframesTimeline(target.def.dataType);
			case 'externalCustomParameterInput': return { inputSource: 'externalCustomParameterInput', parameterId: visualModuleCustomParameterId('') };
			case 'node': {
				if (!('canNode' in target.def) || !target.def.canNode) throw new Error('Parameter does not support node input');
				return { inputSource: 'node', nodeId: null, outputPort: null };
			}
		}
	},
);

const updateParamAsLiteralCommandDef = defineNodeParamCommand<NodeParamTarget & { value: any }>(
	'Update param as literal',
	(target, payload) => {
		assertLeafParam(target);
		return { inputSource: 'literal', value: payload.value };
	},
);

const updateParamAsEnvVariableCommandDef = defineNodeParamCommand<NodeParamTarget & { value: GlobalEnvVariable }>(
	'Update param as environment variable',
	(target, payload) => {
		assertLeafParam(target);
		return { inputSource: 'envVariable', variable: payload.value };
	},
);

const updateParamAsExpressionCommandDef = defineNodeParamCommand<NodeParamTarget & { value: string }>(
	'Update param as expression',
	(target, payload) => {
		assertLeafParam(target);
		return { inputSource: 'expression', expression: payload.value };
	},
);

const updateParamAsAutomationGraphReferenceCommandDef = defineNodeParamCommand<NodeParamTarget & { value: string | null; options?: Partial<AutomationGraphPlaybackOptions> }>(
	'Update param as automationGraphReference',
	(target, payload) => {
		assertLeafParam(target);
		return {
			inputSource: 'automationGraphReference',
			trimmedDurationMs: 1000,
			wrapMode: 'repeat',
			offsetMode: 'start',
			...(target.value.inputSource === 'automationGraphReference' ? target.value : {}), automationGraphId: payload.value,
			...payload.options,
		};
	},
);

const updateParamAsAutomationGraphInlineCommandDef = defineNodeParamCommand<NodeParamTarget & { value: Extract<ParameterBinding, { inputSource: 'automationGraphInline' }> }>(
	'Update inline automation graph',
	(target, payload) => {
		assertLeafParam(target);
		return payload.value;
	},
);

const updateParamAsKeyframesTimelineInlineCommandDef = defineNodeParamCommand<NodeParamTarget & { value: Extract<ParameterBinding, { inputSource: 'keyframesTimelineInline' }> }>(
	'Update inline keyframes timeline',
	(target, payload) => {
		assertLeafParam(target);
		return payload.value;
	},
);

const updateParamAsExternalCustomParameterInputCommandDef = defineNodeParamCommand<NodeParamTarget & { value: VisualModuleCustomParameterId }>(
	'Update param as externalCustomParameterInput',
	(target, payload) => {
		assertLeafParam(target);
		return { inputSource: 'externalCustomParameterInput', parameterId: payload.value };
	},
);

const updateParamAsNodeCommandDef = defineNodeParamCommand<NodeParamTarget & { value: NodeOutputReference | null; preserveSampling: boolean }>(
	'Update param as node',
	(target, payload) => {
		assertLeafParam(target);
		if (!('canNode' in target.def) || !target.def.canNode) throw new Error('Parameter does not support node input');
		if (payload.value == null) return { inputSource: 'node', nodeId: null, outputPort: null };
		// 配線操作の候補にも既定のサンプリング設定が入るため、設定変更とは明示的に区別する。
		// 読み取り方法は接続先の入力に属するので、配線操作では同じ出力への再接続でも維持する。
		const previous = target.value.inputSource === 'node' && target.value.nodeId != null ? target.value : undefined;
		const sampling = payload.preserveSampling && previous != null ? previous : payload.value;
		return { inputSource: 'node', ...payload.value, fitMode: sampling.fitMode, wrapMode: sampling.wrapMode, filterMode: sampling.filterMode };
	},
);

const addArrayParamElementCommandDef = defineNodeParamCommand<NodeParamTarget>(
	'Add array parameter element',
	({ def, value }) => {
		if (def.dataType.kind !== 'array' || value.inputSource !== 'literal' || !Array.isArray(value.value)) throw new Error('Expected array parameter');
		const element = deepClone(getArrayElementDefinition(def).defaultValue);
		return { inputSource: 'literal', value: [...value.value, element] };
	},
);

const removeArrayParamElementCommandDef = defineNodeParamCommand<NodeParamTarget & { index: number }>(
	'Remove array parameter element',
	({ def, value }, { index }) => {
		if (def.dataType.kind !== 'array' || value.inputSource !== 'literal' || !Array.isArray(value.value)) throw new Error('Expected array parameter');
		if (!Number.isInteger(index) || index < 0 || index >= value.value.length) throw new Error('Invalid array index');
		return { inputSource: 'literal', value: value.value.filter((_, i) => i !== index) };
	},
);

const changeNodeBypassStateCommandDef = defineCommand<NodeTarget & { bypass: boolean }>({
	label: 'Change node bypass state',
	create: (payload) => {
		let before: boolean;
		return {
			execute(state) {
				const node = stateUtility.findNode(state, payload);
				if (node?.type !== 'effect') throw new Error('Effect node not found');
				before = node.isBypass;
				node.isBypass = payload.bypass;
			},
			undo(state) {
				const node = stateUtility.findNode(state, payload);
				if (node?.type !== 'effect') throw new Error('Effect node not found');
				node.isBypass = before;
			},
		};
	},
});

const changeNodeResolutionCommandDef = defineCommand<NodeTarget & { resolution: VisualModuleEffectNode['resolution'] }>({
	label: 'Change node resolution',
	create: payload => {
		let before: VisualModuleEffectNode['resolution'];
		return {
			execute(state) {
				const node = stateUtility.findNode(state, payload);
				if (node?.type !== 'effect') throw new Error('Effect node not found');
				if (payload.resolution.mode === 'custom' && ![payload.resolution.width, payload.resolution.height].every(value => Number.isSafeInteger(value) && value > 0)) {
					throw new Error('Resolution width and height must be positive integers');
				}
				before = deepClone(node.resolution);
				node.resolution = deepClone(payload.resolution);
			},
			undo(state) {
				const node = stateUtility.findNode(state, payload);
				if (node?.type !== 'effect') throw new Error('Effect node not found');
				node.resolution = deepClone(before);
			},
		};
	},
});

const resetNodeParamCommandDef = defineNodeParamCommand<NodeParamTarget>(
	'Reset node param',
	({ def }) => deepClone(def.defaultValue),
);

const updateGlobalOutInputCommandDef = defineCommand<NodeTarget & { outputId: string; value: NodeOutputReference | null }>({
	label: 'Update global output input',
	create: payload => {
		let before: { nodeId: string; outputPort: string } | { nodeId: null; outputPort: null } | undefined;
		return {
			execute(state) {
				const node = stateUtility.findNode(state, payload);
				if (node?.type !== 'globalOut') throw new Error('Global output node not found');
				const module = stateUtility.getVisualModule(state, payload);
				if (!module.outputDefs.some(def => def.id === payload.outputId)) throw new Error('Module output not found');
				if (payload.value != null) {
					const source = stateUtility.findNode(state, { ...payload, nodeId: payload.value.nodeId });
					if (getNodeOutputs(source, stateUtility.getVisualModule(state, payload).paramDefs)[payload.value.outputPort] == null) throw new Error('Node output not found in this visualModule');
				}
				before = deepClone(node.inputs[payload.outputId]);
				node.inputs[payload.outputId] = payload.value == null ? { nodeId: null, outputPort: null }
					: { nodeId: payload.value.nodeId, outputPort: payload.value.outputPort };
			},
			undo(state) {
				const node = stateUtility.findNode(state, payload);
				if (node?.type !== 'globalOut') throw new Error('Global output node not found');
				if (before == null) delete node.inputs[payload.outputId];
				else node.inputs[payload.outputId] = deepClone(before);
			},
		};
	},
});

function validateVisualModuleParamDef(module: VisualModule, def: VisualModuleParamDef, previousId?: VisualModuleCustomParameterId) {
	if (isParameterType(def, 'enum')) {
		const options = def.dataType.options;
		if (options.length === 0 || options.some(value => value.trim() === '') || new Set(options).size !== options.length) {
			throw new Error('Enum options must be non-empty and unique');
		}
		if (!options.includes(def.defaultValue.value)) throw new Error('Enum default must be one of its options');
	}
	// 部分更新ではdataTypeとcanNodeの組み合わせを型だけでは保証できない。
	if (def.canNode && !isTextureDataType(def.dataType)) {
		throw new Error('Only node-capable parameter types can be exposed as In node outputs');
	}
	if (module.paramDefs.some(item => item.id !== previousId && (item.id === def.id || item.nameForReference === def.nameForReference))) {
		throw new Error('Parameter ID and name must be unique');
	}
}

const setVisualModulePrimaryInputCommandDef = defineCommand<VisualModuleTarget & { primaryInputId: VisualModuleCustomParameterId | null }>({
	label: 'Set visual module primary input',
	create: payload => {
		let before: VisualModuleCustomParameterId | null;
		return {
			execute(state) {
				const module = stateUtility.getVisualModule(state, payload);
				if (payload.primaryInputId !== null && !module.paramDefs.some(def => def.id === payload.primaryInputId && def.canNode && def.dataType.kind === 'color')) {
					throw new Error('Primary input must reference a node-capable color parameter');
				}
				before = module.primaryInputId;
				module.primaryInputId = payload.primaryInputId;
			},
			undo(state) {
				stateUtility.getVisualModule(state, payload).primaryInputId = before;
			},
		};
	},
});

const addVisualModuleParamDefCommandDef = defineCommand<VisualModuleTarget & { def: VisualModuleParamDef }>({
	label: 'Add visual module parameter',
	create: payload => ({
		execute(state) {
			const module = stateUtility.getVisualModule(state, payload);
			validateVisualModuleParamDef(module, payload.def);
			module.paramDefs.push(deepClone(payload.def));
		},
		undo(state) {
			const module = stateUtility.getVisualModule(state, payload);
			module.paramDefs = module.paramDefs.filter(def => def.id !== payload.def.id);
		},
	}),
});

const removeVisualModuleParamDefCommandDef = defineCommand<VisualModuleTarget & { defId: VisualModuleCustomParameterId }>({
	label: 'Remove visual module parameter',
	create: payload => {
		let before: VisualModuleParamDef;
		let index: number;
		let primaryInputId: VisualModuleCustomParameterId | null;
		return {
			execute(state) {
				const module = stateUtility.getVisualModule(state, payload);
				index = module.paramDefs.findIndex(def => def.id === payload.defId);
				if (index < 0) throw new Error('Visual module parameter not found');
				before = deepClone(module.paramDefs[index]);
				primaryInputId = module.primaryInputId;
				if (module.primaryInputId === payload.defId) module.primaryInputId = null;
				// ノードからの参照IDやレイヤーの値は保持する。未解決になった参照はUndoで再び有効になる。
				module.paramDefs.splice(index, 1);
			},
			undo(state) {
				const module = stateUtility.getVisualModule(state, payload);
				module.paramDefs.splice(index, 0, deepClone(before));
				module.primaryInputId = primaryInputId;
			},
		};
	},
});

const updateVisualModuleParamDefCommandDef = defineCommand<VisualModuleTarget & {
	defId: VisualModuleCustomParameterId; changes: Partial<Omit<VisualModuleParamDef, 'id'>>;
}>({
	label: 'Update visual module parameter',
	create: payload => {
		let before: VisualModuleParamDef;
		let primaryInputId: VisualModuleCustomParameterId | null;
		return {
			execute(state) {
				const module = stateUtility.getVisualModule(state, payload);
				const index = module.paramDefs.findIndex(def => def.id === payload.defId);
				if (index < 0) throw new Error('Visual module parameter not found');
				const next = { ...module.paramDefs[index], ...deepClone(payload.changes), id: payload.defId } as VisualModuleParamDef;
				validateVisualModuleParamDef(module, next, payload.defId);
				before = deepClone(module.paramDefs[index]);
				primaryInputId = module.primaryInputId;
				// 主入力の条件を失う変更と指定の解除を、同じUndo単位で扱う。
				if (module.primaryInputId === payload.defId && (!next.canNode || next.dataType.kind !== 'color')) module.primaryInputId = null;
				module.paramDefs[index] = next;
			},
			undo(state) {
				const module = stateUtility.getVisualModule(state, payload);
				const index = module.paramDefs.findIndex(def => def.id === payload.defId);
				if (index < 0) throw new Error('Visual module parameter not found');
				module.paramDefs[index] = deepClone(before);
				module.primaryInputId = primaryInputId;
			},
		};
	},
});

function validateVisualModuleOutputDef(module: VisualModule, def: VisualModuleOutputDef, previousId?: string) {
	if (module.outputDefs.some(item => item.id !== previousId && (item.id === def.id || item.name === def.name))) {
		throw new Error('Output ID and name must be unique');
	}
}

const addVisualModuleOutputDefCommandDef = defineCommand<VisualModuleTarget & { def: VisualModuleOutputDef }>({
	label: 'Add visual module output',
	create: payload => {
		let primaryOutputId: string | null;
		return {
			execute(state) {
				const module = stateUtility.getVisualModule(state, payload);
				validateVisualModuleOutputDef(module, payload.def);
				primaryOutputId = module.primaryOutputId;
				module.outputDefs.push(deepClone(payload.def));
				if (module.primaryOutputId === null && payload.def.dataType.kind === 'color') module.primaryOutputId = payload.def.id;
			},
			undo(state) {
				const module = stateUtility.getVisualModule(state, payload);
				module.outputDefs = module.outputDefs.filter(def => def.id !== payload.def.id);
				module.primaryOutputId = primaryOutputId;
			},
		};
	},
});

const setVisualModulePrimaryOutputCommandDef = defineCommand<VisualModuleTarget & { primaryOutputId: string | null }>({
	label: 'Set visual module primary output',
	create: payload => {
		let before: string | null;
		return {
			execute(state) {
				const module = stateUtility.getVisualModule(state, payload);
				if (payload.primaryOutputId !== null && !module.outputDefs.some(def => def.id === payload.primaryOutputId && def.dataType.kind === 'color')) {
					throw new Error('Primary output must reference a color output');
				}
				before = module.primaryOutputId;
				module.primaryOutputId = payload.primaryOutputId;
			},
			undo(state) {
				stateUtility.getVisualModule(state, payload).primaryOutputId = before;
			},
		};
	},
});

const removeVisualModuleOutputDefCommandDef = defineCommand<VisualModuleTarget & { defId: string }>({
	label: 'Remove visual module output',
	create: payload => {
		let before: VisualModuleOutputDef;
		let primaryOutputId: string | null;
		let index: number;
		return {
			execute(state) {
				const module = stateUtility.getVisualModule(state, payload);
				index = module.outputDefs.findIndex(def => def.id === payload.defId);
				if (index < 0) throw new Error('Visual module output not found');
				before = deepClone(module.outputDefs[index]);
				primaryOutputId = module.primaryOutputId;
				// Outの接続はIDとともに保持し、Undoで定義を戻したときに再び有効にする。
				module.outputDefs.splice(index, 1);
				if (module.primaryOutputId === payload.defId) module.primaryOutputId = null;
			},
			undo(state) {
				const module = stateUtility.getVisualModule(state, payload);
				module.outputDefs.splice(index, 0, deepClone(before));
				module.primaryOutputId = primaryOutputId;
			},
		};
	},
});

const updateVisualModuleOutputDefCommandDef = defineCommand<VisualModuleTarget & {
	defId: string; changes: Partial<Omit<VisualModuleOutputDef, 'id'>>;
}>({
	label: 'Update visual module output',
	create: payload => {
		let before: VisualModuleOutputDef;
		let primaryOutputId: string | null;
		return {
			execute(state) {
				const module = stateUtility.getVisualModule(state, payload);
				const index = module.outputDefs.findIndex(def => def.id === payload.defId);
				if (index < 0) throw new Error('Visual module output not found');
				const next = { ...module.outputDefs[index], ...deepClone(payload.changes), id: payload.defId };
				validateVisualModuleOutputDef(module, next, payload.defId);
				before = deepClone(module.outputDefs[index]);
				primaryOutputId = module.primaryOutputId;
				module.outputDefs[index] = next;
				if (module.primaryOutputId === payload.defId && next.dataType.kind !== 'color') module.primaryOutputId = null;
			},
			undo(state) {
				const module = stateUtility.getVisualModule(state, payload);
				const index = module.outputDefs.findIndex(def => def.id === payload.defId);
				if (index < 0) throw new Error('Visual module output not found');
				module.outputDefs[index] = deepClone(before);
				module.primaryOutputId = primaryOutputId;
			},
		};
	},
});

const addInlineVisualModuleLayerCommandDef = defineCommand<{ sceneId: string; layer: TimelineInlineVisualModuleLayer }>({
	label: 'Add inline visual module layer',
	create: payload => ({
		execute(state) { getScene(state, payload.sceneId).layers.unshift(deepClone(payload.layer)); },
		undo(state) { getScene(state, payload.sceneId).layers = getScene(state, payload.sceneId).layers.filter(layer => layer.id !== payload.layer.id); },
	}),
});

const editVisualModuleLayerTimingCommandDef = defineCommand<{ sceneId: string; layerId: string; positionMs: number; trimmedDurationMs: number }>({
	label: 'Edit visual module layer timing',
	create: payload => {
		let before: TimelineLayerTiming;
		const getLayer = (state: AppState) => {
			const layer = getScene(state, payload.sceneId).layers.find(layer => layer.id === payload.layerId);
			if (layer?.layerType !== 'visualModule' && layer?.layerType !== 'inlineVisualModule') throw new Error('Visual module layer not found');
			return layer;
		};
		return {
			execute(state) {
				// Visual Moduleの端編集は当面、配置・表示区間の変更として扱い、トリムを作らない。
				const timing = createUntrimmedTimelineLayerTiming(payload.positionMs, payload.trimmedDurationMs);
				if (!isTimelineLayerTimingValid(timing)) throw new Error('Invalid layer timing');
				const layer = getLayer(state);
				before = { positionMs: layer.positionMs, trimmedDurationMs: layer.trimmedDurationMs, trimStartMs: layer.trimStartMs };
				Object.assign(layer, timing);
			},
			undo(state) { Object.assign(getLayer(state), before); },
		};
	},
});

function validateVideoTiming(timing: TimelineLayerTiming, sourceDurationMs: number) {
	if (!isTimelineLayerTimingValid(timing) || !Number.isFinite(sourceDurationMs) || sourceDurationMs <= 0
		|| timing.trimStartMs + timing.trimmedDurationMs > sourceDurationMs) throw new Error('Invalid video layer timing');
}

const addVideoLayerCommandDef = defineCommand<{ sceneId: string; layer: TimelineVideoLayer; sourceDurationMs: number }>({
	label: 'Add video layer',
	create: payload => ({
		execute(state) {
			validateVideoTiming(payload.layer, payload.sourceDurationMs);
			getScene(state, payload.sceneId).layers.unshift(deepClone(payload.layer));
		},
		undo(state) { getScene(state, payload.sceneId).layers = getScene(state, payload.sceneId).layers.filter(layer => layer.id !== payload.layer.id); },
	}),
});

const editVideoLayerTimingCommandDef = defineCommand<{ sceneId: string; layerId: string; sourceDurationMs: number } & TimelineLayerTiming>({
	label: 'Edit video layer timing',
	create: payload => {
		let before: TimelineLayerTiming;
		const getLayer = (state: AppState) => {
			const layer = getScene(state, payload.sceneId).layers.find(layer => layer.id === payload.layerId);
			if (layer?.layerType !== 'video') throw new Error('Video layer not found');
			return layer;
		};
		return {
			execute(state) {
				validateVideoTiming(payload, payload.sourceDurationMs);
				const layer = getLayer(state);
				before = { positionMs: layer.positionMs, trimStartMs: layer.trimStartMs, trimmedDurationMs: layer.trimmedDurationMs };
				Object.assign(layer, { positionMs: payload.positionMs, trimStartMs: payload.trimStartMs, trimmedDurationMs: payload.trimmedDurationMs });
			},
			undo(state) { Object.assign(getLayer(state), before); },
		};
	},
});

const editVideoLayerSettingsCommandDef = defineCommand<{ sceneId: string; layerId: string; audioEnabled?: boolean }>({
	label: 'Edit video layer settings',
	create: payload => {
		let before: { audioEnabled: boolean };
		const getLayer = (state: AppState) => {
			const layer = getScene(state, payload.sceneId).layers.find(layer => layer.id === payload.layerId);
			if (layer?.layerType !== 'video') throw new Error('Video layer not found');
			return layer;
		};
		return {
			execute(state) {
				const layer = getLayer(state);
				before = { audioEnabled: layer.audioEnabled };
				if (payload.audioEnabled != null) layer.audioEnabled = payload.audioEnabled;
			},
			undo(state) { Object.assign(getLayer(state), before); },
		};
	},
});

const addAudioLayerCommandDef = defineCommand<{ sceneId: string; layer: TimelineAudioLayer }>({
	label: 'Add audio layer',
	create: payload => ({
		execute(state) { getScene(state, payload.sceneId).layers.unshift(deepClone(payload.layer)); },
		undo(state) { getScene(state, payload.sceneId).layers = getScene(state, payload.sceneId).layers.filter(layer => layer.id !== payload.layer.id); },
	}),
});

const editAudioLayerTimingCommandDef = defineCommand<{ sceneId: string; layerId: string } & TimelineLayerTiming>({
	label: 'Edit audio layer timing',
	create: payload => {
		let before: TimelineLayerTiming;
		const getLayer = (state: AppState) => {
			const layer = getScene(state, payload.sceneId).layers.find(layer => layer.id === payload.layerId);
			if (layer?.layerType !== 'audio') throw new Error('Audio layer not found');
			return layer;
		};
		return {
			execute(state) {
				const { positionMs, trimmedDurationMs, trimStartMs } = payload;
				const layer = getLayer(state);
				if (!isTimelineLayerTimingValid({ positionMs, trimmedDurationMs, trimStartMs })) throw new Error('Invalid audio layer timing');
				before = { positionMs: layer.positionMs, trimmedDurationMs: layer.trimmedDurationMs, trimStartMs: layer.trimStartMs };
				Object.assign(layer, { positionMs, trimmedDurationMs, trimStartMs });
			},
			undo(state) { Object.assign(getLayer(state), before); },
		};
	},
});

const pasteTimelineLayerCommandDef = defineCommand<{ sceneId: string; layer: TimelineLayer; sourceLayerId: string }>({
	label: 'Paste timeline layer',
	create: payload => ({
		execute(state) {
			validateSceneLayerPlacement(state, payload.sceneId, payload.layer);
			const sourceIndex = getScene(state, payload.sceneId).layers.findIndex(layer => layer.id === payload.sourceLayerId);
			// 表示順は先頭が最上層。コピー元が削除済みなら最上層へ挿入する。
			getScene(state, payload.sceneId).layers.splice(Math.max(0, sourceIndex), 0, deepClone(payload.layer));
		},
		undo(state) {
			getScene(state, payload.sceneId).layers = getScene(state, payload.sceneId).layers.filter(layer => layer.id !== payload.layer.id);
		},
	}),
});

const reorderTimelineLayersCommandDef = defineCommand<{ sceneId: string; layerIds: string[] }>({
	label: 'Reorder timeline layers',
	create: payload => {
		let before: string[];
		const reorder = (state: AppState, layerIds: string[]) => {
			const layers = new Map(getScene(state, payload.sceneId).layers.map(layer => [layer.id, layer]));
			if (layerIds.length !== layers.size || new Set(layerIds).size !== layers.size || layerIds.some(id => !layers.has(id))) {
				throw new Error('Invalid timeline layer order');
			}
			// D&Dで渡されるレイヤーのコピーではなく、現在のレイヤーをIDで並べ替える。
			getScene(state, payload.sceneId).layers = layerIds.map(id => layers.get(id)!);
		};
		return {
			execute(state) {
				before = getScene(state, payload.sceneId).layers.map(layer => layer.id);
				reorder(state, payload.layerIds);
			},
			undo(state) { reorder(state, before); },
		};
	},
});

const removeTimelineLayerCommandDef = defineCommand<{ sceneId: string; layerId: string }>({
	label: 'Remove timeline layer',
	create: payload => {
		let before: TimelineLayer;
		let index: number;
		return {
			execute(state) {
				index = getScene(state, payload.sceneId).layers.findIndex(layer => layer.id === payload.layerId);
				if (index < 0) throw new Error('Timeline layer not found');
				before = deepClone(getScene(state, payload.sceneId).layers[index]);
				getScene(state, payload.sceneId).layers.splice(index, 1);
			},
			undo(state) { getScene(state, payload.sceneId).layers.splice(index, 0, deepClone(before)); },
		};
	},
});

// 配置先はCommandに保存する。Undo/Redo時のUIの選択Sceneには依存させない。
function validateSceneLayerPlacement(state: AppState, sceneId: string, layer: TimelineLayer) {
	if (!isTimelineLayerTimingValid(layer)) throw new Error('Invalid layer timing');
	if (layer.layerType !== 'scene') return;
	if (!canReferenceScene(state.timelineScenes.value, sceneId, layer.sceneId)) throw new Error('Circular scene reference');
	if (getSceneDuration(getScene(state, layer.sceneId)) <= 0) throw new Error('Cannot place an empty scene');
}

const addSceneCommandDef = defineCommand<TimelineScene>({
	label: 'Add scene',
	create: payload => ({
		execute(state) {
			validateTimelineScenes([...state.timelineScenes.value, payload]);
			state.timelineScenes.value.push(deepClone(payload));
		},
		undo(state) { state.timelineScenes.value = state.timelineScenes.value.filter(scene => scene.id !== payload.id); },
	}),
});

const renameSceneCommandDef = defineCommand<{ sceneId: string; name: string }>({
	label: 'Rename scene',
	create: payload => {
		let before: string;
		return {
			execute(state) { const scene = getScene(state, payload.sceneId); before = scene.name; scene.name = payload.name; },
			undo(state) { getScene(state, payload.sceneId).name = before; },
		};
	},
});

const removeSceneCommandDef = defineCommand<{ sceneId: string }>({
	label: 'Remove scene',
	create: payload => {
		let before: TimelineScene;
		let index: number;
		return {
			execute(state) {
				const references = state.timelineScenes.value.filter(scene => scene.layers.some(layer => layer.layerType === 'scene' && layer.sceneId === payload.sceneId));
				if (references.length > 0) throw new Error('Scene is used by: ' + references.map(scene => scene.name).join(', '));
				before = deepClone(getScene(state, payload.sceneId));
				index = state.timelineScenes.value.findIndex(scene => scene.id === payload.sceneId);
				state.timelineScenes.value.splice(index, 1);
			},
			undo(state) { state.timelineScenes.value.splice(index, 0, deepClone(before)); },
		};
	},
});

const addSceneLayerCommandDef = defineCommand<{ sceneId: string; layer: TimelineSceneLayer }>({
	label: 'Add scene layer',
	create: payload => ({
		execute(state) {
			validateSceneLayerPlacement(state, payload.sceneId, payload.layer);
			getScene(state, payload.sceneId).layers.unshift(deepClone(payload.layer));
		},
		undo(state) { const scene = getScene(state, payload.sceneId); scene.layers = scene.layers.filter(layer => layer.id !== payload.layer.id); },
	}),
});

const editSceneLayerTimingCommandDef = defineCommand<{ sceneId: string; layerId: string } & TimelineLayerTiming>({
	label: 'Edit scene layer timing',
	create: payload => {
		let before: TimelineLayerTiming;
		const getLayer = (state: AppState) => {
			const layer = getScene(state, payload.sceneId).layers.find(layer => layer.id === payload.layerId);
			if (layer?.layerType !== 'scene') throw new Error('Scene layer not found');
			return layer;
		};
		return {
			execute(state) {
				const { positionMs, trimStartMs, trimmedDurationMs } = payload;
				if (!isTimelineLayerTimingValid(payload)) throw new Error('Invalid layer timing');
				const layer = getLayer(state);
				before = { positionMs: layer.positionMs, trimStartMs: layer.trimStartMs, trimmedDurationMs: layer.trimmedDurationMs };
				Object.assign(layer, { positionMs, trimStartMs, trimmedDurationMs });
			},
			undo(state) { Object.assign(getLayer(state), before); },
		};
	},
});

const moveTimelineLayersCommandDef = defineCommand<{ sceneId: string; positions: { layerId: string; positionMs: number }[] }>({
	label: 'Move timeline layers',
	create: payload => {
		let before: typeof payload.positions;
		const apply = (state: AppState, positions: typeof payload.positions) => {
			const layers = getScene(state, payload.sceneId).layers;
			// 全対象を検証してから変更し、途中の失敗で一部だけ移動した状態を残さない。
			const updates = positions.map(position => {
				const layer = layers.find(layer => layer.id === position.layerId);
				if (layer == null || layer.layerType === 'effect' || !isTimelineLayerTimingValid({ ...layer, positionMs: position.positionMs })) throw new Error('Invalid layer move');
				return { layer, positionMs: position.positionMs };
			});
			const previous = updates.map(({ layer }) => ({ layerId: layer.id, positionMs: layer.positionMs }));
			for (const { layer, positionMs } of updates) layer.positionMs = positionMs;
			return previous;
		};
		return {
			execute(state) { before = apply(state, payload.positions); },
			undo(state) { apply(state, before); },
		};
	},
});

const moveTimelineKeyframesCommandDef = defineCommand<{ sceneId: string; positions: (TimelineKeyframeSelection & { x: number })[] }>({
	label: 'Move timeline keyframes',
	create: payload => {
		let before: typeof payload.positions;
		const apply = (state: AppState, positions: typeof payload.positions) => {
			const layers = getScene(state, payload.sceneId).layers;
			const updates = positions.map(position => {
				const layer = layers.find(layer => layer.id === position.layerId);
				if (layer == null || !Number.isFinite(position.x) || position.x < 0) throw new Error('Invalid keyframe move');
				const binding = getLayerParameterValues(layer, position.target)[position.paramId];
				const point = binding?.inputSource === 'keyframesTimelineInline' ? binding.keyframesTimeline.keyframes.find(point => point.id === position.keyframeId) : undefined;
				if (point == null) throw new Error('Timeline keyframe not found');
				return { point, position };
			});
			const previous = updates.map(({ point, position }) => ({ ...position, x: point.x }));
			for (const { point, position } of updates) point.x = position.x;
			return previous;
		};
		return {
			execute(state) { before = apply(state, payload.positions); },
			undo(state) { apply(state, before); },
		};
	},
});

export const COMMAND_DEFS = {
	moveTimelineLayers: moveTimelineLayersCommandDef,
	moveTimelineKeyframes: moveTimelineKeyframesCommandDef,
	addScene: addSceneCommandDef,
	renameScene: renameSceneCommandDef,
	removeScene: removeSceneCommandDef,
	addSceneLayer: addSceneLayerCommandDef,
	editSceneLayerTiming: editSceneLayerTimingCommandDef,
	pasteTimelineLayer: pasteTimelineLayerCommandDef,
	reorderTimelineLayers: reorderTimelineLayersCommandDef,
	addInlineVisualModuleLayer: addInlineVisualModuleLayerCommandDef,
	editVisualModuleLayerTiming: editVisualModuleLayerTimingCommandDef,
	addAudioLayer: addAudioLayerCommandDef,
	addVideoLayer: addVideoLayerCommandDef,
	editVideoLayerTiming: editVideoLayerTimingCommandDef,
	editVideoLayerSettings: editVideoLayerSettingsCommandDef,
	editAudioLayerTiming: editAudioLayerTimingCommandDef,
	removeTimelineLayer: removeTimelineLayerCommandDef,
	editTimelineLayerParam: editTimelineLayerParamCommandDef,
	setVisualModulePrimaryOutput: setVisualModulePrimaryOutputCommandDef,
	setVisualModulePrimaryInput: setVisualModulePrimaryInputCommandDef,
	addVisualModuleOutputDef: addVisualModuleOutputDefCommandDef,
	removeVisualModuleOutputDef: removeVisualModuleOutputDefCommandDef,
	updateVisualModuleOutputDef: updateVisualModuleOutputDefCommandDef,
	addVisualModuleParamDef: addVisualModuleParamDefCommandDef,
	removeVisualModuleParamDef: removeVisualModuleParamDefCommandDef,
	updateVisualModuleParamDef: updateVisualModuleParamDefCommandDef,
	updateGlobalOutInput: updateGlobalOutInputCommandDef,
	addEffectNode: addEffectNodeCommandDef,
	changeNodeResolution: changeNodeResolutionCommandDef,
	moveNode: moveNodeCommandDef,
	removeNode: removeNodeCommandDef,
	addAsset: addAssetCommandDef,
	removeAsset: removeAssetCommandDef,
	renameAsset: renameAssetCommandDef,
	replaceAsset: replaceAssetCommandDef,
	addPlayer: addPlayerCommandDef,
	updatePlayerSourceType: updatePlayerSourceTypeCommandDef,
	changeParamValueInputSource: changeParamValueInputSourceCommandDef,
	updateParamAsLiteral: updateParamAsLiteralCommandDef,
	updateParamAsEnvVariable: updateParamAsEnvVariableCommandDef,
	updateParamAsExpression: updateParamAsExpressionCommandDef,
	updateParamAsAutomationGraphReference: updateParamAsAutomationGraphReferenceCommandDef,
	updateParamAsAutomationGraphInline: updateParamAsAutomationGraphInlineCommandDef,
	updateParamAsKeyframesTimelineInline: updateParamAsKeyframesTimelineInlineCommandDef,
	updateParamAsNode: updateParamAsNodeCommandDef,
	updateParamAsExternalCustomParameterInput: updateParamAsExternalCustomParameterInputCommandDef,
	changeNodeBypassState: changeNodeBypassStateCommandDef,
	resetNodeParam: resetNodeParamCommandDef,
	addArrayParamElement: addArrayParamElementCommandDef,
	removeArrayParamElement: removeArrayParamElementCommandDef,
};
