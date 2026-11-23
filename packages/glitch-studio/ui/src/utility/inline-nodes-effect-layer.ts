import { createNodesEffectDefinition } from './project-nodes-effect.ts';
import { getEffectDefinitions } from './project-effects.ts';
import { createEffectTimelineLayer } from './effect-timeline-layer.ts';

export function createInlineNodesEffectLayer(startMs: number) {
	// 新規レイヤーの主出力は未接続から始め、通常合成で下層の画像を二重に重ねることを避ける。
	const source = { type: 'inlineNodesEffect' as const, nodesEffect: createNodesEffectDefinition() };
	return createEffectTimelineLayer(getEffectDefinitions({}).describe(source), startMs);
}
