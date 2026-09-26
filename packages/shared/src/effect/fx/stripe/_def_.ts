import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'stripe',
	displayName: 'Stripe',
	tags: ['pattern'],
	primaryInputParameter: 'background',
	paramDefs: {
		background: { dataType: 'color', ui: { label: 'Background', control: 'color' }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		// 元のfrequency=10は角周波数100なので、1周期は2π/100。
		size: { dataType: 'scalar', ui: { label: 'Size', control: 'range', min: 0.001, max: 1, logarithmic: true }, canNode: true, defaultValue: { inputSource: 'literal', value: 2 * Math.PI / 100 } },
		angle: { dataType: 'scalar', ui: { label: 'Angle', control: 'angle' }, canNode: true, defaultValue: { inputSource: 'literal', value: 0.25 } },
		threshold: { dataType: 'scalar', ui: { label: 'Width', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.1 } },
		color: { dataType: 'color', ui: { label: 'Color', control: 'color' }, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 0.5] } },
		fitMode: { dataType: 'fitMode', ui: { label: 'Fit Mode', control: 'fitMode' }, defaultValue: { inputSource: 'literal', value: 'cover' } },
	},
	outputDefs: {
		output: { primary: true, dataType: 'color' },
	},
});
