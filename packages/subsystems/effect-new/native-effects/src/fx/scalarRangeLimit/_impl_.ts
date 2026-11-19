import type { NativeEffectImplementation } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { inputs } = context;
		const operationId = [0];
		return createFullscreenEffect(context, {
			code,
			schema: { input: 'scalar', min: 'scalar', max: 'scalar', operationId: 'scalar' },
			inputs: { ...inputs, operationId: { kind: 'uniform', get value() {
				operationId[0] = { clamp: 0, wrap: 1, pingPong: 2 }[inputs.mode.value];
				return operationId;
			} } },
			sampling: 'level0',
		});
	},
};

export default implementation;
