import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import type definition from './_def_.ts';
import code from './shader.wgsl?raw';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { inputs } = context;
		return createFullscreenEffect(context, {
			code,
			schema: { input: 'color', rThreshold: 'scalar', gThreshold: 'scalar', bThreshold: 'scalar' },
			inputs,
		});
	},
};

export default implementation;
