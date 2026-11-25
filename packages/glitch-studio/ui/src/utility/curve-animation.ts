import { genId } from '@gs/shared/utility/id.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { DEFAULT_CURVE_ANIMATION_Y_RANGE_MIN, DEFAULT_CURVE_ANIMATION_Y_RANGE_MAX } from '@gs/shared/curve-animation/curve-animation.ts';
import type { FunctionCurve, SharedFunctionCurve } from '@gs/shared/function-curve/function-curve.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';

type InlineCurveAnimation = Extract<ValueParameterBinding, { inputSource: 'curveAnimationInline' }>;

export function setFunctionCurveXNormalized(curve: FunctionCurve, isXNormalized: boolean, durationMs: number | null) {
	const functionCurve = deepClone(curve);
	let trimmedDurationMs = durationMs != null && Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 1000;
	if (functionCurve.isXNormalized === isXNormalized) return { functionCurve, trimmedDurationMs };
	functionCurve.points.sort((a, b) => a.x - b.x);
	const firstX = functionCurve.points[0]?.x ?? 0;
	const span = (functionCurve.points.at(-1)?.x ?? firstX) - firstX;
	const scale = isXNormalized ? 1 / (span > 0 ? span : trimmedDurationMs) : trimmedDurationMs;
	// 制御点はアンカーからの相対座標なので、平行移動せず倍率だけを適用する。
	for (const point of functionCurve.points) {
		point.x = (point.x - (isXNormalized ? firstX : 0)) * scale;
		point.bezierControlPointA[0] *= scale;
		point.bezierControlPointB[0] *= scale;
	}
	if (isXNormalized) {
		trimmedDurationMs = span > 0 ? span : trimmedDurationMs;
		// 正規化エディタが固定する0と1の端点を、空・1点のCurve Animationにも用意する。
		if (functionCurve.points.length === 0) {
			functionCurve.points.push({
				id: genId(),
				x: 0,
				y: 0,
				bezierControlPointA: [0, 0],
				bezierControlPointB: [0, 0],
			});
		}
		if (span <= 0) {
			const last = functionCurve.points.at(-1)!;
			last.bezierControlPointB = [0, 0];
			functionCurve.points.push({
				id: genId(),
				x: 1,
				y: last.y,
				bezierControlPointA: [0, 0],
				bezierControlPointB: [0, 0],
			});
		} else {
			// 丸め誤差で固定端点の1をわずかに越えないようにする。
			functionCurve.points[0].x = 0;
			functionCurve.points.at(-1)!.x = 1;
		}
	}
	functionCurve.isXNormalized = isXNormalized;
	return { functionCurve, trimmedDurationMs };
}

export function setInlineCurveAnimationXNormalized(input: InlineCurveAnimation, isXNormalized: boolean): InlineCurveAnimation {
	const { curveAnimation } = input;
	if (curveAnimation.curveBinding.source !== 'inline') return input;
	const { functionCurve, trimmedDurationMs } = setFunctionCurveXNormalized(curveAnimation.curveBinding.curve, isXNormalized, curveAnimation.trimmedDurationMs);
	return { ...input, curveAnimation: { ...curveAnimation, curveBinding: { source: 'inline', curve: functionCurve }, trimmedDurationMs } };
}

export function setInlineCurveAnimationYNormalized(input: InlineCurveAnimation, isYNormalized: boolean): InlineCurveAnimation {
	const { curveAnimation } = deepClone(input);
	if (curveAnimation.curveBinding.source !== 'inline') return input;
	const { curve } = curveAnimation.curveBinding;
	if (curve.isYNormalized === isYNormalized) return input;
	let min = curveAnimation.yRangeMin ?? DEFAULT_CURVE_ANIMATION_Y_RANGE_MIN;
	let max = curveAnimation.yRangeMax ?? DEFAULT_CURVE_ANIMATION_Y_RANGE_MAX;
	// 幅がゼロの範囲では非正規化の値を表現できないため、正規化に切り替えるときは既定の範囲へ戻す。
	if (isYNormalized && min === max) {
		curveAnimation.yRangeMin = null;
		curveAnimation.yRangeMax = null;
		min = DEFAULT_CURVE_ANIMATION_Y_RANGE_MIN;
		max = DEFAULT_CURVE_ANIMATION_Y_RANGE_MAX;
	}
	const span = max - min;
	const scale = isYNormalized ? 1 / span : span;
	// ハンドルはアンカーからの相対座標なので、平行移動せず倍率だけを適用する。
	for (const point of curve.points) {
		point.y = isYNormalized ? (point.y - min) * scale : min + point.y * scale;
		point.bezierControlPointA[1] *= scale;
		point.bezierControlPointB[1] *= scale;
	}
	curve.isYNormalized = isYNormalized;
	return { ...input, curveAnimation };
}

function createFunctionCurve(): FunctionCurve {
	return {
		isXNormalized: true,
		isYNormalized: true,
		points: [
			{
				id: genId(),
				x: 0,
				y: 0,
				bezierControlPointA: [0, 0],
				bezierControlPointB: [0.5, 0],
			},
			{
				id: genId(),
				x: 1,
				y: 1,
				bezierControlPointA: [-0.5, 0],
				bezierControlPointB: [0, 0],
			},
		],
	};
}

export function createInlineCurveAnimation(): InlineCurveAnimation {
	return {
		inputSource: 'curveAnimationInline',
		curveAnimation: {
			curveBinding: { source: 'inline', curve: createFunctionCurve() },
			trimmedDurationMs: 1000,
			yRangeMin: null,
			yRangeMax: null,
			wrapMode: 'repeat',
			offsetMode: 'start',
		},
	};
}

export function createProjectFunctionCurve(functionCurves: readonly SharedFunctionCurve[], source?: SharedFunctionCurve): SharedFunctionCurve {
	const baseName = source?.nameForReference ?? 'my_function_curve';
	let nameForReference = baseName;
	for (let suffix = 2; functionCurves.some(functionCurve => functionCurve.nameForReference === nameForReference); suffix++) nameForReference = `${baseName}_${suffix}`;
	const id = genId();
	if (source == null) return { ...createFunctionCurve(), id, nameForReference };
	const curve = deepClone(source);
	return { ...curve, id, nameForReference, points: curve.points.map(point => ({ ...point, id: genId() })) };
}
