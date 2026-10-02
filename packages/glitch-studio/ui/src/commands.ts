import { resolveParameter, walkParameters } from '@gs/shared/parameter/parameter-path.ts';
import type { ParamPath } from '@gs/shared/parameter/parameter-path.ts';
import type { TimelineParameterTarget } from './utility/timeline-scene.ts';
import { createLayerInputBinding, validateTimelineEffectLayer } from '@gs/subsystems_timeline_shared/effect-layer.ts';
import { validateEffectResolution } from '@gs/subsystems_effect_shared/resolution.ts';
import type { EffectResolution } from '@gs/subsystems_effect_shared/resolution.ts';
import { getScene, getLayerParameterValues, getLayerParameterDefinitions, resolveLayerParameter } from './utility/timeline-scene.ts';
import { canReferenceScene, validateTimelineScenes } from '@gs/subsystems_timeline_shared/scenes.ts';
import { getTimelineClipMoveBounds, getTimelineClipTrimBounds, getTimelineClipInsertionDuration, getTimelineMediaMaxDurationMs, validateTimelineClips } from '@gs/subsystems_timeline_shared/timing.ts';
import type { TimelineClipTiming } from '@gs/subsystems_timeline_shared/timing.ts';
import type { TimelineClip, TimelineAssetClip, TimelineVideoClip, TimelineSceneClip } from '@gs/subsystems_timeline_shared/clip.ts';
import { validateTimelineParameterTree } from '@gs/subsystems_timeline_shared/parameter-binding.ts';
import { getArrayElementDefinition, isParameterType } from '@gs/shared/parameter/parameter-definition.ts';
import { visualModuleCustomParameterId } from '@gs/subsystems_visual-module_shared/types.ts';
import { effectDefinitions } from '@gs/subsystems_effect_shared/effect-definitions.ts';
import { AiSON } from '@syuilo/aiscript';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { genId } from '@gs/shared/utility/id.ts';
import { getNodeOutputs } from '@gs/subsystems_visual-module_shared/node-outputs.ts';
import { getNodeInputDataType } from '@gs/shared/data-type/node-compatibility.ts';
import { isTextureDataType } from '@gs/shared/data-type/data-type.ts';
import { timelineAudioParamDefs } from '@gs/subsystems_timeline_shared/timeline-audio.ts';
import type { TimelineScene, TimelineLayer } from '@gs/subsystems_timeline_shared/types.ts';
import { validateSceneResolution } from '@gs/subsystems_timeline_shared/scene-resolution.ts';
import type { TimelineSceneResolution } from '@gs/subsystems_timeline_shared/scene-resolution.ts';
import { timelineCompositingParamDefs } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import type { VisualModuleCustomParameterId, VisualModuleEffectNode, VisualModuleNode, NodeOutputReference, VisualModule, VisualModuleParamDef, VisualModuleOutputDef } from '@gs/subsystems_visual-module_shared/types.ts';
import type { ParameterArrayElement } from '@gs/shared/parameter/parameter-binding.ts';
import type { ParameterChangeKind, ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { AppState } from './types.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { Asset, Player } from '@gs/shared/types.ts';
import type { AutomationGraphPlaybackOptions } from '@gs/shared/automation-graph/automation-graph.ts';
import type { ParameterBinding } from '@gs/shared/parameter/parameter-binding.ts';
import type { NodeParamTarget as EffectNodeParamTarget } from '@/utility/node-params.ts';
import type { ExpressionVariableName } from '@gs/shared/expression/expression-environment.ts';
import { canConnectNodeDataTypes } from '@/utility/node-outputs.ts';
import { resolveNodeParam, walkNodeParams } from '@/utility/node-params.ts';
import { createInlineAutomationGraph } from '@/utility/automation-graph.ts';
import { createInlineKeyframesTimeline } from '@/utility/keyframes-timeline.ts';
import { createResetParameterBinding } from '@/utility/parameter-default.ts';
import { getVisualModule, listVisualModules } from '@/utility/visual-module-target.ts';
import type { VisualModuleTarget } from '@/utility/visual-module-target.ts';
import type { TimelineKeyframeSelection } from '@/utility/timeline-selection.ts';
import type { AppStateChange } from './AppStateChange.ts';

export type CommandDef<Payload> = {
	label: string;
	// 確定した状態の変更対象・内容を宣言する。どの通知を同期するか、キャッシュや
	// 実行インスタンスを保持するかは購読側の責務とし、履歴操作でも同じ通知を使う。
	changes: (state: AppState, payload: Payload) => AppStateChange[];
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
	paramPath: ParamPath;
	target?: TimelineParameterTarget;
	edit:
		| { kind: 'literal'; value: any }
		| { kind: 'automationGraphInline'; value: Extract<ParameterBinding, { inputSource: 'automationGraphInline' }> }
		| { kind: 'keyframesTimelineInline'; value: Extract<ParameterBinding, { inputSource: 'keyframesTimelineInline' }> }
		| { kind: 'layerInput'; value: Extract<ParameterBinding, { inputSource: 'layerInput' }> }
		| { kind: 'envVariable' | 'expression'; value: string }
		| { kind: 'automationGraphReference'; value: string | null; options?: Partial<AutomationGraphPlaybackOptions> }
		| { kind: 'inputSource'; inputSource: ParameterBinding['inputSource'] }
		| { kind: 'reset' }
		| { kind: 'addElement' }
		| { kind: 'removeElement'; elementId: string };
}>({
	label: 'Edit timeline layer param',
	changes: (_state, payload) => {
		let kind: ParameterChangeKind;
		switch (payload.edit.kind) {
			case 'addElement':
			case 'removeElement': kind = 'arrayElements'; break;
			case 'reset': kind = 'reset'; break;
			case 'inputSource': kind = 'inputSource'; break;
			case 'layerInput': kind = 'connection'; break;
			default: kind = 'value'; break;
		}
		return [{ type: 'layer', sceneId: payload.sceneId, layerId: payload.layerId,
			changes: [{ type: 'parameter', target: payload.target ?? 'module', kind }] }];
	},
	create: payload => {
		let before: ParameterBinding | undefined;
		let after: ParameterBinding | undefined;
		const target = payload.target ?? 'module';
		const rootKey = payload.paramPath[0];
		const getLayer = (state: AppState) => {
			const layer = getScene(state, payload.sceneId).layers.find(layer => layer.id === payload.layerId);
			if (layer == null) throw new Error('Timeline layer not found');
			getLayerParameterValues(layer, target);
			return layer;
		};
		return {
			execute(state) {
				const layer = getLayer(state);
				const values = getLayerParameterValues(layer, target);
				const defs = getLayerParameterDefinitions(state, layer, target);
				const rootDef = defs[rootKey];
				if (rootDef == null) throw new Error('Timeline parameter not found');
				const module = target === 'module' && (layer.layerType === 'visualModule' || layer.layerType === 'inlineVisualModule')
					? layer.layerType === 'inlineVisualModule' ? layer.visualModule : stateUtility.getVisualModule(state, layer) : undefined;
				if (module?.primaryInputId === rootKey) throw new Error('Cannot edit the visual module primary input');
				if (after === undefined) {
					before = deepClone(values[rootKey]);
					const draft = { [rootKey]: deepClone(before ?? rootDef.defaultValue) };
					const resolved = resolveParameter(defs, draft, payload.paramPath);
					const { def, value: current } = resolved;
					const edit = payload.edit;
					let next: ParameterBinding;
					const container = def.dataType.kind === 'array' || def.dataType.kind === 'struct';
					if (container && !['reset', 'addElement', 'removeElement'].includes(edit.kind)) throw new Error('Container parameters must be edited through their children');
					switch (edit.kind) {
						case 'literal': next = { inputSource: 'literal', value: deepClone(edit.value) }; break;
						case 'automationGraphInline':
						case 'keyframesTimelineInline':
						case 'layerInput': next = deepClone(edit.value); break;
						case 'envVariable': next = { inputSource: 'envVariable', variable: edit.value }; break;
						case 'expression': next = { inputSource: 'expression', expression: edit.value }; break;
						case 'automationGraphReference': next = {
							inputSource: 'automationGraphReference', trimmedDurationMs: 1000, wrapMode: 'repeat', offsetMode: 'start',
							...(current.inputSource === 'automationGraphReference' ? current : {}), automationGraphId: edit.value, ...edit.options,
						}; break;
						case 'reset': next = target === 'effect' && layer.layerType === 'effect' && payload.paramPath.length === 1
							&& effectDefinitions[layer.effectId].kind === 'modify' && effectDefinitions[layer.effectId].primaryInputParameter === rootKey
							? createLayerInputBinding() : createResetParameterBinding(def); break;
						case 'addElement':
						case 'removeElement': {
							if (def.dataType.kind !== 'array' || current.inputSource !== 'literal') throw new Error('Expected array parameter');
							const elements = current.value as ParameterArrayElement[];
							if (edit.kind === 'removeElement' && !elements.some(element => element.id === edit.elementId)) throw new Error('Unknown array element');
							next = { inputSource: 'literal', value: edit.kind === 'addElement'
								? [...elements, { id: genId(), binding: createResetParameterBinding(getArrayElementDefinition(def)) }]
								: elements.filter(element => element.id !== edit.elementId) };
							break;
						}
						case 'inputSource':
							switch (edit.inputSource) {
								case 'literal': next = deepClone(def.defaultValue); break;
								case 'envVariable': next = { inputSource: 'envVariable', variable: '' }; break;
								case 'expression': next = { inputSource: 'expression', expression: AiSON.stringify(current.inputSource === 'literal' ? current.value : def.defaultValue.value) }; break;
								case 'automationGraphReference': next = { inputSource: 'automationGraphReference', automationGraphId: null, trimmedDurationMs: 1000, wrapMode: 'repeat', offsetMode: 'start' }; break;
								case 'automationGraphInline': next = createInlineAutomationGraph(); break;
								case 'keyframesTimelineInline': next = createInlineKeyframesTimeline(def, current); break;
								case 'layerInput': next = createLayerInputBinding(); break;
								case 'node':
								case 'externalCustomParameterInput': throw new Error('Unsupported layer parameter input source');
							}
							break;
					}
					resolved.setValue(next);
					for (const { value } of walkParameters({ [rootKey]: rootDef }, draft)) {
						if (value.inputSource === 'keyframesTimelineInline') for (const point of value.keyframesTimeline.keyframes) point.x = Math.round(point.x);
					}
					validateTimelineParameterTree(rootDef, draft[rootKey], target === 'effect');
					// 生成済みの要素IDをRedoでも使う。検証に失敗した編集は保存しない。
					after = draft[rootKey];
				}
				values[rootKey] = deepClone(after);
			},
			undo(state) {
				const values = getLayerParameterValues(getLayer(state), target);
				if (before === undefined) delete values[rootKey];
				else values[rootKey] = deepClone(before);
			},
		};
	},
});

const addEffectNodeCommandDef = defineCommand<VisualModuleTarget & { id: string; effectId: string; params?: Record<string, ParameterBinding> }>({
	label: 'Add fx node',
	changes: (_state, payload) => [{ type: 'visualModule', target: payload }],
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
	changes: (_state, payload) => [{ type: 'visualModule', target: payload }],
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
	changes: (_state, payload) => [{ type: 'visualModule', target: payload }],
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
	changes: (_state, payload) => [{ type: 'asset', assetId: payload.id }],
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
	changes: (state, payload) => [{ type: 'asset', assetId: payload.assetId },
		...listVisualModules(state).map(({ target }) => ({ type: 'visualModule' as const, target }))],
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
	changes: (_state, payload) => [{ type: 'asset', assetId: payload.assetId }],
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
	changes: (_state, payload) => [{ type: 'asset', assetId: payload.assetId }],
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
	changes: (_state, payload) => [{ type: 'player', playerId: payload.id }],
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
	changes: (_state, payload) => [{ type: 'player', playerId: payload.playerId }],
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
	kind: ParameterChangeKind = 'value',
) {
	return defineCommand<Payload>({
		label,
		changes: (_state, payload) => [{ type: 'node', target: payload, nodeId: payload.nodeId, changes: [{ type: 'parameter', kind }] }],
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
						// 追加・リセットで発行した要素IDも、Redoでは同じ状態に戻す。
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
				return createInlineKeyframesTimeline(target.def, currentValue);
			case 'externalCustomParameterInput': return { inputSource: 'externalCustomParameterInput', parameterId: visualModuleCustomParameterId('') };
			case 'layerInput': throw new Error('Layer input is only available in effect layer parameters');
			case 'node': {
				if (!('canNode' in target.def) || !target.def.canNode) throw new Error('Parameter does not support node input');
				return { inputSource: 'node', nodeId: null, outputPort: null };
			}
		}
	},
	'inputSource',
);

const updateParamAsLiteralCommandDef = defineNodeParamCommand<NodeParamTarget & { value: any }>(
	'Update param as literal',
	(target, payload) => {
		assertLeafParam(target);
		return { inputSource: 'literal', value: payload.value };
	},
);

const updateParamAsEnvVariableCommandDef = defineNodeParamCommand<NodeParamTarget & { value: ExpressionVariableName }>(
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
	'connection',
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
	'connection',
);

const addArrayParamElementCommandDef = defineNodeParamCommand<NodeParamTarget>(
	'Add array parameter element',
	({ def, value }) => {
		if (def.dataType.kind !== 'array' || value.inputSource !== 'literal' || !Array.isArray(value.value)) throw new Error('Expected array parameter');
		const element: ParameterArrayElement = { id: genId(), binding: deepClone(getArrayElementDefinition(def).defaultValue) };
		return { inputSource: 'literal', value: [...value.value, element] };
	},
	'arrayElements',
);

const removeArrayParamElementCommandDef = defineNodeParamCommand<NodeParamTarget & { elementId: string }>(
	'Remove array parameter element',
	({ def, value }, { elementId }) => {
		if (def.dataType.kind !== 'array' || value.inputSource !== 'literal' || !Array.isArray(value.value)) throw new Error('Expected array parameter');
		const elements = value.value as ParameterArrayElement[];
		if (!elements.some(element => element.id === elementId)) throw new Error('Unknown array element');
		return { inputSource: 'literal', value: elements.filter(element => element.id !== elementId) };
	},
	'arrayElements',
);

const changeNodeBypassStateCommandDef = defineCommand<NodeTarget & { bypass: boolean }>({
	label: 'Change node bypass state',
	changes: (_state, payload) => [{ type: 'node', target: payload, nodeId: payload.nodeId, changes: [{ type: 'bypass' }] }],
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
	changes: (_state, payload) => [{ type: 'node', target: payload, nodeId: payload.nodeId, changes: [{ type: 'resolution' }] }],
	create: payload => {
		let before: VisualModuleEffectNode['resolution'];
		return {
			execute(state) {
				const node = stateUtility.findNode(state, payload);
				if (node?.type !== 'effect') throw new Error('Effect node not found');
				if (!['context', 'auto', 'customAbsolute'].includes(payload.resolution.mode)) throw new Error('Invalid node resolution mode');
				if (payload.resolution.mode === 'customAbsolute' && ![payload.resolution.width, payload.resolution.height].every(value => Number.isSafeInteger(value) && value > 0)) {
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
	({ def }) => createResetParameterBinding(def),
	'reset',
);

const updateGlobalOutInputCommandDef = defineCommand<NodeTarget & { outputId: string; value: NodeOutputReference | null }>({
	label: 'Update global output input',
	changes: (_state, payload) => [{ type: 'visualModule', target: payload }],
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
	changes: (_state, payload) => [{ type: 'visualModule', target: payload }],
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
	changes: (_state, payload) => [{ type: 'visualModule', target: payload }],
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
	changes: (_state, payload) => [{ type: 'visualModule', target: payload }],
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
	changes: (_state, payload) => [{ type: 'visualModule', target: payload }],
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
	changes: (_state, payload) => [{ type: 'visualModule', target: payload }],
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
	changes: (_state, payload) => [{ type: 'visualModule', target: payload }],
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
	changes: (_state, payload) => [{ type: 'visualModule', target: payload }],
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
	changes: (_state, payload) => [{ type: 'visualModule', target: payload }],
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

type TimelineClipData = TimelineClip | TimelineAssetClip | TimelineVideoClip | TimelineSceneClip;
type TimelineClipTarget = { layerId: string; clipId: string };
type SourceDurations = Record<string, number>;

function getTimelineLayer(state: AppState, sceneId: string, layerId: string): TimelineLayer {
	const layer = getScene(state, sceneId).layers.find(layer => layer.id === layerId);
	if (!layer) throw new Error('Timeline layer not found');
	return layer;
}

function getTimelineClip(state: AppState, sceneId: string, target: TimelineClipTarget) {
	const layer = getTimelineLayer(state, sceneId, target.layerId);
	const clip = layer.clips.find(clip => clip.id === target.clipId);
	if (!clip) throw new Error('Timeline clip not found');
	return { layer, clip };
}

function requireMediaDurationMs(sourceDurationMs: number | undefined): number {
	if (sourceDurationMs == null || !Number.isFinite(sourceDurationMs) || sourceDurationMs <= 0) throw new Error('Invalid media duration');
	return sourceDurationMs;
}

function validateMediaClipTiming(clip: TimelineClip, sourceDurationMs: number | undefined) {
	if (clip.durationMs > getTimelineMediaMaxDurationMs(clip.contentOffsetMs, requireMediaDurationMs(sourceDurationMs))) throw new Error('Clip exceeds the media duration');
}

/** 異なる素材種類の混入をコマンド境界で拒否してから、型別のclips配列へ保存する。 */
function validateLayerClips(state: AppState, sceneId: string, layer: TimelineLayer, clips: readonly TimelineClipData[], sourceDurationsMs?: SourceDurations) {
	validateTimelineClips(clips);
	for (const clip of clips) {
		if (layer.layerType === 'image' || layer.layerType === 'video' || layer.layerType === 'audio') {
			if (!('assetId' in clip) || typeof clip.assetId !== 'string'
				|| !state.assets.value.some(asset => asset.id === clip.assetId && asset.fileDataType.startsWith(layer.layerType + '/'))) throw new Error('Asset type does not match the layer');
			if (layer.layerType === 'video' && (!('audioEnabled' in clip) || typeof clip.audioEnabled !== 'boolean')) throw new Error('Invalid video clip');
			if (sourceDurationsMs && layer.layerType !== 'image') validateMediaClipTiming(clip, sourceDurationsMs[clip.id]);
		} else if (layer.layerType === 'scene') {
			if (!('sceneId' in clip) || typeof clip.sceneId !== 'string' || !canReferenceScene(state.timelineScenes.value, sceneId, clip.sceneId)) throw new Error('Invalid or circular scene reference');
		}
	}
}

const addTimelineLayerCommandDef = defineCommand<{ sceneId: string; layer: TimelineLayer; sourceDurationsMs?: SourceDurations }>({
	label: 'Add timeline layer',
	changes: (_state, payload) => [{ type: 'layer', sceneId: payload.sceneId, layerId: payload.layer.id, changes: [{ type: 'definition' }] }, { type: 'layerOrder', sceneId: payload.sceneId }],
	create: payload => ({
		execute(state) {
			const scene = getScene(state, payload.sceneId);
			if (scene.layers.some(layer => layer.id === payload.layer.id)) throw new Error('Duplicate layer ID');
			if (payload.layer.layerType === 'effect') validateTimelineEffectLayer(payload.layer, effectDefinitions[payload.layer.effectId]);
			if ((payload.layer.layerType === 'video' || payload.layer.layerType === 'audio') && payload.layer.clips.length > 0 && !payload.sourceDurationsMs) throw new Error('Media duration is required');
			validateLayerClips(state, payload.sceneId, payload.layer, payload.layer.clips, payload.sourceDurationsMs);
			scene.layers.unshift(deepClone(payload.layer));
		},
		undo(state) { const scene = getScene(state, payload.sceneId); scene.layers = scene.layers.filter(layer => layer.id !== payload.layer.id); },
	}),
});

const renameTimelineLayerCommandDef = defineCommand<{ sceneId: string; layerId: string; name: string }>({
	label: 'Rename timeline layer',
	changes: (_state, payload) => [{ type: 'layerName', sceneId: payload.sceneId, layerId: payload.layerId }],
	create: payload => {
		let before: string;
		return {
			execute(state) { const layer = getTimelineLayer(state, payload.sceneId, payload.layerId); before = layer.name; layer.name = payload.name; },
			undo(state) { getTimelineLayer(state, payload.sceneId, payload.layerId).name = before; },
		};
	},
});

const changeEffectLayerResolutionCommandDef = defineCommand<{ sceneId: string; layerId: string; resolution: EffectResolution }>({
	label: 'Change effect layer resolution',
	changes: (_state, payload) => [{ type: 'layer', sceneId: payload.sceneId, layerId: payload.layerId, changes: [{ type: 'resolution' }] }],
	create: payload => {
		let before: EffectResolution;
		const getLayer = (state: AppState) => {
			const layer = getTimelineLayer(state, payload.sceneId, payload.layerId);
			if (layer.layerType !== 'effect') throw new Error('Effect layer not found');
			return layer;
		};
		return {
			execute(state) {
				validateEffectResolution(payload.resolution);
				const layer = getLayer(state);
				before = deepClone(layer.resolution);
				layer.resolution = deepClone(payload.resolution);
			},
			undo(state) { getLayer(state).resolution = deepClone(before); },
		};
	},
});

const addTimelineClipCommandDef = defineCommand<{ sceneId: string; layerId: string; clip: TimelineClipData; sourceDurationMs?: number }>({
	label: 'Add timeline clip',
	changes: (_state, payload) => [{ type: 'layer', sceneId: payload.sceneId, layerId: payload.layerId, changes: [{ type: 'clips' }] }],
	create: payload => ({
		execute(state) {
			const layer = getTimelineLayer(state, payload.sceneId, payload.layerId);
			const clips = [...layer.clips, deepClone(payload.clip)];
			validateTimelineClips(clips);
			validateLayerClips(state, payload.sceneId, layer, [payload.clip]);
			if (layer.layerType === 'video' || layer.layerType === 'audio') validateMediaClipTiming(payload.clip, payload.sourceDurationMs);
			// validateLayerClipsが保存先の種類と素材の対応を検証済み。キーや設定は変更しない。
			Object.assign(layer, { clips });
		},
		undo(state) { const layer = getTimelineLayer(state, payload.sceneId, payload.layerId); Object.assign(layer, { clips: layer.clips.filter(clip => clip.id !== payload.clip.id) }); },
	}),
});

const editTimelineClipTimingCommandDef = defineCommand<TimelineClipTarget & { sceneId: string; edge: 'start' | 'end'; deltaMs: number; sourceDurationMs?: number; initialTiming?: TimelineClipTiming }>({
	label: 'Trim timeline clip',
	changes: (_state, payload) => [{ type: 'layer', sceneId: payload.sceneId, layerId: payload.layerId, changes: [{ type: 'clips' }] }],
	create: payload => {
		let before: TimelineClipTiming;
		let after: TimelineClipTiming | undefined;
		return {
			execute(state) {
				const { layer, clip } = getTimelineClip(state, payload.sceneId, payload);
				if (after) { Object.assign(clip, after); return; }
				if (!Number.isFinite(payload.deltaMs)) throw new Error('Invalid trim');
				const media = layer.layerType === 'audio' || layer.layerType === 'video';
				// Asset一覧で短い素材へ置き換えると、現在の区間は素材長を超え得る。
				// 変更前の長さでは拒否せず、素材長自体と、修復後の区間を別々に検証する。
				const sourceDurationMs = media ? requireMediaDurationMs(payload.sourceDurationMs) : undefined;
				// ドラッグの途中でポインターを戻す操作は、確定済みクリップの左延長とは別。
				// 開始時の区間から制限し、同じドラッグ内では開始状態まで戻れるようにする。
				const initial = { ...clip, ...payload.initialTiming };
				const initialClips = layer.clips.map(entry => entry.id === clip.id ? initial : entry);
				validateTimelineClips(initialClips);
				const bounds = getTimelineClipTrimBounds(initialClips, clip.id, payload.edge, media || layer.layerType === 'scene', sourceDurationMs);
				if (bounds.minDelta > bounds.maxDelta) throw new Error('No valid clip duration within the media');
				const delta = Math.max(bounds.minDelta, Math.min(bounds.maxDelta, Math.round(payload.deltaMs)));
				before = { startMs: clip.startMs, durationMs: clip.durationMs, contentOffsetMs: clip.contentOffsetMs };
				const next = payload.edge === 'start'
					? { ...clip, startMs: initial.startMs + delta, durationMs: initial.durationMs - delta, contentOffsetMs: initial.contentOffsetMs + delta }
					: { ...clip, durationMs: initial.durationMs + delta };
				validateTimelineClips(layer.clips.map(entry => entry.id === clip.id ? next : entry));
				if (media) validateMediaClipTiming(next, payload.sourceDurationMs);
				after = { startMs: next.startMs, durationMs: next.durationMs, contentOffsetMs: next.contentOffsetMs };
				Object.assign(clip, after);
			},
			undo(state) { Object.assign(getTimelineClip(state, payload.sceneId, payload).clip, before); },
		};
	},
});

const moveTimelineClipsCommandDef = defineCommand<{ sceneId: string; clips: (TimelineClipTarget & { initialStartMs?: number })[]; deltaMs: number }>({
	label: 'Move timeline clips',
	changes: (_state, payload) => payload.clips.map(clip => ({ type: 'layer', sceneId: payload.sceneId, layerId: clip.layerId, changes: [{ type: 'clips' }] })),
	create: payload => {
		let before: (TimelineClipTarget & { startMs: number })[];
		let after: (TimelineClipTarget & { startMs: number })[] | undefined;
		return {
			execute(state) {
				// Commandのマージは最後のexecuteだけを残す。差分を再実行するとRedoが
				// 最後のpointermove一回分に縮むため、計算済みの絶対位置を復元する。
				if (after) { for (const target of after) getTimelineClip(state, payload.sceneId, target).clip.startMs = target.startMs; return; }
				if (!Number.isFinite(payload.deltaMs)) throw new Error('Invalid clip move');
				if (payload.clips.length === 0) { before = []; after = []; return; }
				if (new Set(payload.clips.map(target => JSON.stringify([target.layerId, target.clipId]))).size !== payload.clips.length) throw new Error('Duplicate clip move target');
				const entries = payload.clips.map(({ initialStartMs, ...target }) => ({ target, initialStartMs, ...getTimelineClip(state, payload.sceneId, target) }));
				// ドラッグは開始時の配置から計算する。各pointermoveの小数差分を個別に
				// 丸めて足すと、イベントの頻度によって最終位置が変わってしまうため。
				const initialClipsByLayer = new Map([...new Set(entries.map(entry => entry.layer))].map(layer => {
					const clips = layer.clips.map(clip => {
						const entry = entries.find(entry => entry.layer === layer && entry.clip === clip);
						return entry?.initialStartMs == null ? clip : { ...clip, startMs: entry.initialStartMs };
					});
					validateTimelineClips(clips);
					return [layer, clips] as const;
				}));
				const bounds = entries.map(({ layer, clip }) => getTimelineClipMoveBounds(initialClipsByLayer.get(layer)!,
					new Set(payload.clips.filter(target => target.layerId === layer.id).map(target => target.clipId)), clip.id));
				const delta = Math.max(Math.max(...bounds.map(bound => bound.minDelta)), Math.min(Math.min(...bounds.map(bound => bound.maxDelta)), Math.round(payload.deltaMs)));
				before = entries.map(({ target, clip }) => ({ ...target, startMs: clip.startMs }));
				// 全対象の制限を交差させた単一の移動量を適用する。隣を飛び越す移動も許可しない。
				// TODO: 移動区間内のレイヤーのキーフレームを追従させるオプション。
				const proposed = entries.map(({ target, clip, initialStartMs }) => ({ ...target, startMs: (initialStartMs ?? clip.startMs) + delta }));
				for (const layer of new Set(entries.map(entry => entry.layer))) {
					validateTimelineClips(layer.clips.map(clip => {
						const position = proposed.find(target => target.layerId === layer.id && target.clipId === clip.id);
						return position ? { ...clip, startMs: position.startMs } : clip;
					}));
				}
				after = proposed;
				for (const position of after) getTimelineClip(state, payload.sceneId, position).clip.startMs = position.startMs;
			},
			undo(state) { for (const target of before) getTimelineClip(state, payload.sceneId, target).clip.startMs = target.startMs; },
		};
	},
});

const removeTimelineClipsCommandDef = defineCommand<{ sceneId: string; clips: TimelineClipTarget[] }>({
	label: 'Remove timeline clips',
	changes: (_state, payload) => payload.clips.map(clip => ({ type: 'layer', sceneId: payload.sceneId, layerId: clip.layerId, changes: [{ type: 'clips' }] })),
	create: payload => {
		let before: { layerId: string; clips: TimelineClipData[] }[];
		return {
			execute(state) {
				for (const target of payload.clips) getTimelineClip(state, payload.sceneId, target);
				const layers = [...new Set(payload.clips.map(target => target.layerId))].map(id => getTimelineLayer(state, payload.sceneId, id));
				before = layers.map(layer => ({ layerId: layer.id, clips: deepClone(layer.clips) }));
				// 空になってもレイヤー・キー・合成設定を残し、次の追加で再利用できるようにする。
				for (const layer of layers) Object.assign(layer, { clips: layer.clips.filter(clip => !payload.clips.some(target => target.layerId === layer.id && target.clipId === clip.id)) });
			},
			undo(state) { for (const entry of before) Object.assign(getTimelineLayer(state, payload.sceneId, entry.layerId), { clips: deepClone(entry.clips) }); },
		};
	},
});

const changeTimelineClipSourceCommandDef = defineCommand<TimelineClipTarget & { sceneId: string; assetId?: string; referencedSceneId?: string; sourceDurationMs?: number; audioEnabled?: boolean }>({
	label: 'Change timeline clip source',
	changes: (_state, payload) => [{ type: 'layer', sceneId: payload.sceneId, layerId: payload.layerId, changes: [{ type: 'clips' }] }],
	create: payload => {
		let before: TimelineClipData;
		return {
			execute(state) {
				const { layer, clip } = getTimelineClip(state, payload.sceneId, payload);
				const media = layer.layerType === 'video' || layer.layerType === 'audio';
				if (media) requireMediaDurationMs(payload.sourceDurationMs);
				const next = { ...clip, contentOffsetMs: 0,
					durationMs: media ? getTimelineClipInsertionDuration(layer.clips.filter(entry => entry.id !== clip.id), clip.startMs, payload.sourceDurationMs) : clip.durationMs,
					...(layer.layerType === 'scene' ? { sceneId: payload.referencedSceneId } : { assetId: payload.assetId }),
					...(layer.layerType === 'video' ? { audioEnabled: payload.audioEnabled ?? ('audioEnabled' in clip && clip.audioEnabled) } : {}),
				};
				if (layer.layerType !== 'scene' && layer.layerType !== 'image' && !media) throw new Error('Layer has no clip source');
				validateTimelineClips(layer.clips.map(entry => entry.id === clip.id ? next : entry));
				// 他のクリップが参照切れでも、選択した素材の修復を妨げない。
				validateLayerClips(state, payload.sceneId, layer, [next]);
				before = deepClone(clip);
				Object.assign(clip, next);
			},
			undo(state) { Object.assign(getTimelineClip(state, payload.sceneId, payload).clip, deepClone(before)); },
		};
	},
});

const editVideoClipAudioCommandDef = defineCommand<TimelineClipTarget & { sceneId: string; audioEnabled: boolean }>({
	label: 'Edit video clip audio',
	changes: (_state, payload) => [{ type: 'layer', sceneId: payload.sceneId, layerId: payload.layerId, changes: [{ type: 'clips' }] }],
	create: payload => {
		let before: boolean;
		const find = (state: AppState) => {
			const layer = getTimelineLayer(state, payload.sceneId, payload.layerId);
			if (layer.layerType !== 'video') throw new Error('Video layer not found');
			const clip = layer.clips.find(clip => clip.id === payload.clipId);
			if (!clip) throw new Error('Video clip not found');
			return clip;
		};
		return {
			execute(state) { const clip = find(state); before = clip.audioEnabled; clip.audioEnabled = payload.audioEnabled; },
			undo(state) { find(state).audioEnabled = before; },
		};
	},
});

const pasteTimelineLayerCommandDef = defineCommand<{ sceneId: string; layer: TimelineLayer; sourceLayerId: string; sourceDurationsMs?: SourceDurations }>({
	label: 'Paste timeline layer',
	changes: (_state, payload) => [{ type: 'layer', sceneId: payload.sceneId, layerId: payload.layer.id, changes: [{ type: 'definition' }] }, { type: 'layerOrder', sceneId: payload.sceneId }],
	create: payload => ({
		execute(state) {
			if (getScene(state, payload.sceneId).layers.some(layer => layer.id === payload.layer.id)) throw new Error('Duplicate layer ID');
			if (payload.layer.layerType === 'effect') validateTimelineEffectLayer(payload.layer, effectDefinitions[payload.layer.effectId]);
			if ((payload.layer.layerType === 'video' || payload.layer.layerType === 'audio') && payload.layer.clips.length > 0 && !payload.sourceDurationsMs) throw new Error('Media duration is required');
			validateLayerClips(state, payload.sceneId, payload.layer, payload.layer.clips, payload.sourceDurationsMs);
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
	changes: (_state, payload) => [{ type: 'layerOrder', sceneId: payload.sceneId }],
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
	changes: (_state, payload) => [{ type: 'layer', sceneId: payload.sceneId, layerId: payload.layerId, changes: [{ type: 'definition' }] }, { type: 'layerOrder', sceneId: payload.sceneId }],
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

const addSceneCommandDef = defineCommand<TimelineScene>({
	label: 'Add scene',
	changes: (_state, payload) => [{ type: 'scene', sceneId: payload.id }],
	create: payload => ({
		execute(state) {
			validateTimelineScenes([...state.timelineScenes.value, payload]);
			state.timelineScenes.value.push(deepClone(payload));
		},
		undo(state) { state.timelineScenes.value = state.timelineScenes.value.filter(scene => scene.id !== payload.id); },
	}),
});

const changeProjectResolutionCommandDef = defineCommand<Resolution>({
	label: 'Change project resolution',
	changes: () => [{ type: 'projectResolution' }],
	create: payload => {
		let before: Resolution;
		return {
			execute(state) {
				if (![payload.width, payload.height].every(value => Number.isSafeInteger(value) && value > 0)) {
					throw new Error('Resolution width and height must be positive integers');
				}
				before = { ...state.resolution.value };
				state.resolution.value = { ...payload };
			},
			undo(state) { state.resolution.value = { ...before }; },
		};
	},
});

const changeSceneResolutionCommandDef = defineCommand<{ sceneId: string; resolution: TimelineSceneResolution }>({
	label: 'Change scene resolution',
	changes: (_state, payload) => [{ type: 'scene', sceneId: payload.sceneId }],
	create: payload => {
		let before: TimelineSceneResolution;
		return {
			execute(state) {
				validateSceneResolution(payload.resolution);
				const scene = getScene(state, payload.sceneId);
				before = deepClone(scene.resolution);
				scene.resolution = deepClone(payload.resolution);
			},
			undo(state) { getScene(state, payload.sceneId).resolution = deepClone(before); },
		};
	},
});

const renameSceneCommandDef = defineCommand<{ sceneId: string; name: string }>({
	label: 'Rename scene',
	changes: (_state, payload) => [{ type: 'sceneName', sceneId: payload.sceneId }],
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
	changes: (_state, payload) => [{ type: 'scene', sceneId: payload.sceneId }],
	create: payload => {
		let before: TimelineScene;
		let index: number;
		return {
			execute(state) {
				const references = state.timelineScenes.value.filter(scene => scene.layers.some(layer => layer.layerType === 'scene' && layer.clips.some(clip => clip.sceneId === payload.sceneId)));
				if (references.length > 0) throw new Error('Scene is used by: ' + references.map(scene => scene.name).join(', '));
				before = deepClone(getScene(state, payload.sceneId));
				index = state.timelineScenes.value.findIndex(scene => scene.id === payload.sceneId);
				state.timelineScenes.value.splice(index, 1);
			},
			undo(state) { state.timelineScenes.value.splice(index, 0, deepClone(before)); },
		};
	},
});

const moveTimelineKeyframesCommandDef = defineCommand<{ sceneId: string; positions: (TimelineKeyframeSelection & { x: number })[] }>({
	label: 'Move timeline keyframes',
	changes: (_state, payload) => payload.positions.map(position => ({ type: 'layer', sceneId: payload.sceneId, layerId: position.layerId,
		changes: [{ type: 'parameter', target: position.target, kind: 'value' }] })),
	create: payload => {
		let before: typeof payload.positions;
		const apply = (state: AppState, positions: typeof payload.positions) => {
			const layers = getScene(state, payload.sceneId).layers;
			const updates = positions.map(position => {
				const layer = layers.find(layer => layer.id === position.layerId);
				if (layer == null || !Number.isSafeInteger(Math.round(position.x)) || position.x < 0) throw new Error('Invalid keyframe move');
				const binding = resolveLayerParameter(state, layer, position.target, position.paramPath).value;
				const point = binding?.inputSource === 'keyframesTimelineInline' ? binding.keyframesTimeline.keyframes.find(point => point.id === position.keyframeId) : undefined;
				if (point == null) throw new Error('Timeline keyframe not found');
				return { point, position };
			});
			const previous = updates.map(({ point, position }) => ({ ...position, x: point.x }));
			for (const { point, position } of updates) point.x = Math.round(position.x);
			return previous;
		};
		return {
			execute(state) { before = apply(state, payload.positions); },
			undo(state) { apply(state, before); },
		};
	},
});

export const COMMAND_DEFS = {
	changeProjectResolution: changeProjectResolutionCommandDef,
	changeEffectLayerResolution: changeEffectLayerResolutionCommandDef,
	addTimelineLayer: addTimelineLayerCommandDef,
	renameTimelineLayer: renameTimelineLayerCommandDef,
	addTimelineClip: addTimelineClipCommandDef,
	editTimelineClipTiming: editTimelineClipTimingCommandDef,
	moveTimelineClips: moveTimelineClipsCommandDef,
	removeTimelineClips: removeTimelineClipsCommandDef,
	changeTimelineClipSource: changeTimelineClipSourceCommandDef,
	editVideoClipAudio: editVideoClipAudioCommandDef,
	moveTimelineKeyframes: moveTimelineKeyframesCommandDef,
	addScene: addSceneCommandDef,
	changeSceneResolution: changeSceneResolutionCommandDef,
	renameScene: renameSceneCommandDef,
	removeScene: removeSceneCommandDef,
	pasteTimelineLayer: pasteTimelineLayerCommandDef,
	reorderTimelineLayers: reorderTimelineLayersCommandDef,
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
