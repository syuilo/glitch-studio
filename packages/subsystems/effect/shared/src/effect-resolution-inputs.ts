import { walkParameterLeaves } from '@gs/shared/parameter/parameter-tree.ts';
import type { ParameterBindingBase } from '@gs/shared/parameter/parameter-binding.ts';
import type { EffectDefinition } from './effect-definition.ts';
import type { Resolution } from '@gs/shared/resolution.ts';

/** 値を評価せず、定義と保存済みの接続だけから解像度に寄与する入力を列挙する。 */
export function getEffectInputResolution<Binding extends ParameterBindingBase>(
	definition: Pick<EffectDefinition, 'paramDefs' | 'resolutionInputParameters'>,
	parameters: Record<string, Binding>, getResolution: (binding: Binding) => Resolution | null): Resolution | null {
	const definitions = Object.fromEntries(definition.resolutionInputParameters.map(key => [key, definition.paramDefs[key]]));
	let largest: Resolution | null = null;
	for (const { def, param } of walkParameterLeaves<Binding>(definitions, parameters)) {
		if (def.canNode !== true) continue;
		const resolution = getResolution(param);
		if (resolution != null && (largest == null || resolution.width * resolution.height > largest.width * largest.height)) largest = resolution;
	}
	return largest;
}
