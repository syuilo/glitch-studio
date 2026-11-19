import type { ParameterDefinition, ParameterDefaultValue } from '@gs/shared/parameter/parameter-definition.ts';
import type { NativeEffectDefinition } from '@gs/subsystems_effect-new_shared/effect-definition.ts';
import type { EffectFrame, EffectImageInput, EffectInstanceOptions, EffectParameterInput, NativeEffectImplementation } from '../effect-instance.ts';

type NativeParameterInput<Definition extends ParameterDefinition> =
	Definition extends { canNode: true } ? EffectImageInput :
	Definition['dataType']['kind'] extends 'array' ? Extract<EffectParameterInput, { kind: 'array' }> :
	Definition['dataType']['kind'] extends 'struct' ? Extract<EffectParameterInput, { kind: 'struct' }> :
	{ kind: 'value'; read: (frame: EffectFrame) => Definition['dataType']['kind'] extends 'audioSource' ? unknown : ParameterDefaultValue<Definition['dataType']>['value'] };

/** カタログで型を消去する直前まで、個々の実装が読むパラメータ名と値型を定義に結び付ける。 */
export function implementNativeEffect<Definition extends NativeEffectDefinition>(implementation: (options: Omit<EffectInstanceOptions, 'inputs'> & {
	inputs: { readonly [Key in keyof Definition['paramDefs']]: NativeParameterInput<Definition['paramDefs'][Key]> };
}) => ReturnType<NativeEffectImplementation>): NativeEffectImplementation {
	return implementation as NativeEffectImplementation;
}
