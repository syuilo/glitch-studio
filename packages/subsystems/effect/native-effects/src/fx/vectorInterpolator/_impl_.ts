import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createInputInterpolator } from '../../interpolator/create-input-interpolator.ts';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init: context => createInputInterpolator(context, 'vector'),
};

export default implementation;
