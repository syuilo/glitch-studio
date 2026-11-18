import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'splitLayout',
	displayName: 'Split Layout',
	summary: {
		'ja-JP': '任意の角度で画面を二分し、各画像の中心を領域の面積重心に合わせて配置します。',
		'en-US': 'Splits the canvas at any angle and centers each image on the area centroid of its region.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['composite'],
	paramDefs: {
		inputA: {
			dataType: { kind: 'color' },
			ui: { label: 'A', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		inputB: {
			dataType: { kind: 'color' },
			ui: { label: 'B', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		angle: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Angle', control: { controlType: 'angle' } },
			// 分割領域全体と配置先の重心を決めるため、画素ごとの角度場は受け取らない。
			defaultValue: { inputSource: 'literal', value: 0.25 },
		},
		offset: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Offset', control: { controlType: 'range', min: -0.75, max: 0.75, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		gap: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Gap (Reference Ratio)', control: { controlType: 'range', min: 0, max: 0.5, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		sizeReference: {
			dataType: { kind: 'sizeReference' },
			ui: { label: 'Size Reference', isAdvanced: true, control: {} },
			defaultValue: { inputSource: 'literal', value: 'longSide' },
		},
	},
	primaryInputParameter: 'inputA',
	resolutionInputParameters: ['inputA', 'inputB'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
