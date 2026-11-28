import { walkParameters } from '@gs/shared/parameter/parameter-path.ts';
import { isValueParameterBinding } from '@gs/shared/parameter/parameter-binding.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { FunctionCurve } from '@gs/shared/function-curve/function-curve.ts';
import type { NativeEffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { NodesEffect, NodesEffectParameterBinding } from '@gs/subsystems_effect_shared/nodes-effect.ts';
import type { NodesEffectResources } from '@gs/glitch-studio_shared/nodes-effect-resources.ts';
import type { NodesEffectEditorMetadata } from '@gs/glitch-studio_shared/project/types.ts';
import type { PortableNodesEffectParameterFeature } from './parameter-features.ts';

export type PortableNodesEffectRuntimeRequirements = {
	effectIds: string[];
	requiresExpressions: boolean;
	requiresCustomShaderEffects: boolean;
	parameterFeatures: PortableNodesEffectParameterFeature[];
};

export type PortableNodesEffectExecutionTarget = 'worker' | 'mainThread';

export type PortableNodesEffectRuntimeBuildRequest = PortableNodesEffectRuntimeRequirements & {
	executionTarget: PortableNodesEffectExecutionTarget;
};

/**
 * 式から動的に参照されるCUSTOMの値も扱えるよう、スナップショットに含む全配置を調べる。
 * 同じ登録のNodes Effectの内部は一度で十分だが、各配置の入力は個別に調べる。
 */
export function analyzePortableNodesEffectRuntime(resources: NodesEffectResources, nativeDefinitions: Readonly<Record<string, NativeEffectDefinition>>) {
	const shaders = new Map(resources.customShaderEffects.map(entry => [entry.id, entry]));
	const nodesEffects = new Map(resources.nodesEffects.map(entry => [entry.id, entry]));
	const visited = new Set<NodesEffect>();
	const effectIds = new Set<string>();
	const parameterFeatures = new Set<PortableNodesEffectParameterFeature>();
	const resolutionNodes: string[] = [];
	let requiresExpressions = false;
	let requiresCustomShaderEffects = false;

	function addCurve(curve: FunctionCurve) {
		parameterFeatures.add(curve.type === 'bezier' ? 'bezier' : 'fixedFunctionCurve');
		if (curve.type === 'easing') parameterFeatures.add('easing');
	}

	function analyzeExpression(code: string, scope: NodesEffect) {
		requiresExpressions = true;
		// 関数値の別名やexistsによる参照も拾う。文字列・コメント中の同名語は保守的に残す。
		if (/\bRANDOM\b/.test(code)) parameterFeatures.add('random');
		if (/\bNOISE\b/.test(code)) parameterFeatures.add('noise');
		if (/\bFUNCTION_CURVE\b/.test(code)) {
			parameterFeatures.add('functionCurveExpression');
			// 名前は実行時の公開値やカスタム値で選べるので、式の所属するスコープ全体を対象にする。
			for (const curve of scope.functionCurves ?? []) addCurve(curve);
		}
	}

	function analyzeBindings(definitions: Readonly<Record<string, ParameterDefinition>>, bindings: Readonly<Record<string, NodesEffectParameterBinding>>, scope: NodesEffect) {
		// 省略された入力と外から変更できる公開値は末端までliteralなので、配置にあるBindingだけを調べる。
		for (const [key, binding] of Object.entries(bindings)) {
			for (const { value: param } of walkParameters<NodesEffectParameterBinding>({ [key]: definitions[key] }, { [key]: binding })) {
				if (!isValueParameterBinding(param)) continue;
				if (param.inputSource === 'expression') analyzeExpression(param.expression, scope);
				if (param.expressionModifier?.enabled === true) analyzeExpression(param.expressionModifier.code, scope);
				if (param.inputSource === 'keyframesTimelineInline') {
					parameterFeatures.add('keyframes');
					if (param.keyframesTimeline.keyframes.some(keyframe => keyframe.interpolation.type.startsWith('ease:'))) parameterFeatures.add('easing');
				}
				if (param.inputSource === 'curveAnimationInline') {
					parameterFeatures.add('curveAnimation');
					const curveBinding = param.curveAnimation.curveBinding;
					const curve = curveBinding.source === 'inline' ? curveBinding.curve : scope.functionCurves?.find(candidate => candidate.id === curveBinding.curveId);
					if (curve != null) addCurve(curve);
				}
			}
		}
	}

	function visit(nodesEffect: NodesEffect, metadata?: NodesEffectEditorMetadata) {
		if (visited.has(nodesEffect)) return;
		visited.add(nodesEffect);
		analyzeBindings(nodesEffect.customParameterDefs ?? {}, nodesEffect.customParameterValues ?? {}, nodesEffect);
		for (const node of nodesEffect.nodes) {
			if (node.type === 'relay') continue;
			const source = node.effectSource;
			const editor = metadata?.nodeMetadata?.[node.id];
			let definition;
			let name = node.id;
			switch (source.type) {
				case 'nativeEffect':
					effectIds.add(source.id);
					definition = nativeDefinitions[source.id];
					name = definition.displayName;
					break;
				case 'inlineCustomShaderEffect':
					requiresCustomShaderEffects = true;
					definition = source.customShaderEffect;
					break;
				case 'customShaderEffectReference': {
					requiresCustomShaderEffects = true;
					const entry = shaders.get(source.id)!;
					definition = entry.definition;
					name = entry.name;
					break;
				}
				case 'inlineNodesEffect':
					definition = source.nodesEffect;
					visit(definition, editor?.inlineNodesEffect);
					break;
				case 'nodesEffectReference': {
					const entry = nodesEffects.get(source.id)!;
					definition = entry.definition;
					name = entry.name;
					visit(definition, entry);
					break;
				}
			}
			analyzeBindings(definition.paramDefs, node.params, nodesEffect);
			const size = node.resolution;
			if (size == null ? definition.intrinsicResolutionSetting != null || definition.resolutionInputParameters.length > 0
				: !('mode' in size) || size.mode !== 'context' || size.scale !== 1) resolutionNodes.push(editor?.displayName || name);
		}
	}

	visit(resources.nodesEffect, resources);
	const runtimeRequirements: PortableNodesEffectRuntimeRequirements = {
		effectIds: [...effectIds].sort(), requiresExpressions, requiresCustomShaderEffects, parameterFeatures: [...parameterFeatures].sort(),
	};
	return { runtimeRequirements, resolutionNodes };
}
