import { genId } from '@gs/shared/utility/id.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import type { CurveAnimation } from '@gs/shared/curve-animation/curve-animation.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';

type InlineCurveAnimation = Extract<ValueParameterBinding, { inputSource: 'curveAnimationInline' }>;

export function setInlineCurveAnimationNormalized(input: InlineCurveAnimation, isNormalized: boolean): InlineCurveAnimation {
	const value = deepClone(input);
	const curveAnimation = value.curveAnimation;
	if (curveAnimation.isNormalized === isNormalized) return value;
	const trimmedDurationMs = value.trimmedDurationMs != null && Number.isFinite(value.trimmedDurationMs) && value.trimmedDurationMs > 0 ? value.trimmedDurationMs : 1000;
	curveAnimation.points.sort((a, b) => a.x - b.x);
	const firstX = curveAnimation.points[0]?.x ?? 0;
	const span = (curveAnimation.points.at(-1)?.x ?? firstX) - firstX;
	const scale = isNormalized ? 1 / (span > 0 ? span : trimmedDurationMs) : trimmedDurationMs;
	// 制御点はアンカーからの相対座標なので、平行移動せず倍率だけを適用する。
	for (const point of curveAnimation.points) {
		point.x = (point.x - (isNormalized ? firstX : 0)) * scale;
		point.bezierControlPointA[0] *= scale;
		point.bezierControlPointB[0] *= scale;
	}
	if (isNormalized) {
		value.trimmedDurationMs = span > 0 ? span : trimmedDurationMs;
		// 正規化エディタが固定する0と1の端点を、空・1点のCurve Animationにも用意する。
		if (curveAnimation.points.length === 0) {
			curveAnimation.points.push({
				id: genId(),
				x: 0,
				y: 0,
				bezierControlPointA: [0, 0],
				bezierControlPointB: [0, 0],
			});
		}
		if (span <= 0) {
			const last = curveAnimation.points.at(-1)!;
			last.bezierControlPointB = [0, 0];
			curveAnimation.points.push({
				id: genId(),
				x: 1,
				y: last.y,
				bezierControlPointA: [0, 0],
				bezierControlPointB: [0, 0],
			});
		} else {
			// 丸め誤差で固定端点の1をわずかに越えないようにする。
			curveAnimation.points[0].x = 0;
			curveAnimation.points.at(-1)!.x = 1;
		}
	}
	curveAnimation.isNormalized = isNormalized;
	return value;
}

export function createInlineCurveAnimation(): Extract<ValueParameterBinding, { inputSource: 'curveAnimationInline' }> {
	return {
		inputSource: 'curveAnimationInline',
		curveAnimation: {
			isNormalized: true,
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
		},
		trimmedDurationMs: 1000,
		wrapMode: 'repeat',
		offsetMode: 'start',
	};
}

export function createProjectCurveAnimation(curveAnimations: readonly CurveAnimation[], source?: CurveAnimation): CurveAnimation {
	const baseName = source?.nameForReference ?? 'my_curve_animation';
	let nameForReference = baseName;
	for (let suffix = 2; curveAnimations.some(curveAnimation => curveAnimation.nameForReference === nameForReference); suffix++) nameForReference = `${baseName}_${suffix}`;
	const data = deepClone(source ?? createInlineCurveAnimation().curveAnimation);
	return { ...data, id: genId(), nameForReference, points: data.points.map(point => ({ ...point, id: genId() })) };
}
