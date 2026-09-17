import { effectDefinitions } from '@glitch/shared/effect-definitions.ts';
import { AiSON } from '@syuilo/aiscript';
import { deepClone } from '@glitch/shared/utility/deep-clone.ts';
import { getNodeInputDataType, getNodeOutputs } from '@glitch/shared/utility/node-outputs.ts';
import { genEmptyValue } from '@glitch/shared/utility/misc.ts';
import type { AppState } from './types.ts';
import type { Asset, EffectParamDataType, EffectParamDefs, GsEffectNode, GsGroupNode, GsNode, Player, NodeOutputReference } from '@glitch/shared/types.ts';
import { canConnectNodeDataTypes } from '@/utility/node-outputs.ts';

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

const stateUtility = {
	findNode: (state: AppState, nodeId: string): GsNode | undefined => {
		const search = (nodes: GsNode[]): GsNode | undefined => {
			for (const node of nodes) {
				if (node.id === nodeId) {
					return node;
				}
				if (node.type === 'group') {
					const found = search(node.nodes);
					if (found) {
						return found;
					}
				}
			}
		};
		return search(state.nodes.value);
	},
};

const updateGroupNameCommandDef = defineCommand<{ nodeId: GsGroupNode['id']; name: string }>({
	label: 'Rename group',
	create: (payload) => {
		let before: string;
		return {
			execute(state) {
				const group = stateUtility.findNode(state, payload.nodeId) as GsGroupNode;
				before = group.name;
				group.name = payload.name;
			},
			undo(state) {
				const group = stateUtility.findNode(state, payload.nodeId) as GsGroupNode;
				group.name = before;
			},
		};
	},
});

const addEffectNodeCommandDef = defineCommand<{ id: string; effectId: string; params?: Record<string, any>; groupId?: string }>({
	label: 'Add fx node',
	create: (payload) => {
		return {
			execute(state) {
				const paramDefs = effectDefinitions[payload.effectId].paramDefs as EffectParamDefs;
				const group = payload.groupId ? stateUtility.findNode(state, payload.groupId) as GsGroupNode : undefined;
				const previous = (group ? group.nodes : state.nodes.value).at(-1);

				const params = {} as GsEffectNode['params'];

				for (const [k, v] of Object.entries(paramDefs)) {
					params[k] = v.default();

					// 直前のノードに自動接続
					if (v.primary && previous != null) {
						const port = Object.entries(getNodeOutputs(previous)).find(([, output]) => output.primary && canConnectNodeDataTypes(output.dataType, getNodeInputDataType(v)))?.[0];
						if (port != null) params[k] = { type: 'node', nodeId: previous.id, outputPort: port };
					}
				}

				if (group) {
					group.nodes.push({
						id: payload.id,
						isBypass: false,
						type: 'effect',
						effectId: payload.effectId,
						params: {
							...params,
							...deepClone(payload.params ?? {}),
						},
						pos: { x: 0, y: 0 },
					});
				} else {
					state.nodes.value.push({
						id: payload.id,
						isBypass: false,
						type: 'effect',
						effectId: payload.effectId,
						params: {
							...params,
							...deepClone(payload.params ?? {}),
						},
						pos: { x: 0, y: 0 },
					});
				}
			},

			undo(state) {
				const group = payload.groupId ? stateUtility.findNode(state, payload.groupId) as GsGroupNode : undefined;
				if (group) {
					group.nodes = group.nodes.filter(node => node.id !== payload.id);
				} else {
					state.nodes.value = state.nodes.value.filter(node => node.id !== payload.id);
				}
			},
		};
	},
});

const moveNodeCommandDef = defineCommand<{ nodeId: string; groupId: string | null; index: number }>({
	label: 'Move node',
	create: (payload) => {
		let before: { groupId: string | null; index: number };
		const getNodes = (state: AppState, groupId: string | null): GsNode[] => {
			if (groupId === null) return state.nodes.value;
			const group = stateUtility.findNode(state, groupId);
			if (group?.type !== 'group') throw new Error('Group not found');
			return group.nodes;
		};
		const findLocation = (nodes: GsNode[], groupId: string | null = null): typeof before | undefined => {
			for (const [index, node] of nodes.entries()) {
				if (node.id === payload.nodeId) return { groupId, index };
				if (node.type === 'group') {
					const found = findLocation(node.nodes, node.id);
					if (found) return found;
				}
			}
		};
		return {
			execute(state) {
				const location = findLocation(state.nodes.value);
				if (!location) throw new Error('Node not found');
				before = location;
				const source = getNodes(state, before.groupId);
				const destination = getNodes(state, payload.groupId);
				const [node] = source.splice(before.index, 1);
				destination.splice(payload.index, 0, node);
			},
			undo(state) {
				const source = getNodes(state, payload.groupId);
				const destination = getNodes(state, before.groupId);
				const index = source.findIndex(node => node.id === payload.nodeId);
				if (index === -1) throw new Error('Node not found');
				const [node] = source.splice(index, 1);
				destination.splice(before.index, 0, node);
			},
		};
	},
});

