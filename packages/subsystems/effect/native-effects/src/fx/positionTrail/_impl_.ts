import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { bindParameterValues } from '../../multipass.ts';
import { createTrailHistory } from '../../trail-history.ts';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(placement, publishOutputs) {
		const params = bindParameterValues(placement.inputs);
		const history = createTrailHistory(placement, publishOutputs);
		return {
			...history,
			render(ctx) {
				history.render(ctx, params.position, params);
			},
		};
	},
};

export default implementation;
