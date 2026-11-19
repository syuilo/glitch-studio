import { ParameterBindingEvaluator } from '@gs/shared/parameter/parameter-binding-evaluator.ts';
import { coerceParameterValue } from '@gs/shared/parameter/coerce-parameter-value.ts';
import { validateEnumParameterValue } from '@gs/shared/parameter/parameter-definition.ts';
import { prepareExpressionParameterValue } from '@gs/shared/parameter/expression-parameter-value.ts';
import { areDataTypesEqual } from '@gs/shared/data-type/data-type.ts';
import { canReadPublicParameterInExpression } from './custom-node-graph-effect/public-parameter.ts';
import { createEvaluatedEffectInput, createLiteralBindingInput } from './effect-input.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { ParameterEvaluationScope } from '@gs/shared/parameter/parameter-evaluation-scope.ts';
import type { CustomNodeGraphEffect, CustomNodeGraphEffectValueParameterBinding } from '@gs/subsystems_effect-new_shared/custom-node-graph-effect/types.ts';
import type { EffectEnvironment, EffectFrame, EffectParameterInput } from './effect-instance.ts';

type ReadValue = (frame: EffectFrame) => unknown;

function publicCpuReader(input: EffectParameterInput): ReadValue {
	switch (input.kind) {
		case 'value': return input.read;
		case 'array': {
			const elements = input.elements.map(publicCpuReader);
			return frame => elements.map(read => read(frame));
		}
		case 'struct': {
			const fields = Object.entries(input.fields).map(([key, field]) => [key, publicCpuReader(field)] as const);
			return frame => Object.fromEntries(fields.map(([key, read]) => [key, read(frame)]));
		}
		default: throw new Error('Image parameters cannot be read by expressions');
	}
}

// フレームをキーにすることで、同じ時刻を再評価する場合も別の入力や履歴を使える。
function oncePerFrame<T>(read: (frame: EffectFrame) => T): (frame: EffectFrame) => T {
	let lastFrame: EffectFrame | null = null;
	let value: T;
	return frame => {
		if (lastFrame !== frame) {
			value = read(frame);
			lastFrame = frame;
		}
		return value;
	};
}

