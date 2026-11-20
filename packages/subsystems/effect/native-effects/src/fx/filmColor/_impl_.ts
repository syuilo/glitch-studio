import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import oklabShaderCode from '@gs/shared/gpu/oklab.wgsl?raw';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { inputs } = context;
		return createFullscreenEffect(context, {
			code: oklabShaderCode + '\n' + code,
			schema: { input: 'color', amount: 'scalar', contrast: 'scalar', shadowSoftness: 'scalar', highlightSoftness: 'scalar', fade: 'scalar', chromaCompression: 'scalar', shadowHue: 'scalar', shadowTintAmount: 'scalar', highlightHue: 'scalar', highlightTintAmount: 'scalar' },
			inputs,
		});
	},
};

export default implementation;
