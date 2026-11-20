import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createInputSelector } from '../../selector/create-input-selector.ts';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init: context => createInputSelector(context, 'color'),
};

export default implementation;
