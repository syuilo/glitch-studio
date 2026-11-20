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
			schema: { input: 'color' },
			inputs,
			sampling: 'level0',
			outputPorts: ['hue', 'saturation', 'lightness', 'alpha'],
		});
	},
};

export default implementation;
