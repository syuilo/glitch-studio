import { genId } from '@glitch/shared/utility/id.ts';
import { deepClone } from '@glitch/shared/utility/deep-clone.ts';
import type { ParameterBinding } from '@glitch/shared/types.ts';

type InlineAutomationGraph = Extract<ParameterBinding, { inputSource: 'automationGraphInline' }>;

export function setInlineAutomationGraphNormalized(input: InlineAutomationGraph, isNormalized: boolean): InlineAutomationGraph {
	const value = deepClone(input);
	const graph = value.automationGraph;
	if (graph.isNormalized === isNormalized) return value;
	const durationMs = value.durationMs != null && Number.isFinite(value.durationMs) && value.durationMs > 0 ? value.durationMs : 1000;
	graph.points.sort((a, b) => a.x - b.x);
	const firstX = graph.points[0]?.x ?? 0;
	const span = (graph.points.at(-1)?.x ?? firstX) - firstX;
	const scale = isNormalized ? 1 / (span > 0 ? span : durationMs) : durationMs;
	// 制御点はアンカーからの相対座標なので、平行移動せず倍率だけを適用する。
	for (const point of graph.points) {
		point.x = (point.x - (isNormalized ? firstX : 0)) * scale;
		point.bezierControlPointA[0] *= scale;
		point.bezierControlPointB[0] *= scale;
	}
	if (isNormalized) {
		value.durationMs = span > 0 ? span : durationMs;
		// 正規化エディタが固定する0と1の端点を、空・1点のグラフにも用意する。
		if (graph.points.length === 0) {
			graph.points.push({ id: genId(), x: 0, y: 0, bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] });
		}
		if (span <= 0) {
			const last = graph.points.at(-1)!;
			last.bezierControlPointB = [0, 0];
			graph.points.push({ id: genId(), x: 1, y: last.y, bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] });
		} else {
			// 丸め誤差で固定端点の1をわずかに越えないようにする。
			graph.points[0].x = 0;
			graph.points.at(-1)!.x = 1;
		}
	}
	graph.isNormalized = isNormalized;
	return value;
}

export function createInlineAutomationGraph(): Extract<ParameterBinding, { inputSource: 'automationGraphInline' }> {
	return {
		inputSource: 'automationGraphInline',
		automationGraph: {
			isNormalized: true,
			points: [
				{ id: genId(), x: 0, y: 0, bezierControlPointA: [0, 0], bezierControlPointB: [0.5, 0] },
				{ id: genId(), x: 1, y: 1, bezierControlPointA: [-0.5, 0], bezierControlPointB: [0, 0] },
			],
		},
		durationMs: 1000,
		wrapMode: 'repeat',
		offsetMode: 'start',
	};
}
