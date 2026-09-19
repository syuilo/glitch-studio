import { effectDefinitions } from '@glitch/shared/effect-definitions.ts';
import { AiSON } from '@syuilo/aiscript';
import { deepClone } from '@glitch/shared/utility/deep-clone.ts';
import { getNodeInputDataType, getNodeOutputs } from '@glitch/shared/utility/node-outputs.ts';
import { genEmptyValue } from '@glitch/shared/utility/misc.ts';
import type { AppState } from './types.ts';
import type { Asset, EffectParamDataType, EffectParamDefs, EffectParamValue, GsEffectNode, GsNode, Player, NodeOutputReference, VisualModule } from '@glitch/shared/types.ts';
import type { NodeParamTarget as EffectNodeParamTarget } from '@/utility/node-params.ts';
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

type NodeTarget = { visualModuleId: string; nodeId: string };
type NodeParamTarget = EffectNodeParamTarget & { visualModuleId: string };

const stateUtility = {
	getVisualModule: (state: AppState, visualModuleId: string) => {
		const visualModule = state.visualModules.value.find(visualModule => visualModule.id === visualModuleId);
		if (visualModule == null) throw new Error('Node visualModule not found');
		return visualModule;
	},
	findNode: (state: AppState, target: NodeTarget): GsNode | undefined => {
		return stateUtility.getVisualModule(state, target.visualModuleId).nodes.find(node => node.id === target.nodeId);
	},
};

