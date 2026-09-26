import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'stripe',
	displayName: 'Stripe',
	tags: ['pattern'],
	primaryInputParameter: 'background',
	paramDefs: {
		background: { dataType: { kind: 'color' }, ui: { label: 'Background', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		// 元のfrequency=10は角周波数100なので、1周期は2π/100。
		size: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Size', control: { controlType: 'range', min: 0.001, max: 1, logarithmic: true } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 2 * Math.PI / 100 },
		},
		angle: { dataType: { kind: 'scalar' }, ui: { label: 'Angle', control: { controlType: 'angle' } }, canNode: true, defaultValue: { inputSource: 'literal', value: 0.25 } },
		threshold: { dataType: { kind: 'scalar' }, ui: { label: 'Width', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.1 } },
		color: { dataType: { kind: 'color' }, ui: { label: 'Color', control: {} }, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 0.5] } },
		fitMode: { dataType: { kind: 'fitMode' }, ui: { label: 'Fit Mode', control: {} }, defaultValue: { inputSource: 'literal', value: 'cover' } },
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'color' } },
	},
});
