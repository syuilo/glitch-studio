import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'radialWipe',
	displayName: 'Radial Wipe',
	description: {
		'ja-JP': '中心の周りを回る扇形の境界で、画像Aから画像Bへ切り替えます。',
		'en-US': 'Transitions from image A to image B with an angular sweep around a center.',
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
		progress: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Progress', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		center: {
			dataType: { kind: 'vector' },
			ui: { label: 'Center', control: { controlType: 'xy', min: -0.5, max: 0.5, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		startAngle: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Start Angle', control: { controlType: 'angle' } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		direction: {
			dataType: { kind: 'enum', options: ['clockwise', 'counterclockwise', 'both'] },
			ui: { label: 'Direction', control: { labels: { clockwise: 'Clockwise', counterclockwise: 'Counterclockwise', both: 'Both' } } },
			defaultValue: { inputSource: 'literal', value: 'clockwise' },
		},
		featherUnit: {
			dataType: { kind: 'enum', options: ['distance', 'angle'] },
			ui: { label: 'Feather Unit', control: { labels: { distance: 'Distance (Reference Ratio)', angle: 'Angle (Turns)' } } },
			defaultValue: { inputSource: 'literal', value: 'distance' },
		},
		feather: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Feather', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } },
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
		output: { dataType: { kind: 'color' }, canLazyAllocation: true },
		mask: { dataType: { kind: 'scalar' }, label: 'Mask', canLazyAllocation: true },
	},
	primaryOutput: 'output',
});

