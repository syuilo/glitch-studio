import { effectDefinitions } from '@glitch/shared/effect-definitions.ts';
import { AiSON } from '@syuilo/aiscript';
import { deepClone } from '@glitch/shared/utility/deep-clone.ts';
import { getNodeInputDataType, getNodeOutputs } from '@glitch/shared/utility/node-outputs.ts';
import { genEmptyValue } from '@glitch/shared/utility/misc.ts';
import type { AppState } from './types.ts';
import type { Asset, EffectParamDataType, EffectParamDefs, EffectParamValue, GsEffectNode, GsGroupNode, GsNode, Player, NodeOutputReference } from '@glitch/shared/types.ts';
import type { NodeParamTarget } from '@/utility/node-params.ts';
import { canConnectNodeDataTypes } from '@/utility/node-outputs.ts';
import { resolveNodeParam, walkNodeParams } from '@/utility/node-params.ts';

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
					? [...walkNodeParams(removedNode)].find(({ def }) => def.type !== 'struct' && def.type !== 'array' && def.canNode && 'primary' in def && def.primary)
					: undefined;
				// UIでは式を評価できないため、静的に指定されている主入力だけを接続先に使う。
				const input = primary?.value;
				const replacement: NodeOutputReference | null = input?.type === 'node' && input.nodeId != null && input.nodeId !== payload.nodeId
					? { nodeId: input.nodeId, outputPort: input.outputPort } : null;
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
						for (const { path, def, value } of walkNodeParams(node)) {
							if (def.type === 'struct' || def.type === 'array' || !def.canNode || value.type !== 'node' || value.nodeId == null || !removedIds.has(value.nodeId)) continue;
							const replacementOutput = replacement == null || removedIds.has(replacement.nodeId) ? undefined : getNodeOutputs(stateUtility.findNode(state, replacement.nodeId))[replacement.outputPort];
							const compatibleReplacement = canConnectNodeDataTypes(replacementOutput?.dataType, getNodeInputDataType(def)) ? replacement : null;
							// A → B → CのBを削除したら、ネスト内の参照もAへ書き換える。
							resolveNodeParam(node, path).setValue(compatibleReplacement
								? { type: 'node', ...deepClone(compatibleReplacement) }
								: { type: 'node', nodeId: null, outputPort: null });
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

				// そのAssetを参照しているパラメータをnullにする。
				const clearAssetReferences = (nodes: GsNode[]) => {
					for (const node of nodes) {
						if (node.type === 'group') {
							clearAssetReferences(node.nodes);
						} else {
							for (const { path, def, value } of walkNodeParams(node)) {
								if (def.type === 'image' && value.type === 'literal' && value.value === payload.assetId) {
									resolveNodeParam(node, path).setValue({ type: 'literal', value: null });
								}
							}
						}
					}
				};
				clearAssetReferences(state.nodes.value);

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

// 対象は実行・Undoのたびに解決する。配列の置換やUndo後の古い参照を保持しない。
function defineNodeParamCommand<Payload extends NodeParamTarget>(
	label: string,
	update: (target: ReturnType<typeof resolveNodeParam>, payload: Payload) => EffectParamValue,
) {
	return defineCommand<Payload>({
		label,
		create: payload => {
			let before: EffectParamValue;
			let after: EffectParamValue | undefined;
			return {
				execute(state) {
					const node = stateUtility.findNode(state, payload.nodeId);
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
					const node = stateUtility.findNode(state, payload.nodeId);
					if (node?.type !== 'effect') throw new Error('Effect node not found');
					resolveNodeParam(node, payload.paramPath).setValue(deepClone(before));
				},
			};
		},
	});
}

function assertLeafParam(target: ReturnType<typeof resolveNodeParam>) {
	if (target.def.type === 'array' || target.def.type === 'struct') {
		throw new Error('Struct and array containers cannot change value type');
	}
}

// TODO: 別のtypeの設定値を失わない(内部的には持ったまま)ようにする
const changeParamValueTypeCommandDef = defineNodeParamCommand<NodeParamTarget & { type: EffectParamValue['type'] }>(
	'Change param value type',
	(target, payload) => {
		assertLeafParam(target);
		const currentValue = target.value;
		const defaultValue = target.def.default();
		const emptyValue = genEmptyValue(target.def);
		switch (payload.type) {
			case 'expression': return {
				type: 'expression',
				expression: AiSON.stringify(currentValue.type === 'literal' ? currentValue.value : defaultValue.type === 'literal' ? defaultValue.value : emptyValue),
			};
			case 'literal': return { type: 'literal', value: defaultValue.type === 'literal' ? defaultValue.value : emptyValue };
			case 'automation': return { type: 'automation', automationId: null };
			case 'node': {
				if (!('canNode' in target.def) || !target.def.canNode) throw new Error('Parameter does not support node input');
				return { type: 'node', nodeId: null, outputPort: null };
			}
		}
	},
);

const updateParamAsLiteralCommandDef = defineNodeParamCommand<NodeParamTarget & { value: any }>(
	'Update param as literal',
	(target, payload) => {
		assertLeafParam(target);
		return { type: 'literal', value: payload.value };
	},
);

const updateParamAsExpressionCommandDef = defineNodeParamCommand<NodeParamTarget & { value: string }>(
	'Update param as expression',
	(target, payload) => {
		assertLeafParam(target);
		return { type: 'expression', expression: payload.value };
	},
);

const updateParamAsAutomationCommandDef = defineNodeParamCommand<NodeParamTarget & { value: string | null }>(
	'Update param as automation',
	(target, payload) => {
		assertLeafParam(target);
		return { type: 'automation', automationId: payload.value };
	},
);

const updateParamAsNodeCommandDef = defineNodeParamCommand<NodeParamTarget & { value: NodeOutputReference | null }>(
	'Update param as node',
	(target, payload) => {
		assertLeafParam(target);
		if (!('canNode' in target.def) || !target.def.canNode) throw new Error('Parameter does not support node input');
		return payload.value == null ? { type: 'node', nodeId: null, outputPort: null } : { type: 'node', ...payload.value };
	},
);

const addArrayParamElementCommandDef = defineNodeParamCommand<NodeParamTarget>(
	'Add array parameter element',
	({ def, value }) => {
		if (def.type !== 'array' || value.type !== 'literal' || !Array.isArray(value.value)) throw new Error('Expected array parameter');
		const element = def.item.default();
		return { type: 'literal', value: [...value.value, element] };
	},
);

const removeArrayParamElementCommandDef = defineNodeParamCommand<NodeParamTarget & { index: number }>(
	'Remove array parameter element',
	({ def, value }, { index }) => {
		if (def.type !== 'array' || value.type !== 'literal' || !Array.isArray(value.value)) throw new Error('Expected array parameter');
		if (!Number.isInteger(index) || index < 0 || index >= value.value.length) throw new Error('Invalid array index');
		return { type: 'literal', value: value.value.filter((_, i) => i !== index) };
	},
);

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

const resetNodeParamCommandDef = defineNodeParamCommand<NodeParamTarget>(
	'Reset node param',
	({ def }) => def.default(),
);

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
	addArrayParamElement: addArrayParamElementCommandDef,
	removeArrayParamElement: removeArrayParamElementCommandDef,
};
