import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { inputs } = context;
		return createFullscreenEffect(context, {
			code,
			schema: { red: 'scalar', green: 'scalar', blue: 'scalar', alpha: 'scalar' },
			inputs,
			sampling: 'level0',
		});
	},
};

export default implementation;