const removeNodeCommandDef = defineCommand<{ nodeId: string }>({
	label: 'Remove node',
	create: (payload) => {
		let before: GsNode[];
		return {
			execute(state) {
				// ノードの削除と接続の変更を一つの操作としてUndoできるように保存する。
				before = deepClone(state.nodes.value);
				const removedNode = stateUtility.findNode(state, payload.nodeId);
				if (removedNode == null) return;
				const primary = removedNode.type === 'effect'
					? Object.entries(effectDefinitions[removedNode.effectId].paramDefs).find(([, def]) => def.type === 'node' && def.primary)
					: undefined;
				const input = removedNode.type === 'effect' && primary ? removedNode.params[primary[0]] : undefined;
				// UIでは式を評価できないため、静的に指定されている主入力だけを接続先に使う。
				const connection = input?.type === 'literal' ? input.value : input?.type === 'node' && input.nodeId != null ? { nodeId: input.nodeId, outputPort: input.outputPort } : null;
				const replacement: NodeOutputReference | null = connection?.nodeId != null && connection.nodeId !== payload.nodeId ? connection : null;
				const removedIds = new Set<string>();
				const collectRemovedIds = (node: GsNode) => {
					removedIds.add(node.id);
					if (node.type === 'group') node.nodes.forEach(collectRemovedIds);
				};
				collectRemovedIds(removedNode);
				const reconnect = (nodes: GsNode[]) => {
					for (const node of nodes) {
						if (removedIds.has(node.id)) continue;
						if (node.type === 'group') {
							reconnect(node.nodes);
							continue;
						}
						for (const [key, param] of Object.entries(node.params)) {
							const def = effectDefinitions[node.effectId].paramDefs[key];
							const replacementOutput = replacement == null ? undefined : getNodeOutputs(stateUtility.findNode(state, replacement.nodeId))[replacement.outputPort];
							const compatibleReplacement = canConnectNodeDataTypes(replacementOutput?.dataType, getNodeInputDataType(def)) ? replacement : null;
							// A → B → CのBを削除したら、Cの参照をAへ書き換える。
							// 主入力のないFXやグループ（子も含む）の削除では未接続にする。
							if (def.type === 'node' && param.type === 'literal' && removedIds.has(param.value?.nodeId)) {
								node.params[key] = { type: 'literal', value: deepClone(compatibleReplacement) };
							} else if ((def.type === 'node' || def.canNode) && param.type === 'node' && param.nodeId != null && removedIds.has(param.nodeId)) {
								node.params[key] = compatibleReplacement ? { type: 'node', ...deepClone(compatibleReplacement) } : { type: 'node', nodeId: null, outputPort: null };
							}
						}
					}
				};
				reconnect(state.nodes.value);
				const treat = (src: GsNode) => {
					if (src.type === 'group') {
						for (const node of src.nodes) {
							if (node.id === payload.nodeId) {
								src.nodes = src.nodes.filter(node => node.id !== payload.nodeId);
								return true;
							}
							if (treat(node)) return true;
						}
					}
				};
				if (state.nodes.value.some(node => node.id === payload.nodeId)) {
					state.nodes.value = state.nodes.value.filter(node => node.id !== payload.nodeId);
				} else {
					for (const node of state.nodes.value) {
						treat(node);
					}
				}
			},
			undo(state) {
				state.nodes.value = deepClone(before);
			},
		};
	},
});

