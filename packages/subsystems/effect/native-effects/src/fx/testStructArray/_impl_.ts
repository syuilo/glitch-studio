import type { EffectParameterInput, NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import type definition from './_def_.ts';

function diagnosticValue(input: EffectParameterInput): unknown {
	switch (input.kind) {
		case 'array': return input.elements.map(diagnosticValue);
		case 'struct': return Object.fromEntries(Object.entries(input.fields).map(([key, field]) => [key, diagnosticValue(field)]));
		case 'texture': return input.texture;
		default: return input.value;
	}
}

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init({ inputs }) {
		return {
			render() { console.log(Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, diagnosticValue(input)]))); },
			dispose() {},
		};
	},
};

export default implementation;
