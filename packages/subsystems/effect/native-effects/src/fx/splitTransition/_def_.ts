import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Split Transition',
	summary: {
		'ja-JP': '画面を左右または上下に分割し、各領域に合わせて画像を配置しながらAからBへ切り替えます。',
		'en-US': 'Transitions from image A to image B by resizing their side-by-side or stacked regions and fitting each image within its region.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['composite', 'transition'],
	thumbnail: {
		mode: 'customParameters',
		inputs: { inputA: 'sceneA', inputB: 'sceneB' },
		params: { progress: 0.42, gap: 0.018 },
	},
	paramDefs: {
		inputA: {
			dataType: { kind: 'color' },
			ui: { label: 'A', control: {} },
			canNode: true,
			defaultValue: [0, 0, 0, 0],
		},
		inputB: {
			dataType: { kind: 'color' },
			ui: { label: 'B', control: {} },
			canNode: true,
			defaultValue: [0, 0, 0, 0],
		},
		progress: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Progress', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } },
			// 二つの矩形領域の寸法を決めるため、画素ごとの進捗場は受け取らない。
			defaultValue: 0,
		},
		direction: {
			dataType: { kind: 'enum', options: ['horizontal', 'vertical'] },
			ui: { label: 'Direction', control: { labels: { horizontal: 'Left / Right', vertical: 'Top / Bottom' } } },
			defaultValue: 'horizontal',
		},
		reverse: {
			dataType: { kind: 'bool' },
			ui: { label: 'Reverse Order', control: {} },
			defaultValue: false,
		},
		gap: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Gap (Reference Ratio)', control: { controlType: 'range', min: 0, max: 0.5, step: 0.001 } },
			defaultValue: 0,
		},
		sizeReference: {
			dataType: { kind: 'sizeReference' },
			ui: { label: 'Size Reference', isAdvanced: true, control: {} },
			defaultValue: 'longSide',
		},
	},
	primaryInputParameter: 'inputA',
	resolutionInputParameters: ['inputA', 'inputB'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