const addGroupNodeCommandDef = defineCommand<{ id: string; groupId?: GsGroupNode['id'] }>({
	label: 'Add group node',
	create: (payload) => {
		return {
			execute(state) {
				if (payload.groupId) {
					const group = state.nodes.value.find(node => node.id === payload.groupId) as GsGroupNode;
					group.nodes.push({
						id: payload.id,
						isBypass: false,
						type: 'group',
						nodes: [],
						macros: [],
						name: '',
						pos: { x: 0, y: 0 },
					});
				} else {
					state.nodes.value.push({
						id: payload.id,
						isBypass: false,
						type: 'group',
						nodes: [],
						macros: [],
						name: '',
						pos: { x: 0, y: 0 },
					});
				}
			},
			undo(state) {
				state.nodes.value = state.nodes.value.filter(node => node.id !== payload.id);
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
					data: deepClone(payload.data),
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
	create: (payload) => {
		return {
			execute(state) {
				state.assets.value = state.assets.value.filter(asset => asset.id !== payload.assetId);

				// そのAssetを参照しているパラメータをnullにする
				for (const node of state.nodes.value) {
					if (node.type === 'effect') {
						const imageParams = Object.entries(effectDefinitions[node.effectId].paramDefs).filter(([k, v]) => v.type === 'image').map(([k, v]) => k);
						for (const p of imageParams) {
							if (node.params[p].type === 'literal' && node.params[p].value === payload.assetId) {
								node.params[p].value = null;
							}
						}
					}
				}

				// そのAssetを参照しているマクロをnullにする
				for (const macro of state.macros.value.filter(m => m.type === 'image' && m.value.type === 'literal')) {
					macro.value.value = null;
				}
			},
			undo(state) {
				// TODO
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
				asset.data = deepClone(payload.data);
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

const updatePlayerTypeCommandDef = defineCommand<{ playerId: Player['id']; type: Player['type'] }>({
	label: 'Update player type',
	create: (payload) => {
		let previousType: Player['type'];
		return {
			execute(state) {
				const player = state.players.value.find(player => player.id === payload.playerId)!;
				previousType = player.type;
				player.type = payload.type;
			},
			undo(state) {
				const player = state.players.value.find(player => player.id === payload.playerId)!;
				player.type = previousType;
			},
		};
	},
});

const addMacroCommandDef = defineCommand<{ groupId?: GsGroupNode['id']; id: string; }>({
	label: 'Add macro',
	create: (payload) => {
		return {
			execute(state) {
				const group = state.nodes.value.find(node => node.id === payload.groupId) as GsGroupNode;
				(group ? group.macros : state.macros.value).push({
					id: payload.id,
					type: 'number',
					typeOptions: {},
					label: 'Macro',
					name: 'macro',
					value: {
						type: 'literal',
						value: 0,
					},
				});
			},
			undo(state) {
				state.macros.value = state.macros.value.filter(macro => macro.id !== payload.id);
			},
		};
	},
});

const removeMacroCommandDef = defineCommand<{ groupId?: GsGroupNode['id']; macroId: string }>({
	label: 'Remove macro',
	create: (payload) => {
		return {
			execute(state) {
				const group = state.nodes.value.find(node => node.id === payload.groupId) as GsGroupNode;
				if (group) {
					group.macros = group.macros.filter(macro => macro.id !== payload.macroId);
				} else {
					state.macros.value = state.macros.value.filter(macro => macro.id !== payload.macroId);
				}
			},
			undo(state) {
				// TODO
			},
		};
	},
});

const toggleMacroValueTypeCommandDef = defineCommand<{ groupId?: GsGroupNode['id']; macroId: string }>({
	label: 'Toggle macro value type',
	create: (payload) => {
		return {
			execute(state) {
				const group = state.nodes.value.find(node => node.id === payload.groupId) as GsGroupNode;
				const macro = (group ? group.macros : state.macros.value).find(macro => macro.id === payload.macroId)!;
				const isLiteral = macro.value.type === 'literal';
				if (isLiteral) {
					macro.value = {
						type: 'expression',
						expression: '',
					};
				} else {
					macro.value = {
						type: 'literal',
						value: genEmptyValue(macro),
					};
				}
			},
			undo(state) {
				// TODO
			},
		};
	},
});

const updateMacroAsLiteralCommandDef = defineCommand<{ groupId?: GsGroupNode['id']; macroId: string; value: any }>({
	label: 'Update macro as literal',
	create: (payload) => {
		return {
			execute(state) {
				const group = state.nodes.value.find(node => node.id === payload.groupId) as GsGroupNode;
				const macro = (group ? group.macros : state.macros.value).find(macro => macro.id === payload.macroId)!;
				macro.value = {
					type: 'literal',
					value: deepClone(payload.value),
				};
			},
			undo(state) {
				// TODO
			},
		};
	},
});

const updateMacroAsExpressionCommandDef = defineCommand<{ groupId?: GsGroupNode['id']; macroId: string; value: any }>({
	label: 'Update macro as expression',
	create: (payload) => {
		return {
			execute(state) {
				const group = state.nodes.value.find(node => node.id === payload.groupId) as GsGroupNode;
				const macro = (group ? group.macros : state.macros.value).find(macro => macro.id === payload.macroId)!;
				macro.value = {
					type: 'expression',
					expression: payload.value,
				};
			},
			undo(state) {
				// TODO
			},
		};
	},
});

const updateMacroLabelCommandDef = defineCommand<{ groupId?: GsGroupNode['id']; macroId: string; value: string }>({
	label: 'Update macro label',
	create: (payload) => {
		return {
			execute(state) {
				const group = state.nodes.value.find(node => node.id === payload.groupId) as GsGroupNode;
				const macro = (group ? group.macros : state.macros.value).find(macro => macro.id === payload.macroId)!;
				macro.label = payload.value;
			},
			undo(state) {
				// TODO
			},
		};
	},
});

const updateMacroNameCommandDef = defineCommand<{ groupId?: GsGroupNode['id']; macroId: string; value: string }>({
	label: 'Update macro name',
	create: (payload) => {
		return {
			execute(state) {
				const group = state.nodes.value.find(node => node.id === payload.groupId) as GsGroupNode;
				const macro = (group ? group.macros : state.macros.value).find(macro => macro.id === payload.macroId)!;
				macro.name = payload.value;
			},
			undo(state) {
				// TODO
			},
		};
	},
});

const updateMacroTypeCommandDef = defineCommand<{ groupId?: GsGroupNode['id']; macroId: string; value: EffectParamDataType }>({
	label: 'Update macro type',
	create: (payload) => {
		return {
			execute(state) {
				const group = state.nodes.value.find(node => node.id === payload.groupId) as GsGroupNode;
				const macro = (group ? group.macros : state.macros.value).find(macro => macro.id === payload.macroId)!;
				macro.type = payload.value;
				macro.value = {
					type: 'literal',
					value: genEmptyValue(macro),
				};
			},
			undo(state) {
				// TODO
			},
		};
	},
});

const updateMacroTypeOptionCommandDef = defineCommand<{ groupId?: GsGroupNode['id']; macroId: string; key: string; value: any }>({
	label: 'Update macro type option',
	create: (payload) => {
		return {
			execute(state) {
				const group = state.nodes.value.find(node => node.id === payload.groupId) as GsGroupNode;
				const macro = (group ? group.macros : state.macros.value).find(macro => macro.id === payload.macroId)!;
				macro.typeOptions[payload.key] = deepClone(payload.value);
			},
			undo(state) {
				// TODO
			},
		};
	},
});

// TODO: 別のtypeの設定値を失わない(内部的には持ったまま)ようにする
const changeParamValueTypeCommandDef = defineCommand<{ nodeId: GsNode['id']; param: string; type: 'literal' | 'expression' | 'automation' | 'node' }>({
	label: 'Change param value type',
	create: (payload) => {
		let before: GsEffectNode['params'][string];
		return {
			execute(state) {
				const node = stateUtility.findNode(state, payload.nodeId)! as GsEffectNode;
				before = deepClone(node.params[payload.param]);
				const currentValue = node.params[payload.param];
				const defaultValue: GsEffectNode['params'][string] = effectDefinitions[node.effectId].paramDefs[payload.param].default();
				const emptyValue = genEmptyValue(effectDefinitions[node.effectId].paramDefs[payload.param]);
				if (payload.type === 'expression') {
					node.params[payload.param] = {
						type: 'expression',
						expression: currentValue.type === 'literal' ? AiSON.stringify(currentValue.value) : defaultValue.type === 'literal' ? AiSON.stringify(defaultValue.value) : AiSON.stringify(emptyValue),
					};
				} else if (payload.type === 'literal') {
					node.params[payload.param] = {
						type: 'literal',
						value: defaultValue.type === 'literal' ? deepClone(defaultValue.value) : emptyValue,
					};
				} else if (payload.type === 'automation') {
					node.params[payload.param] = {
						type: 'automation',
						automationId: null,
					};
				} else if (payload.type === 'node') {
					node.params[payload.param] = {
						type: 'node',
						nodeId: null,
						outputPort: null,
					};
				}
			},
			undo(state) {
				const node = stateUtility.findNode(state, payload.nodeId) as GsEffectNode;
				node.params[payload.param] = deepClone(before);
			},
		};
	},
});

const updateParamAsLiteralCommandDef = defineCommand<{ nodeId: GsNode['id']; param: string; value: any }>({
	label: 'Update param as literal',
	create: (payload) => {
		let before: GsEffectNode['params'][string];
		return {
			execute(state) {
				const node = stateUtility.findNode(state, payload.nodeId) as GsEffectNode;
				before = deepClone(node.params[payload.param]);
				node.params[payload.param] = {
					type: 'literal',
					value: deepClone(payload.value),
				};
			},
			undo(state) {
				const node = stateUtility.findNode(state, payload.nodeId) as GsEffectNode;
				node.params[payload.param] = deepClone(before);
			},
		};
	},
});

const updateParamAsExpressionCommandDef = defineCommand<{ nodeId: GsNode['id']; param: string; value: any }>({
	label: 'Update param as expression',
	create: (payload) => {
		return {
			execute(state) {
				const node = stateUtility.findNode(state, payload.nodeId) as GsEffectNode;
				node.params[payload.param] = {
					type: 'expression',
					expression: payload.value,
				};
			},
			undo(state) {
				// TODO
			},
		};
	},
});

const updateParamAsAutomationCommandDef = defineCommand<{ nodeId: GsNode['id']; param: string; value: any }>({
	label: 'Update param as automation',
	create: (payload) => {
		return {
			execute(state) {
				const node = stateUtility.findNode(state, payload.nodeId) as GsEffectNode;
				node.params[payload.param] = {
					type: 'automation',
					automationId: payload.value,
				};
			},
			undo(state) {
				// TODO
			},
		};
	},
});

const updateParamAsNodeCommandDef = defineCommand<{ nodeId: GsNode['id']; param: string; value: NodeOutputReference | null }>({
	label: 'Update param as node',
	create: (payload) => {
		let before: GsEffectNode['params'][string];
		return {
			execute(state) {
				const node = stateUtility.findNode(state, payload.nodeId) as GsEffectNode;
				before = deepClone(node.params[payload.param]);
				node.params[payload.param] = payload.value == null
					? { type: 'node', nodeId: null, outputPort: null }
					: { type: 'node', ...deepClone(payload.value) };
			},
			undo(state) {
				const node = stateUtility.findNode(state, payload.nodeId) as GsEffectNode;
				node.params[payload.param] = deepClone(before);
			},
		};
	},
});

const changeNodeBypassStateCommandDef = defineCommand<{ nodeId: GsNode['id']; bypass: boolean }>({
	label: 'Change node bypass state',
	create: (payload) => {
		return {
			execute(state) {
				const node = stateUtility.findNode(state, payload.nodeId) as GsEffectNode;
				node.isBypass = payload.bypass;
			},
			undo(state) {
				const node = stateUtility.findNode(state, payload.nodeId) as GsEffectNode;
				node.isBypass = !payload.bypass;
			},
		};
	},
});

const resetNodeParamCommandDef = defineCommand<{ nodeId: GsNode['id']; param: string }>({
	label: 'Reset node param',
	create: (payload) => {
		let before: GsEffectNode['params'][string];
		return {
			execute(state) {
				const node = stateUtility.findNode(state, payload.nodeId) as GsEffectNode;
				before = deepClone(node.params[payload.param]);
				const defaultValue: GsEffectNode['params'][string] = effectDefinitions[node.effectId].paramDefs[payload.param].default();
				node.params[payload.param] = deepClone(defaultValue);
			},
			undo(state) {
				const node = stateUtility.findNode(state, payload.nodeId) as GsEffectNode;
				node.params[payload.param] = deepClone(before);
			},
		};
	},
});

export const COMMAND_DEFS = {
	addEffectNode: addEffectNodeCommandDef,
	moveNode: moveNodeCommandDef,
	removeNode: removeNodeCommandDef,
	addGroupNode: addGroupNodeCommandDef,
	updateGroupName: updateGroupNameCommandDef,
	addAsset: addAssetCommandDef,
	removeAsset: removeAssetCommandDef,
	renameAsset: renameAssetCommandDef,
	replaceAsset: replaceAssetCommandDef,
	addPlayer: addPlayerCommandDef,
	updatePlayerType: updatePlayerTypeCommandDef,
	addMacro: addMacroCommandDef,
	removeMacro: removeMacroCommandDef,
	toggleMacroValueType: toggleMacroValueTypeCommandDef,
	updateMacroAsLiteral: updateMacroAsLiteralCommandDef,
	updateMacroAsExpression: updateMacroAsExpressionCommandDef,
	updateMacroLabel: updateMacroLabelCommandDef,
	updateMacroName: updateMacroNameCommandDef,
	updateMacroType: updateMacroTypeCommandDef,
	updateMacroTypeOption: updateMacroTypeOptionCommandDef,
	changeParamValueType: changeParamValueTypeCommandDef,
	updateParamAsLiteral: updateParamAsLiteralCommandDef,
	updateParamAsExpression: updateParamAsExpressionCommandDef,
	updateParamAsAutomation: updateParamAsAutomationCommandDef,
	updateParamAsNode: updateParamAsNodeCommandDef,
	changeNodeBypassState: changeNodeBypassStateCommandDef,
	resetNodeParam: resetNodeParamCommandDef,
};
