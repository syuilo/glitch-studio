import { constantShaderInputComponents } from '@gs/shared/gpu/shader-input.ts';
import { coerceParameterValue } from '@gs/shared/parameter/coerce-parameter-value.ts';
import { getArrayElementDefinition, getStructFieldDefinitions, validateEnumParameterValue } from '@gs/shared/parameter/parameter-definition.ts';
import { genEmptyValue } from '@gs/shared/parameter/parameter-default.ts';
import { deepClone, type Cloneable } from '@gs/shared/utility/deep-clone.ts';
import { getEffectLayerParameterDefault } from '@gs/subsystems_timeline_shared/layers/effect/effect-layer.ts';
import { TimelineParameterBindingEvaluator } from '@gs/subsystems_timeline_shared/parameter-binding-evaluator.ts';
import { isTimelineAudioInputBinding, isTimelineImageInputBinding } from '@gs/subsystems_timeline_shared/parameter-binding.ts';
import { createTimelineAudioInputResolver, type TimelineAudioInputProvider } from '../../timeline-audio-input-resolver.ts';
import { createSceneOutput } from '../../scene-output.ts';
import type { EffectParameterInput } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
import type { EffectDefinition } from '@gs/subsystems_effect-new_shared/effect-definition.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { TimelineEffectParameterBinding, TimelineParameterBinding } from '@gs/subsystems_timeline_shared/parameter-binding.ts';
import type { TimelineLayerEvaluationScope } from '@gs/subsystems_timeline_shared/evaluation-scope.ts';
import type { TimelineEffectLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineLayerContext } from '../../timeline-renderer.ts';
import type { TimelineImage } from '../../timeline-image.ts';

type LiteralBinding = Extract<TimelineParameterBinding, { inputSource: 'literal' }>;
type Context = TimelineLayerContext<TimelineImage>;
type ValueUpdate = (scope: TimelineLayerEvaluationScope, audio: ReturnType<typeof createTimelineAudioInputResolver>) => void;

/** 計画が要求した公開入力だけを束縛する。各Scene画像の確定先は参照段階ごとに分け、サンプル間で再利用する。 */
export function createEffectLayerInputs(layer: TimelineEffectLayer, definition: EffectDefinition,
	options: Parameters<typeof createSceneOutput>[0], getAudioInput?: TimelineAudioInputProvider) {
	const inputs: Record<string, EffectParameterInput> = Object.create(null);
	const evaluator = new TimelineParameterBindingEvaluator();
	const updates: ValueUpdate[] = [];
	const references = new Map<string, {
		fetch: (context: Context) => Promise<TimelineImage>;
		frame: ReturnType<typeof createSceneOutput>;
		image: TimelineImage | null;
	}>();

	function bind(def: ParameterDefinition, read: () => TimelineEffectParameterBinding): EffectParameterInput {
		const binding = read();
		if (binding.inputSource === 'literal' && def.dataType.kind === 'array') {
			const element = getArrayElementDefinition(def);
			return { kind: 'array', elements: binding.value.map((_: unknown, i: number) => bind(element, () => (read() as LiteralBinding).value[i].binding)) };
		}
		if (binding.inputSource === 'literal' && def.dataType.kind === 'struct') {
			return { kind: 'struct', fields: Object.fromEntries(Object.entries(getStructFieldDefinitions(def)).map(([key, field]) =>
				[key, bind(field, () => (read() as LiteralBinding).value[key])])) };
		}
		if (isTimelineImageInputBinding(binding)) {
			const key = binding.inputSource === 'lowerLayerOutput' ? 'lower' : JSON.stringify([binding.layerId, binding.outputStage]);
			let reference = references.get(key);
			if (reference == null) {
				reference = {
					fetch: binding.inputSource === 'lowerLayerOutput' ? context => context.getInput() : context => context.getLayerOutput(binding.layerId, binding.outputStage),
					frame: createSceneOutput(options),
					image: null,
				};
				references.set(key, reference);
			}
			return { kind: 'texture', resolution: options.resolution, sampling: binding.sampling, get texture() { return (reference.image ?? reference.frame.transparentImage).texture; } };
		}
		if (isTimelineAudioInputBinding(binding)) {
			let value: ReturnType<TimelineAudioInputProvider> = null;
			updates.push((_, audio) => { value = audio(binding); });
			return { kind: 'value', get value() { return value; } };
		}
		const fallback = binding.inputSource === 'automationGraphReference' || (def.dataType.kind === 'enum' && binding.inputSource === 'keyframesTimelineInline')
			? def.defaultValue.value : def.dataType.kind === 'enum' ? null : genEmptyValue(def);
		const convert = (value: Cloneable) => coerceParameterValue(def, deepClone(validateEnumParameterValue(def, value)));
		const evaluate = (scope: TimelineLayerEvaluationScope) => {
			const current = read() as TimelineParameterBinding;
			return convert(current.inputSource === 'literal' && current.expressionModifier?.enabled !== true
				? current.value : evaluator.evaluate(current, scope, fallback, def));
		};
		if (def.canNode === true) {
			let value = constantShaderInputComponents(def.dataType.kind, def.defaultValue.value);
			updates.push(scope => { value = constantShaderInputComponents(def.dataType.kind, evaluate(scope)); });
			return { kind: 'uniform', get value() { return value; } };
		}
		let value: unknown = def.defaultValue.value;
		updates.push(scope => { value = evaluate(scope); });
		return { kind: 'value', get value() { return value; } };
	}

	for (const [id, def] of Object.entries(definition.paramDefs)) {
		Object.defineProperty(inputs, id, { get() {
			const fallback = getEffectLayerParameterDefault(definition, id);
			return bind(def, () => layer.effectParamValues[id] ?? fallback);
		} });
	}
	return {
		inputs,
		async update(context: Context, scope: TimelineLayerEvaluationScope, signal: AbortSignal) {
			const audio = createTimelineAudioInputResolver(getAudioInput, context.sceneTimeMs, context.isExport);
			for (const update of updates) update(scope, audio);
			for (const reference of references.values()) {
				const image = await reference.fetch(context);
				signal.throwIfAborted();
				reference.image = reference.frame.renderInput(image);
			}
		},
		dispose() { for (const reference of references.values()) reference.frame.dispose(); },
	};
}
