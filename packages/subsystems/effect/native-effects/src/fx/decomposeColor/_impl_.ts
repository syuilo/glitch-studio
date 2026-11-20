import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { inputs } = context;
		return createFullscreenEffect(context, {
			code,
			schema: { input: 'color' },
			inputs,
			sampling: 'level0',
			// 同じ画素で入力を一度だけ読み、4成分を同じパスで分けて出力する。
			outputPorts: ['red', 'green', 'blue', 'alpha'],
		});
	},
};

export default implementation;
