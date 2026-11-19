import { createShaderInputBindings, generateShaderInputs, type ShaderInputType } from '@gs/shared/gpu/shader-input.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import { toFixedShaderInput, type EffectImageInput } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';

/** group 0はNative Effect自身が所有し、group 1から接続のFit/Wrap/Filterを適用して読む。 */
export function createNativeEffectInputBindings(device: GPUDevice, resolution: Resolution, type: ShaderInputType, input: EffectImageInput) {
	const inputs = { input: toFixedShaderInput(input) };
	const generated = generateShaderInputs({ input: type }, inputs, 1, 'level0');
	const bindings = createShaderInputBindings(device, generated);
	try {
		return { code: generated.code, layout: bindings.layout, getBindGroup: bindings.bindFixedInputs(inputs, resolution), dispose: bindings.dispose };
	} catch (error) {
		bindings.dispose();
		throw error;
	}
}