export function createCustomNodeGraphEffectParameterEvaluator(
	graph: Pick<CustomNodeGraphEffect, 'paramDefs' | 'customParameterDefs' | 'customParameterValues' | 'automationGraphs'>,
	getPublicInput: (id: string) => EffectParameterInput, environment: EffectEnvironment,
) {
	const { resolveAudioSource, expressionEngine } = environment;
	const evaluator = new ParameterBindingEvaluator(expressionEngine ?? null);
	const publicDefinitions = new Map<string, ParameterDefinition>(graph.paramDefs.map(def => [def.id, def]));
	const customDefinitions = new Map<string, typeof graph.customParameterDefs[number]>(graph.customParameterDefs.map(def => [def.id, def]));
	const publicValuesByName = new Map<string, ReadValue>();
	const customValues = new Map<string, ReadValue>();
	const customIdsByName = new Map(graph.customParameterDefs.map(def => [String(def.nameForReference), def.id]));
	const reading: string[] = [];
	let preparedExpressionInputs = false;

	function prepareExpressionInputs(): void {
		if (preparedExpressionInputs) return;
		preparedExpressionInputs = true;
		// PUBLIC/CUSTOMの参照名は実行時の式でも組み立てられる。名前解決表は配置につき一度作り、
		// 共有値の式・条件付きの循環・未使用のエラーは実際に読まれたときだけ評価する。
		for (const def of graph.paramDefs) {
			if (canReadPublicParameterInExpression(def)) publicValuesByName.set(def.nameForReference, publicCpuReader(getPublicInput(def.id)));
		}
		for (const def of graph.customParameterDefs) {
			const binding = graph.customParameterValues[def.id] ?? def.defaultValue;
			const read = compileCpuValue(def, binding, null);
			customValues.set(def.id, oncePerFrame(frame => {
				if (reading.includes(def.id)) throw new Error('Circular custom parameter reference: ' + [...reading, def.id].map(id => customDefinitions.get(id)!.nameForReference).join(' → '));
				reading.push(def.id);
				try {
					return prepareExpressionParameterValue(def, read(frame));
				} finally {
					reading.pop();
				}
			}));
		}
	}

	function namedValue(read: (name: string) => unknown, args: unknown[]): unknown {
		if (args.length !== 1 || typeof args[0] !== 'string') throw new Error('Expected one parameter name');
		return read(args[0]);
	}

	const graphScope = oncePerFrame((frame): ParameterEvaluationScope => ({
		time: frame.time * 1000, endTime: frame.endTime * 1000, automationGraphs: graph.automationGraphs,
		variables: { TIME: frame.time, TIME_MS: frame.time * 1000, END_TIME: frame.endTime, END_TIME_MS: frame.endTime * 1000,
			PROGRESS: frame.progress ?? (frame.endTime > 0 ? frame.time / frame.endTime : 0), IS_EXPORT: frame.isExport },
		functions: {
			PUBLIC: (...args) => namedValue(name => {
				const read = publicValuesByName.get(name);
				if (read == null) throw new Error('Unavailable public parameter: ' + name);
				return read(frame);
			}, args),
			CUSTOM: (...args) => namedValue(name => {
				const id = customIdsByName.get(name);
				if (id == null) throw new Error('Unknown custom parameter: ' + name);
				return customValues.get(id)!(frame);
			}, args),
		},
	}));

	function compileCpuValue(def: ParameterDefinition, binding: CustomNodeGraphEffectValueParameterBinding, placementVariables: ParameterEvaluationScope['variables'] | null): ReadValue {
		if (binding.inputSource === 'customNodeGraphEffectCustomParameterValueReference' || binding.inputSource === 'customNodeGraphEffectPublicParameterReference') {
			if (binding.parameterId === '') return () => def.defaultValue.value;
			const isPublic = binding.inputSource === 'customNodeGraphEffectPublicParameterReference';
			const source = (isPublic ? publicDefinitions : customDefinitions).get(binding.parameterId);
			if (source == null || (isPublic && !canReadPublicParameterInExpression(source)) || !areDataTypesEqual(source.dataType, def.dataType)) {
				return () => { throw new Error('Missing or incompatible parameter reference: ' + binding.parameterId); };
			}
			if (!isPublic) {
				prepareExpressionInputs();
				return frame => customValues.get(binding.parameterId)!(frame);
			}
			const input = getPublicInput(binding.parameterId);
			if (input.kind === 'value') return input.read;
			return () => { throw new Error('Public parameter does not supply a CPU value: ' + binding.parameterId); };
		}
		if (binding.inputSource === 'literal' && binding.expressionModifier?.enabled !== true) return () => binding.value;
		if (binding.inputSource === 'expression' || binding.expressionModifier?.enabled === true) prepareExpressionInputs();
		return frame => {
			const base = graphScope(frame);
			const scope = placementVariables == null ? base : { ...base, variables: { ...base.variables, ...placementVariables,
				POINTER_POSITION: [frame.pointerPosition?.x ?? -99999, frame.pointerPosition?.y ?? -99999] } };
			return coerceParameterValue(def, validateEnumParameterValue(def, evaluator.evaluate(binding, scope, def.defaultValue.value, def)));
		};
	}

	return (def: ParameterDefinition, binding: CustomNodeGraphEffectValueParameterBinding, placementVariables: ParameterEvaluationScope['variables']): EffectParameterInput => {
		if ('parameterId' in binding && binding.parameterId === '') return createLiteralBindingInput(def, def.defaultValue.value, resolveAudioSource);
		if (binding.inputSource === 'customNodeGraphEffectPublicParameterReference') {
			const input = getPublicInput(binding.parameterId);
			if (input.kind !== 'value' || def.canNode !== true) return input;
			return createEvaluatedEffectInput(def, input.read);
		}
		return createEvaluatedEffectInput(def, oncePerFrame(compileCpuValue(def, binding, placementVariables)));
	};
}
