import { createCustomNodeGraphEffectDefinition } from './project-custom-node-graph-effect.ts';
import { getEffectDefinitions } from './project-effects.ts';
import { createEffectTimelineLayer } from './effect-timeline-layer.ts';

export function createInlineCustomNodeGraphEffectLayer(startMs: number) {
	// 新規レイヤーの主出力は未接続から始め、通常合成で下層の画像を二重に重ねることを避ける。
	const source = { type: 'inlineCustomNodeGraphEffect' as const, customNodeGraphEffect: createCustomNodeGraphEffectDefinition() };
	return createEffectTimelineLayer(getEffectDefinitions({}).describe(source), startMs);
}
