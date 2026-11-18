import { walkParameterLeaves } from '@gs/shared/parameter/parameter-tree.ts';
import type { LeafDataType } from '@gs/shared/data-type/data-type.ts';
import type { ShaderInputSampling } from '@gs/shared/gpu/shader-input.ts';
import type { ParameterArrayElement } from '@gs/shared/parameter/parameter-binding.ts';
import type { ParameterDefaultValue } from '@gs/shared/parameter/parameter-definition.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { StaticSettingValues } from '@gs/shared/static-setting.ts';
import type { EffectDefinition } from '../effect-definition.ts';
import type { EffectSource } from '../effect-source.ts';

/** どちらも同じCustom Node Graph Effect内の参照。公開出力は取得元の値と寸法をそのまま公開する。 */
export type CustomNodeGraphEffectConnection =
	| { inputSource: 'publicParameter'; parameterId: string }
	| { inputSource: 'node'; nodeId: string; outputPort: string };

export type CustomNodeGraphEffectParameterBinding =
	| { inputSource: 'literal'; value: ParameterDefaultValue<LeafDataType>['value']
		| ParameterArrayElement<CustomNodeGraphEffectParameterBinding>[]
		| { [field: string]: CustomNodeGraphEffectParameterBinding } }
	| (CustomNodeGraphEffectConnection & { sampling?: ShaderInputSampling });

export type CustomNodeGraphEffectNode = {
	id: string;
	effectSource: EffectSource;
	params: Readonly<Record<string, CustomNodeGraphEffectParameterBinding>>;
	staticSettings?: StaticSettingValues;
	resolution?: Resolution;
};

export type CustomNodeGraphEffect = EffectDefinition & {
	// 静的設定は各配置が所有する。公開引数として配線できるのはparamDefsの値。
	staticSettingDefs?: never;
	nodes: readonly CustomNodeGraphEffectNode[];
	/** キーはoutputDefsのID。接続を省略した公開出力には値がない。 */
	outputs: Readonly<Record<string, CustomNodeGraphEffectConnection>>;
};

/** 上位の入力IDも返し、配列・構造体の末端の配線を描画順と解像度の両方に反映する。 */
export function* getCustomNodeGraphEffectNodeConnections(definition: EffectDefinition, node: CustomNodeGraphEffectNode): Generator<{
	parameterId: string;
	connection: CustomNodeGraphEffectConnection;
}> {
	// 省略された入力の既定値は配置先のノードを参照できないため、明示したBindingだけをたどる。
	for (const [parameterId, binding] of Object.entries(node.params)) {
		for (const { param } of walkParameterLeaves<CustomNodeGraphEffectParameterBinding>({ [parameterId]: definition.paramDefs[parameterId] }, { [parameterId]: binding })) {
			if (param.inputSource !== 'literal') yield { parameterId, connection: param };
		}
	}
}
