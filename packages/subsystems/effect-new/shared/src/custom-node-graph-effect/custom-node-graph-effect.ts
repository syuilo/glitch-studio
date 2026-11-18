import type { AutomationGraph } from '@gs/shared/automation-graph/automation-graph.ts';
import type { ShaderInputSampling } from '@gs/shared/gpu/shader-input.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { EffectDefinition } from '../effect-definition.ts';
import type { EffectReference } from '../effect-reference.ts';

export type GraphOutputBinding =
	| { type: 'nodeOutput'; nodeId: string; outputId: string }
	| { type: 'publicParameter'; parameterId: string };

export type GraphParameterBinding =
	| { type: 'value'; binding: ValueParameterBinding }
	| (GraphOutputBinding & { sampling?: ShaderInputSampling });

export type CustomNodeGraphEffectNode = {
	id: string;
	effect: EffectReference;
	params: Readonly<Record<string, GraphParameterBinding>>;
	/** 省略時は呼び出し元の基準寸法を子へ引き継ぐ。 */
	resolution?: Resolution;
};

export type CustomNodeGraphEffect = EffectDefinition & {
	automationGraphs?: readonly AutomationGraph[];
	nodes: readonly CustomNodeGraphEffectNode[];
	/** 公開出力ごとの供給元。未接続の出力のキーは省略する。 */
	outputs: Readonly<Record<string, GraphOutputBinding>>;
};
