import { areDataTypesEqual, isTextureDataType } from '@gs/shared/data-type/data-type.ts';
import { areNodeDataTypesCompatible, getNodeInputDataType } from '@gs/shared/data-type/node-compatibility.ts';
import { getArrayElementDefinition, getStructFieldDefinitions } from '@gs/shared/parameter/parameter-definition.ts';
import { validateEffectValueBinding } from '../validate-effect-definition.ts';
import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { EffectDefinition } from '../effect-definition.ts';
import type { EffectReference } from '../effect-reference.ts';
import type { CustomNodeGraphEffect, GraphOutputBinding, GraphParameterBinding } from './custom-node-graph-effect.ts';

function canForwardPublicParameter(source: ParameterDefinition, target: ParameterDefinition): boolean {
	// 値全体を子へ渡す場合、コンテナの各末端にもCPU/GPU境界がある。
	// 子が数値を要求するフィールドへテクスチャが入るような配線を静的に検出する。
	if (source.dataType.kind === 'array' && target.dataType.kind === 'array') {
		return areDataTypesEqual(source.dataType.elementType, target.dataType.elementType)
			&& canForwardPublicParameter(getArrayElementDefinition(source), getArrayElementDefinition(target));
	}
	if (source.dataType.kind === 'struct' && target.dataType.kind === 'struct') {
		const sourceFields = getStructFieldDefinitions(source);
		const targetFields = getStructFieldDefinitions(target);
		return areDataTypesEqual(source.dataType, target.dataType)
			&& Object.entries(sourceFields).every(([id, field]) => canForwardPublicParameter(field, targetFields[id]));
	}
	if (target.canNode === true && isTextureDataType(source.dataType)) {
		return areNodeDataTypesCompatible(source.dataType, getNodeInputDataType(target));
	}
	return source.canNode !== true && areDataTypesEqual(source.dataType, target.dataType);
}

export function validateCustomNodeGraphEffect(customNodeGraphEffect: CustomNodeGraphEffect, resolveChild: (reference: EffectReference) => EffectDefinition): void {
	const definitions = new Map<string, EffectDefinition>();
	const upstreamNodes = new Map<string, string[]>();
	for (const node of customNodeGraphEffect.nodes) {
		if (node.id.length === 0 || definitions.has(node.id)) throw new Error(`Empty or duplicate node ID: ${node.id}`);
		if (node.resolution != null && ![node.resolution.width, node.resolution.height].every(size => Number.isSafeInteger(size) && size > 0)) {
			throw new Error(`Invalid node resolution: ${node.id}`);
		}
		definitions.set(node.id, resolveChild(node.effect));
		upstreamNodes.set(node.id, []);
	}

	function getPublicParameter(id: string): ParameterDefinition {
		if (!Object.hasOwn(customNodeGraphEffect.paramDefs, id)) throw new Error(`Unknown public parameter: ${id}`);
		return customNodeGraphEffect.paramDefs[id];
	}

	function getSpatialSource(binding: GraphOutputBinding): TextureDataType | null {
		if (binding.type === 'publicParameter') return getNodeInputDataType(getPublicParameter(binding.parameterId));
		const definition = definitions.get(binding.nodeId);
		if (definition == null || !Object.hasOwn(definition.outputDefs, binding.outputId)) {
			throw new Error(`Unknown node output: ${binding.nodeId}.${binding.outputId}`);
		}
		return definition.outputDefs[binding.outputId].dataType;
	}

	function validateInput(nodeId: string, parameter: ParameterDefinition, binding: GraphParameterBinding): void {
		if (binding.type === 'value') {
			validateEffectValueBinding(parameter, binding.binding);
			return;
		}
		const inputType = getNodeInputDataType(parameter);
		if (binding.sampling != null) {
			const { fitMode, wrapMode, filterMode } = binding.sampling;
			if (inputType == null || !['stretch', 'contain', 'cover'].includes(fitMode) || !['clamp', 'transparent', 'repeat', 'repeatMirrored'].includes(wrapMode) || !['linear', 'nearest'].includes(filterMode)) {
				throw new Error(`Invalid input sampling: ${nodeId}.${parameter.ui.label}`);
			}
		}
		if (binding.type === 'publicParameter') {
			const source = getPublicParameter(binding.parameterId);
			if (!canForwardPublicParameter(source, parameter)) throw new Error(`Incompatible input: ${nodeId}.${parameter.ui.label}`);
			return;
		} else if (binding.type === 'nodeOutput') {
			upstreamNodes.get(nodeId)!.push(binding.nodeId);
		} else {
			throw new Error(`Unknown node binding: ${nodeId}`);
		}
		if (!areNodeDataTypesCompatible(getSpatialSource(binding), inputType)) throw new Error(`Incompatible input: ${nodeId}.${parameter.ui.label}`);
	}

	for (const node of customNodeGraphEffect.nodes) {
		const definition = definitions.get(node.id)!;
		for (const [id, binding] of Object.entries(node.params)) {
			if (!Object.hasOwn(definition.paramDefs, id)) throw new Error(`Unknown node parameter: ${node.id}.${id}`);
			validateInput(node.id, definition.paramDefs[id], binding);
		}
	}
	for (const [id, binding] of Object.entries(customNodeGraphEffect.outputs)) {
		if (!Object.hasOwn(customNodeGraphEffect.outputDefs, id)) throw new Error(`Unknown public output: ${id}`);
		if (!areNodeDataTypesCompatible(getSpatialSource(binding), customNodeGraphEffect.outputDefs[id].dataType)) throw new Error(`Incompatible public output: ${id}`);
	}

	// 定義の入れ子とは別に、一つの定義内の配線だけでも循環し得る。未接続の枝も設定変更時に検査する。
	const visited = new Set<string>();
	const active = new Set<string>();

	function visit(nodeId: string): void {
		if (active.has(nodeId)) throw new Error(`Node wiring cycle: ${[...active, nodeId].join(' -> ')}`);
		if (visited.has(nodeId)) return;
		active.add(nodeId);
		for (const upstreamId of upstreamNodes.get(nodeId)!) visit(upstreamId);
		active.delete(nodeId);
		visited.add(nodeId);
	}

	for (const id of definitions.keys()) visit(id);
}