const addEffectNodeCommandDef = defineCommand<{ visualModuleId: string; id: string; effectId: string; params?: Record<string, EffectParamValue> }>({
	label: 'Add fx node',
	create: payload => {
		let addedNode: GsEffectNode | undefined;
		let outputConnection: {
			nodeId: string;
			before: { nodeId: string; outputPort: string } | { nodeId: null; outputPort: null };
			after: { nodeId: string; outputPort: string };
		} | undefined;
		return {
			execute(state) {
				const visualModule = stateUtility.getVisualModule(state, payload.visualModuleId);
				if (addedNode == null) {
					const paramDefs = effectDefinitions[payload.effectId].paramDefs as EffectParamDefs;
					const globalOut = visualModule.nodes.find(node => node.type === 'globalOut');
					const previousInput = globalOut?.input;
					const previous = previousInput?.nodeId == null ? undefined : visualModule.nodes.find(node => node.id === previousInput.nodeId);
					const params: GsEffectNode['params'] = {};
					for (const [key, def] of Object.entries(paramDefs)) {
						params[key] = def.default();
						if (def.primary && previousInput?.nodeId != null) {
							// 元の接続が副出力でも、その出力ポートをそのまま引き継ぐ。
							const output = getNodeOutputs(previous)[previousInput.outputPort];
							if (canConnectNodeDataTypes(output?.dataType, getNodeInputDataType(def))) {
								params[key] = { type: 'node', ...deepClone(previousInput) };
							}
						}
					}
					// ランダムな初期値や自動接続もRedo時に変えない。
					addedNode = { id: payload.id, type: 'effect', effectId: payload.effectId, isBypass: false,
																			params: { ...params, ...deepClone(payload.params ?? {}) }, pos: { x: 0, y: 0 } };
					const outputPort = Object.entries(getNodeOutputs(addedNode)).find(([, output]) => output.primary && canConnectNodeDataTypes(output.dataType, 'color'))?.[0];
					if (globalOut != null && outputPort != null) {
						outputConnection = {
							nodeId: globalOut.id,
							before: deepClone(globalOut.input),
							after: { nodeId: addedNode.id, outputPort },
						};
					}
				}
				const outputIndex = visualModule.nodes.findIndex(node => node.type === 'globalOut');
				visualModule.nodes.splice(outputIndex < 0 ? visualModule.nodes.length : outputIndex, 0, deepClone(addedNode));
				if (outputConnection != null) {
					const globalOut = visualModule.nodes.find(node => node.id === outputConnection.nodeId);
					if (globalOut?.type === 'globalOut') globalOut.input = deepClone(outputConnection.after);
				}
			},
			undo(state) {
				const visualModule = stateUtility.getVisualModule(state, payload.visualModuleId);
				visualModule.nodes = visualModule.nodes.filter(node => node.id !== payload.id);
				if (outputConnection != null) {
					const globalOut = visualModule.nodes.find(node => node.id === outputConnection.nodeId);
					if (globalOut?.type === 'globalOut') globalOut.input = deepClone(outputConnection.before);
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
			const nodes = stateUtility.getVisualModule(state, payload.visualModuleId).nodes;
			const source = nodes.findIndex(node => node.id === payload.nodeId);
			if (source < 0) throw new Error('Node not found');
			if (!Number.isInteger(index) || index < 0 || index >= nodes.length) throw new Error('Invalid node index');
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
		let before: GsNode[];
		return {
			execute(state) {
				const visualModule = stateUtility.getVisualModule(state, payload.visualModuleId);
				before = deepClone(visualModule.nodes);
				const removedNode = stateUtility.findNode(state, payload);
				if (removedNode == null) return;
				const primary = removedNode.type === 'effect'
					? [...walkNodeParams(removedNode)].find(({ def }) => def.type !== 'struct' && def.type !== 'array' && def.canNode && 'primary' in def && def.primary)
					: undefined;
				const input = primary?.value;
				const replacement: NodeOutputReference | null = input?.type === 'node' && input.nodeId != null && input.nodeId !== payload.nodeId
					? { nodeId: input.nodeId, outputPort: input.outputPort } : null;
				const replacementOutput = replacement == null ? undefined : getNodeOutputs(visualModule.nodes.find(node => node.id === replacement.nodeId))[replacement.outputPort];
				// 削除したノードの主入力へ接続し直す。globalOutの参照も同じ操作で復元可能にする。
				for (const node of visualModule.nodes) {
					if (node.id === payload.nodeId) continue;
					if (node.type === 'globalOut') {
						if (node.input.nodeId === payload.nodeId) {
							node.input = replacement != null && canConnectNodeDataTypes(replacementOutput?.dataType, 'color')
								? deepClone(replacement) : { nodeId: null, outputPort: null };
						}
						continue;
					}
					if (node.type !== 'effect') continue;
					for (const { path, def, value } of walkNodeParams(node)) {
						if (def.type === 'struct' || def.type === 'array' || !def.canNode || value.type !== 'node' || value.nodeId !== payload.nodeId) continue;
						const compatible = replacement != null && canConnectNodeDataTypes(replacementOutput?.dataType, getNodeInputDataType(def));
						resolveNodeParam(node, path).setValue(compatible
							? { type: 'node', ...deepClone(replacement) }
							: { type: 'node', nodeId: null, outputPort: null });
					}
				}
				visualModule.nodes = visualModule.nodes.filter(node => node.id !== payload.nodeId);
			},
			undo(state) {
				stateUtility.getVisualModule(state, payload.visualModuleId).nodes = deepClone(before);
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
	create: payload => {
		let before: {
			assets: Asset[];
			visualModules: { id: string; nodes: GsNode[] }[];
			macros: AppState['macros']['value'];
		};
		return {
			execute(state) {
				before = {
					assets: deepClone(state.assets.value),
					visualModules: state.visualModules.value.map(visualModule => ({ id: visualModule.id, nodes: deepClone(visualModule.nodes) })),
					macros: deepClone(state.macros.value),
				};
				state.assets.value = state.assets.value.filter(asset => asset.id !== payload.assetId);
				// Assetはプロジェクト共有なので、全VisualModuleの参照を解除する。
				for (const visualModule of state.visualModules.value) {
					for (const node of visualModule.nodes) {
						if (node.type !== 'effect') continue;
						for (const { path, def, value } of walkNodeParams(node)) {
							if (def.type === 'image' && value.type === 'literal' && value.value === payload.assetId) {
								resolveNodeParam(node, path).setValue({ type: 'literal', value: null });
							}
						}
					}
				}
				for (const macro of state.macros.value) {
					if (macro.type === 'image' && macro.value.type === 'literal' && macro.value.value === payload.assetId) {
						macro.value = { type: 'literal', value: null };
					}
				}
			},
			undo(state) {
				state.assets.value = deepClone(before.assets);
				for (const visualModule of before.visualModules) {
					stateUtility.getVisualModule(state, visualModule.id).nodes = deepClone(visualModule.nodes);
				}
				state.macros.value = deepClone(before.macros);
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

const addMacroCommandDef = defineCommand<{ id: string; }>({
	label: 'Add macro',
	create: (payload) => {
		return {
			execute(state) {
				state.macros.value.push({
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

const removeMacroCommandDef = defineCommand<{ macroId: string }>({
	label: 'Remove macro',
	create: (payload) => {
		return {
			execute(state) {
				state.macros.value = state.macros.value.filter(macro => macro.id !== payload.macroId);
			},
			undo(state) {
				// TODO
			},
		};
	},
});

const toggleMacroValueTypeCommandDef = defineCommand<{ macroId: string }>({
	label: 'Toggle macro value type',
	create: (payload) => {
		return {
			execute(state) {
				const macro = state.macros.value.find(macro => macro.id === payload.macroId)!;
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

const updateMacroAsLiteralCommandDef = defineCommand<{ macroId: string; value: any }>({
	label: 'Update macro as literal',
	create: (payload) => {
		return {
			execute(state) {
				const macro = state.macros.value.find(macro => macro.id === payload.macroId)!;
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

const updateMacroAsExpressionCommandDef = defineCommand<{ macroId: string; value: any }>({
	label: 'Update macro as expression',
	create: (payload) => {
		return {
			execute(state) {
				const macro = state.macros.value.find(macro => macro.id === payload.macroId)!;
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

const updateMacroLabelCommandDef = defineCommand<{ macroId: string; value: string }>({
	label: 'Update macro label',
	create: (payload) => {
		return {
			execute(state) {
				const macro = state.macros.value.find(macro => macro.id === payload.macroId)!;
				macro.label = payload.value;
			},
			undo(state) {
				// TODO
			},
		};
	},
});

const updateMacroNameCommandDef = defineCommand<{ macroId: string; value: string }>({
	label: 'Update macro name',
	create: (payload) => {
		return {
			execute(state) {
				const macro = state.macros.value.find(macro => macro.id === payload.macroId)!;
				macro.name = payload.value;
			},
			undo(state) {
				// TODO
			},
		};
	},
});

const updateMacroTypeCommandDef = defineCommand<{ macroId: string; value: EffectParamDataType }>({
	label: 'Update macro type',
	create: (payload) => {
		return {
			execute(state) {
				const macro = state.macros.value.find(macro => macro.id === payload.macroId)!;
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

const updateMacroTypeOptionCommandDef = defineCommand<{ macroId: string; key: string; value: any }>({
	label: 'Update macro type option',
	create: (payload) => {
		return {
			execute(state) {
				const macro = state.macros.value.find(macro => macro.id === payload.macroId)!;
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
			case 'macro': return { type: 'macro', macroId: '' };
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

const updateParamAsMacroCommandDef = defineNodeParamCommand<NodeParamTarget & { value: string }>(
	'Update param as macro',
	(target, payload) => {
		assertLeafParam(target);
		return { type: 'macro', macroId: payload.value };
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

const resetNodeParamCommandDef = defineNodeParamCommand<NodeParamTarget>(
	'Reset node param',
	({ def }) => def.default(),
);

const updateGlobalOutInputCommandDef = defineCommand<NodeTarget & { value: NodeOutputReference | null }>({
	label: 'Update global output input',
	create: payload => {
		let before: { nodeId: string; outputPort: string } | { nodeId: null; outputPort: null };
		return {
			execute(state) {
				const node = stateUtility.findNode(state, payload);
				if (node?.type !== 'globalOut') throw new Error('Global output node not found');
				if (payload.value != null) {
					const source = stateUtility.findNode(state, { visualModuleId: payload.visualModuleId, nodeId: payload.value.nodeId });
					if (getNodeOutputs(source)[payload.value.outputPort] == null) throw new Error('Node output not found in this visualModule');
				}
				before = deepClone(node.input);
				node.input = payload.value == null ? { nodeId: null, outputPort: null }
					: { nodeId: payload.value.nodeId, outputPort: payload.value.outputPort };
			},
			undo(state) {
				const node = stateUtility.findNode(state, payload);
				if (node?.type !== 'globalOut') throw new Error('Global output node not found');
				node.input = deepClone(before);
			},
		};
	},
});

type VisualModuleParamDef = VisualModule['paramDefs'][number];

function validateVisualModuleParamDef(module: VisualModule, def: VisualModuleParamDef, previousId?: string) {
	if (module.paramDefs.some(item => item.id !== previousId && (item.id === def.id || item.name === def.name))) {
		throw new Error('Parameter ID and name must be unique');
	}
	if (def.isPrimaryInput && (!def.canNode || def.type !== 'color'
		|| module.paramDefs.some(item => item.id !== previousId && item.isPrimaryInput))) {
		throw new Error('Only one node-capable color parameter can be the primary input');
	}
}

const addVisualModuleParamDefCommandDef = defineCommand<{ visualModuleId: string; def: VisualModuleParamDef }>({
	label: 'Add visual module parameter',
	create: payload => ({
		execute(state) {
			const module = stateUtility.getVisualModule(state, payload.visualModuleId);
			validateVisualModuleParamDef(module, payload.def);
			module.paramDefs.push(deepClone(payload.def));
		},
		undo(state) {
			const module = stateUtility.getVisualModule(state, payload.visualModuleId);
			module.paramDefs = module.paramDefs.filter(def => def.id !== payload.def.id);
		},
	}),
});

const removeVisualModuleParamDefCommandDef = defineCommand<{ visualModuleId: string; defId: string }>({
	label: 'Remove visual module parameter',
	create: payload => {
		let before: VisualModuleParamDef;
		let index: number;
		return {
			execute(state) {
				const module = stateUtility.getVisualModule(state, payload.visualModuleId);
				index = module.paramDefs.findIndex(def => def.id === payload.defId);
				if (index < 0) throw new Error('Visual module parameter not found');
				before = deepClone(module.paramDefs[index]);
				// 参照IDやレイヤーの値は保持する。未解決になった参照はUndoで再び有効になる。
				module.paramDefs.splice(index, 1);
			},
			undo(state) {
				stateUtility.getVisualModule(state, payload.visualModuleId).paramDefs.splice(index, 0, deepClone(before));
			},
		};
	},
});

const updateVisualModuleParamDefCommandDef = defineCommand<{
	visualModuleId: string; defId: string; changes: Partial<Omit<VisualModuleParamDef, 'id'>>;
}>({
	label: 'Update visual module parameter',
	create: payload => {
		let before: VisualModuleParamDef;
		return {
			execute(state) {
				const module = stateUtility.getVisualModule(state, payload.visualModuleId);
				const index = module.paramDefs.findIndex(def => def.id === payload.defId);
				if (index < 0) throw new Error('Visual module parameter not found');
				const next = { ...module.paramDefs[index], ...deepClone(payload.changes), id: payload.defId };
				validateVisualModuleParamDef(module, next, payload.defId);
				before = deepClone(module.paramDefs[index]);
				module.paramDefs[index] = next;
			},
			undo(state) {
				const module = stateUtility.getVisualModule(state, payload.visualModuleId);
				const index = module.paramDefs.findIndex(def => def.id === payload.defId);
				if (index < 0) throw new Error('Visual module parameter not found');
				module.paramDefs[index] = deepClone(before);
			},
		};
	},
});

const updateGlobalInParamCommandDef = defineCommand<NodeTarget & { paramId: string }>({
	label: 'Update global input parameter',
	create: payload => {
		let before: string;
		return {
			execute(state) {
				const module = stateUtility.getVisualModule(state, payload.visualModuleId);
				const node = stateUtility.findNode(state, payload);
				if (node?.type !== 'globalIn') throw new Error('Global input node not found');
				if (!module.paramDefs.some(def => def.id === payload.paramId && def.canNode)) throw new Error('Node-capable parameter not found');
				before = node.paramId;
				node.paramId = payload.paramId;
			},
			undo(state) {
				const node = stateUtility.findNode(state, payload);
				if (node?.type !== 'globalIn') throw new Error('Global input node not found');
				node.paramId = before;
			},
		};
	},
});

export const COMMAND_DEFS = {
	addVisualModuleParamDef: addVisualModuleParamDefCommandDef,
	removeVisualModuleParamDef: removeVisualModuleParamDefCommandDef,
	updateVisualModuleParamDef: updateVisualModuleParamDefCommandDef,
	updateGlobalInParam: updateGlobalInParamCommandDef,
	updateGlobalOutInput: updateGlobalOutInputCommandDef,
	addEffectNode: addEffectNodeCommandDef,
	moveNode: moveNodeCommandDef,
	removeNode: removeNodeCommandDef,
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
	updateParamAsMacro: updateParamAsMacroCommandDef,
	changeNodeBypassState: changeNodeBypassStateCommandDef,
	resetNodeParam: resetNodeParamCommandDef,
	addArrayParamElement: addArrayParamElementCommandDef,
	removeArrayParamElement: removeArrayParamElementCommandDef,
};
