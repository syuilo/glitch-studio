import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import { scalarMathOperations } from './operations.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { inputs } = context;
		const operationId = [0];
		return createFullscreenEffect(context, {
			code,
			schema: { inputA: 'scalar', inputB: 'scalar', inputC: 'scalar', operationId: 'scalar' },
			inputs: { ...inputs, operationId: { kind: 'uniform', get value() {
				operationId[0] = scalarMathOperations[inputs.operation.value].shaderOperationId;
				return operationId;
			} } },
			sampling: 'level0',
		});
	},
};

export default implementation;
