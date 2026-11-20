import { createResolutionExpressionVariables } from '@gs/shared/expression/resolution-variables.ts';
import { prepareExpressionParameterValue } from '@gs/shared/parameter/expression-parameter-value.ts';
import { deepEqual } from '@gs/shared/utility/deep-equal.ts';
import type { ParameterBindingEvaluator } from '@gs/shared/parameter/parameter-binding-evaluator.ts';
import type { ParameterEvaluationScope } from '@gs/shared/parameter/parameter-evaluation-scope.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import { isUnselectedGraphParameterReference, type CustomNodeGraphEffect } from '@gs/subsystems_effect-new_shared/custom-node-graph-effect.ts';
import type { EffectFrameContext } from './effect-instance.ts';

export type ReadFrameValue = (frame: EffectFrameContext) => unknown;

function resolveName(ids: ReadonlyMap<string, string>, args: unknown[], functionName: string): string {
	if (args.length !== 1 || typeof args[0] !== 'string') throw new Error(functionName + ' requires a parameter name');
	const id = ids.get(args[0]);
	if (id == null) throw new Error(functionName + ': unknown parameter ' + args[0]);
	return id;
}

/** 親の共通座標を同じ画像参照位置に保ったまま、ノードの縦横比に換算する。 */
export function createEffectFrameMapper(root: Resolution, node: Resolution): (frame: EffectFrameContext) => EffectFrameContext {
	if (root.width * node.height === root.height * node.width) return frame => frame;
	const ratio = Math.max(root.width, root.height) / Math.max(node.width, node.height);
	const x = node.width / root.width * ratio;
	const y = node.height / root.height * ratio;
	const convert = (value: readonly [number, number]): [number, number] => [value[0] * x, value[1] * y];
	return frame => ({ ...frame, pointerPosition: frame.pointerPosition == null || (frame.pointerPosition[0] <= -999 && frame.pointerPosition[1] <= -999)
		? frame.pointerPosition : convert(frame.pointerPosition), pointerVector: frame.pointerVector == null ? frame.pointerVector : convert(frame.pointerVector) });
}

/** 名前は配置に固定し、共有値の評価器は編集時に差し替える。動的なCUSTOM呼出しは実際の経路で循環を検出する。 */
export function createGraphEvaluation(graph: Pick<CustomNodeGraphEffect, 'paramDefs' | 'customParameterDefs' | 'customParameterValues' | 'automationGraphs'>, evaluator: ParameterBindingEvaluator,
	publicReader: (id: string) => ReadFrameValue) {
	const publicIds = new Map<string, string>();
	const publicValues = new Map<string, ReadFrameValue>();
	const customIds = new Map<string, string>();
	const customValues = new Map<string, unknown>();
	const nodeScopes = new Map<Resolution, (frame: EffectFrameContext) => ParameterEvaluationScope>();
	let customScope: ParameterEvaluationScope;
	let customScopeFrame: EffectFrameContext | null = null;
	const customReaders = new Map<string, ReadFrameValue>();
	let previousCustomParameterValues: CustomNodeGraphEffect['customParameterValues'];
	const visiting = new Set<string>();
	let currentFrame: EffectFrameContext | null = null;
	for (const [id, def] of Object.entries(graph.paramDefs)) {
		if (def.canNode !== true && def.dataType.kind !== 'audioSource') publicIds.set(def.nameForReference ?? id, id);
	}
	const customDefinitions = Object.entries(graph.customParameterDefs ?? {});
	for (const [id, def] of customDefinitions) customIds.set(def.nameForReference, id);

	function updateCustomParameterValues(values: CustomNodeGraphEffect['customParameterValues']) {
		let changed = false;
		for (const [id, def] of customDefinitions) {
			const selected = values?.[id];
			if (customReaders.has(id) && deepEqual(previousCustomParameterValues?.[id], selected)) continue;
			changed = true;
			const binding = selected == null || isUnselectedGraphParameterReference(selected) ? def.defaultValue : selected;
			if (binding.inputSource === 'customNodeGraphEffectPublicParameterReference') customReaders.set(id, frame => readPublic(binding.parameterId, frame));
			else if (binding.inputSource === 'customNodeGraphEffectCustomParameterValueReference') customReaders.set(id, frame => readCustom(binding.parameterId, frame));
			else {
				const read = evaluator.bind(binding, def.defaultValue.value, def, graph.automationGraphs ?? []);
				customReaders.set(id, frame => {
					if (customScopeFrame !== frame) {
						customScope = scope(frame);
						customScopeFrame = frame;
					}
					return read(customScope);
				});
			}
		}
		previousCustomParameterValues = values;
		if (changed) customValues.clear();
		return changed;
	}

	updateCustomParameterValues(graph.customParameterValues);

	function readPublic(id: string, frame: EffectFrameContext): unknown {
		const read = publicValues.get(id);
		if (read == null) throw new Error('Unknown or unavailable public parameter: ' + id);
		return structuredClone(read(frame));
	}

	function readCustom(id: string, frame: EffectFrameContext): unknown {
		if (currentFrame !== frame) { currentFrame = frame; customValues.clear(); }
		if (customValues.has(id)) return structuredClone(customValues.get(id));
		const def = graph.customParameterDefs?.[id];
		if (def == null) throw new Error('Unknown custom parameter: ' + id);
		if (visiting.has(id)) throw new Error('Circular custom parameter reference: ' + [...visiting, id].join(' → '));
		visiting.add(id);
		try {
			const result = prepareExpressionParameterValue(def, customReaders.get(id)!(frame));
			customValues.set(id, result);
			return structuredClone(result);
		} finally { visiting.delete(id); }
	}

	function scope(frame: EffectFrameContext, dimensions?: ReturnType<typeof createResolutionExpressionVariables>, nodeFrame = frame): ParameterEvaluationScope {
		const time = frame.time * 1000;
		const endTime = (frame.endTime ?? Infinity) * 1000;
		return {
			time, endTime, automationGraphs: graph.automationGraphs ?? [],
			variables: {
				TIME: frame.time, TIME_MS: time, END_TIME: endTime / 1000, END_TIME_MS: endTime,
				PROGRESS: frame.progress ?? (endTime === 0 ? 0 : time / endTime), IS_EXPORT: frame.isExport ?? false,
				...(dimensions == null ? {} : { ...dimensions, POINTER_POSITION: [...(nodeFrame.pointerPosition ?? [-99999, -99999])] }),
			},
			functions: {
				PUBLIC: (...args) => readPublic(resolveName(publicIds, args, 'PUBLIC'), frame),
				CUSTOM: (...args) => readCustom(resolveName(customIds, args, 'CUSTOM'), frame),
			},
		};
	}

	function nodeScope(root: Resolution, node: Resolution) {
		const existing = nodeScopes.get(node);
		if (existing != null) return existing;
		const map = createEffectFrameMapper(root, node);
		const dimensions = createResolutionExpressionVariables(node);
		let previous: EffectFrameContext | null = null;
		let result: ParameterEvaluationScope;
		const read = (frame: EffectFrameContext) => {
			if (previous !== frame) {
				result = scope(frame, dimensions, map(frame));
				previous = frame;
			}
			return result;
		};
		nodeScopes.set(node, read);
		return read;
	}

	return {
		nodeScope, readCustom, updateCustomParameterValues, automationGraphs: graph.automationGraphs ?? [],
		bindPublicValues() {
			for (const id of publicIds.values()) publicValues.set(id, publicReader(id));
		},
	};
}
