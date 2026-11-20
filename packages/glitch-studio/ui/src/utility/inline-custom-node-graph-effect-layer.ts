import { createCustomNodeGraphEffectDefinition } from './project-custom-node-graph-effect.ts';
import { getEffectDefinitions } from './project-effects.ts';
import { createEffectTimelineLayer } from './effect-timeline-layer.ts';

export function createInlineCustomNodeGraphEffectLayer(startMs: number) {
	const source = { type: 'inlineCustomNodeGraphEffect' as const, customNodeGraphEffect: createCustomNodeGraphEffectDefinition() };
	return createEffectTimelineLayer(getEffectDefinitions({}).describe(source), startMs);
}
