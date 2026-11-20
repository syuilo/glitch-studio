import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import code from './shader.wgsl?raw';
import colorSpaceShaderCode from '@gs/shared/gpu/color-space.wgsl?raw';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { inputs } = context;
		return createFullscreenEffect(context, {
			code: colorSpaceShaderCode + '\n' + code,
			schema: { hue: 'scalar', saturation: 'scalar', lightness: 'scalar', alpha: 'scalar' },
			inputs,
			sampling: 'level0',
		});
	},
};

export default implementation;
