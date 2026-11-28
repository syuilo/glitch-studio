import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { bindParameterValues } from '../../multipass.ts';
import { createTrailHistory } from '../../trail-history.ts';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(placement, publishOutputs) {
		const params = bindParameterValues(placement.inputs);
		const history = createTrailHistory(placement, publishOutputs);
		let previousPosition: readonly [number, number] | null = null;
		return {
			...history,
			render(ctx) {
				const position = params.position;
				// Positionのサンプル間は描画間隔にわたる等速移動として扱う。
				history.render(ctx, previousPosition == null ? [] : [{
					start: previousPosition,
					end: position,
					startTime: ctx.time - Math.max(0, ctx.timeDelta) / 1000,
					endTime: ctx.time,
				}], params);
				// 入力の配列を参照したままだと、入力を書き換えたときに移動元も変わる。
				previousPosition = [position[0], position[1]];
			},
			resetRenderHistory() {
				previousPosition = null;
				history.resetRenderHistory();
			},
		};
	},
};

export default implementation;
