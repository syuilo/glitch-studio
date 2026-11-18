import type { EffectReference } from './effect-reference.ts';
import type { CustomNodeGraphEffect } from './custom-node-graph-effect/custom-node-graph-effect.ts';

export type { EffectReference } from './effect-reference.ts';
export type { CustomShaderEffect } from './custom-shader-effect/custom-shader-effect.ts';
export type { CustomNodeGraphEffect, CustomNodeGraphEffectNode, GraphOutputBinding, GraphParameterBinding } from './custom-node-graph-effect/custom-node-graph-effect.ts';

export type EffectSource = EffectReference | { type: 'inlineCustomNodeGraphEffect'; customNodeGraphEffect: CustomNodeGraphEffect };
