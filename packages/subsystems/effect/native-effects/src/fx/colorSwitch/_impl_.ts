import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createFullscreenEffectWithInputVariants } from '../../fullscreen-input-variants.ts';
import type definition from './_def_.ts';
import shader from './shader.wgsl?raw';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { condition, falseInput, trueInput } = context.inputs;
		const falseVariant = { source: falseInput };
		const trueVariant = { source: trueInput };
		return createFullscreenEffectWithInputVariants(context, {
			code: shader,
			schema: { source: 'color' },
			inputVariants: [falseVariant, trueVariant],
			selectInputs: () => condition.value ? trueVariant : falseVariant,
		});
	},
};

export default implementation;
