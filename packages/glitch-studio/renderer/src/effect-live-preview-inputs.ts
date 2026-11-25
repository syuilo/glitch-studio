import { ParameterBindingEvaluator } from '@gs/shared/parameter/parameter-binding-evaluator.ts';
import { ExpressionEvaluator } from '@gs/shared/expression/expression-evaluator.ts';
import { getArrayElementDefinition, getStructFieldDefinitions, isParameterType } from '@gs/shared/parameter/parameter-definition.ts';
import { coerceParameterValue } from '@gs/shared/parameter/coerce-parameter-value.ts';
import { constantShaderInputComponents } from '@gs/shared/gpu/shader-input.ts';
import { createDefaultParameterBinding } from '@gs/shared/parameter/parameter-default.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { EffectPlacementInput } from '@gs/subsystems_effect_renderer/create-effect-instance.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { EffectLivePreviewParameterBinding } from '@gs/glitch-studio_shared/effect-live-preview-input.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { ParameterEvaluationScope } from '@gs/shared/parameter/parameter-evaluation-scope.ts';
import type { CurveAnimation } from '@gs/shared/curve-animation/curve-animation.ts';
import type { AudioInput } from '@gs/subsystems_audio_shared/audio-input.ts';
import type { EFFECT_LIVE_PREVIEW_VAR_DEFS } from '@gs/glitch-studio_shared/effect-live-preview-expression.ts';

export type EffectLivePreviewParameters = Readonly<Record<string, EffectLivePreviewParameterBinding>>;

/** 公開入力はプレビューの時計で評価する。Effect内部のPUBLIC・CUSTOMのスコープはEffectに任せる。 */
export function createEffectLivePreviewInputs(definition: EffectDefinition, initial: EffectLivePreviewParameters,
	curveAnimations: readonly CurveAnimation[], media: { image: () => EffectPlacementInput; audio: () => AudioInput | null }) {
	const evaluator = new ParameterBindingEvaluator(new ExpressionEvaluator());
	const inputs: Record<string, EffectPlacementInput> = Object.create(null);
	const refresh: (() => void)[] = [];
	const update: ((scope: ParameterEvaluationScope) => void)[] = [];
	let parameters = initial;
	let usesImage = false;
	const updateAudio: ((input: AudioInput | null) => void)[] = [];
	// 既に計画した入力だけの構造を確認する。式本文やキーの値は
	// 評価器を束縛し直せばよく、GPU配置やFeedbackの履歴を作り直す必要がない。
	const sameLayout: (() => boolean)[] = [];

	function bind(def: ParameterDefinition, read: () => EffectLivePreviewParameterBinding): EffectPlacementInput {
		const source = read();
		sameLayout.push(() => read().inputSource === source.inputSource);
		if (source.inputSource === 'previewInputImage') {
			usesImage = true;
			return media.image();
		}
		if (source.inputSource === 'previewInputAudio') {
			let value: AudioInput | null = null;
			updateAudio.push(input => { value = input; });
			return { kind: 'value', get value() { return value; } };
		}
		if (source.inputSource === 'literal' && isParameterType(def, 'array')) {
			const ids = source.value.map((element: { id: string }) => element.id);
			sameLayout.push(() => {
				const elements = (read() as typeof source).value;
				return elements.length === ids.length && ids.every((id: string, i: number) => elements[i].id === id);
			});
			const element = getArrayElementDefinition(def);
			return { kind: 'array', elements: source.value.map((_: unknown, i: number) => bind(element, () => (read() as typeof source).value[i].binding)) };
		}
		if (source.inputSource === 'literal' && isParameterType(def, 'struct')) {
			return { kind: 'struct', fields: Object.fromEntries(Object.entries(getStructFieldDefinitions(def)).map(([id, field]) =>
				[id, bind(field, () => (read() as typeof source).value[id])])) };
		}
		if (def.dataType.kind === 'audioSource') return { kind: 'value', value: null };
		let evaluate = evaluator.bind(source, def.defaultValue, def, curveAnimations);
		refresh.push(() => { evaluate = evaluator.bind(read() as ValueParameterBinding, def.defaultValue, def, curveAnimations); });
		const readValue = (scope: ParameterEvaluationScope) => coerceParameterValue(def, evaluate(scope));
		if (def.canNode === true) {
			let value = constantShaderInputComponents(def.dataType.kind, def.defaultValue);
			update.push(scope => { value = constantShaderInputComponents(def.dataType.kind, readValue(scope)); });
			return { kind: 'uniform', get value() { return value; } };
		}
		let value: unknown = def.defaultValue;
		update.push(scope => { value = readValue(scope); });
		return { kind: 'value', get value() { return value; } };
	}

	// 計画が読むパラメータだけを評価対象にする。未使用の音声入力はPCMのコピーを起動しない。
	for (const [id, def] of Object.entries(definition.paramDefs)) {
		let bound: EffectPlacementInput | null = null;
		let defaultBinding: ReturnType<typeof createDefaultParameterBinding> | null = null;
		Object.defineProperty(inputs, id, { enumerable: true, get: () => bound ??= bind(def, () => parameters[id] ?? (defaultBinding ??= createDefaultParameterBinding(def))) });
	}
	return {
		inputs,
		get usesImage() { return usesImage; },
		updateParameters(next: EffectLivePreviewParameters) {
			parameters = next;
			if (!sameLayout.every(matches => matches())) return false;
			for (const apply of refresh) apply();
			return true;
		},
		updateCurveAnimations(next: readonly CurveAnimation[]) {
			curveAnimations = next;
			for (const apply of refresh) apply();
		},
		beginFrame(time: number) {
			const variables = { TIME: time / 1000, TIME_MS: time } satisfies Record<typeof EFFECT_LIVE_PREVIEW_VAR_DEFS[number], number>;
			const scope = { time, endTime: Infinity, variables, curveAnimations };
			// 一つの描画で使われる音声窓は全パラメータで同じ素材時刻を共有する。
			if (updateAudio.length > 0) {
				const audio = media.audio();
				for (const apply of updateAudio) apply(audio);
			}
			for (const apply of update) apply(scope);
		},
	};
}
