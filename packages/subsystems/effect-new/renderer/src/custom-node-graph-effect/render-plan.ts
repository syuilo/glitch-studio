import { walkParameterLeaves } from '@gs/shared/parameter/parameter-tree.ts';
import { getArrayElementDefinition, getStructFieldDefinitions } from '@gs/shared/parameter/parameter-definition.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { EffectDefinition } from '@gs/subsystems_effect-new_shared/effect-definition.ts';
import type { CustomNodeGraphEffect, CustomNodeGraphEffectNode, GraphOutputBinding, GraphParameterBinding } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import type { EffectRenderInstance } from '../effect-render-instance.ts';

export type NodePlacement = {
	node: CustomNodeGraphEffectNode;
	definition: EffectDefinition;
	resolution: Resolution;
	instance: EffectRenderInstance;
};

/** PUBLICはCPU上の値のみを公開する。GPU入力・音声を含むコンテナは値全体を式に渡せない。 */
export function isExpressionPublicParameter(definition: ParameterDefinition): boolean {
	if (definition.canNode === true || definition.dataType.kind === 'audioSource') return false;
	if (definition.dataType.kind === 'array') return isExpressionPublicParameter(getArrayElementDefinition(definition));
	if (definition.dataType.kind === 'struct') return Object.values(getStructFieldDefinitions(definition)).every(isExpressionPublicParameter);
	return true;
}

function mayReadPublicParameters(definition: ParameterDefinition, binding: GraphParameterBinding | undefined): boolean {
	if (binding?.type === 'publicParameter') return false;
	// 未接続の子出力を入力にしたときも、その入力の既定値を使う。複合型では既定値の子に式を持てる。
	const value = binding?.type === 'value' ? binding.binding : definition.defaultValue;
	for (const { param } of walkParameterLeaves<ValueParameterBinding>({ value: definition }, { value })) {
		if (param.inputSource === 'expression' || param.expressionModifier?.enabled === true) return true;
	}
	return false;
}

export function createRenderPlan(customNodeGraphEffect: CustomNodeGraphEffect, placements: readonly NodePlacement[], expressionParameterIds: ReadonlySet<string>, outputIds: ReadonlySet<string>) {
	const requiredParameters = new Set<string>();
	const requiredNodeOutputs = new Map<string, Set<string>>();
	const steps: { placement: NodePlacement; outputIds: ReadonlySet<string>; parameterIds: ReadonlySet<string> }[] = [];
	const requireSource = (source: GraphOutputBinding) => {
		if (source.type === 'publicParameter') {
			requiredParameters.add(source.parameterId);
		} else {
			const outputs = requiredNodeOutputs.get(source.nodeId) ?? new Set<string>();
			outputs.add(source.outputId);
			requiredNodeOutputs.set(source.nodeId, outputs);
		}
	};
	for (const id of outputIds) {
		if (!Object.hasOwn(customNodeGraphEffect.outputDefs, id)) throw new Error(`Unknown Custom Node Graph Effect output: ${id}`);
		if (Object.hasOwn(customNodeGraphEffect.outputs, id)) requireSource(customNodeGraphEffect.outputs[id]);
	}
	let needsExpressionScope = false;
	// 逆依存順に調べると、ノードへ到達した時点で全消費者の要求ポートが確定する。
	// 子もグラフなら、今回読む子の公開入力だけを親の配線へたどる。
	for (let index = placements.length - 1; index >= 0; index--) {
		const placement = placements[index];
		const outputs = requiredNodeOutputs.get(placement.node.id);
		if (outputs == null) continue;
		const parameterIds = placement.instance.getRequiredParameterIds?.(outputs) ?? new Set(Object.keys(placement.definition.paramDefs));
		for (const id of parameterIds) {
			const binding = Object.hasOwn(placement.node.params, id) ? placement.node.params[id] : undefined;
			if (binding != null && binding.type !== 'value') requireSource(binding);
			if (!needsExpressionScope && mayReadPublicParameters(placement.definition.paramDefs[id], binding)) needsExpressionScope = true;
		}
		steps.push({ placement, outputIds: outputs, parameterIds });
	}
	if (needsExpressionScope) {
		// PUBLICの引数は動的に決まるため、式が実行し得る枝では全ての公開CPU値を渡す。
		// 画像・音声は式に公開せず、使わない上流をレンダリングしない。
		for (const id of expressionParameterIds) requiredParameters.add(id);
	}
	return { steps: steps.reverse(), requiredParameters };
}
