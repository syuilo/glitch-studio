import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import { vectorMathOperations } from './operations.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { inputs } = context;
		const operationId = [0];
		return createFullscreenEffect(context, {
			code,
			schema: { inputA: 'vector', inputB: 'vector', scale: 'scalar', angle: 'scalar', operationId: 'scalar' },
			inputs: { ...inputs, operationId: { kind: 'uniform', get value() {
				operationId[0] = vectorMathOperations[inputs.operation.value].shaderOperationId;
				return operationId;
			} } },
			sampling: 'level0',
		});
	},
};

export default implementation;
