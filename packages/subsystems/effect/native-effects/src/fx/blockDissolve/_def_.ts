import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Block Dissolve',
	summary: {
		'ja-JP': '正方形のセルごとに、ランダムまたは指定方向の順序で画像Aを画像Bへ切り替えます。',
		'en-US': 'Transitions from image A to image B in square cells, in random or directional order.',
	},
	kind: 'modify',
	thumbnail: {
		mode: 'customParameters',
		inputs: { inputA: 'sceneA', inputB: 'sceneB' },
		params: { progress: 0.48, cellSize: 0.14 },
	},
	dependsOnRenderHistory: false,
	tags: ['composite', 'transition'],
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
			canNode: true,
			defaultValue: 0,
		},
		cellSize: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Cell Size (Reference Ratio)', control: { controlType: 'range', min: 0.001, max: 1, step: 0.001 } },
			defaultValue: 0.05,
		},
		order: {
			dataType: { kind: 'enum', options: ['random', 'leftToRight', 'topToBottom'] },
			ui: { label: 'Order', control: { labels: { random: 'Random', leftToRight: 'Left to Right', topToBottom: 'Top to Bottom' } } },
			defaultValue: 'random',
		},
		reverse: {
			dataType: { kind: 'bool' },
			ui: { label: 'Reverse Order', control: {} },
			defaultValue: false,
		},
		seed: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Seed', control: { controlType: 'seed' } },
			defaultValue: 0,
		},
		softness: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Softness (Transition Timing)', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } },
			defaultValue: 0.1,
		},
		gridOffset: {
			dataType: { kind: 'vector' },
			ui: { label: 'Grid Offset', isAdvanced: true, control: { controlType: 'xy', min: -0.5, max: 0.5, step: 0.001 } },
			defaultValue: [0, 0],
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
		mask: { dataType: { kind: 'scalar' }, label: 'Mask', inputParameters: ['progress', 'cellSize', 'order', 'reverse', 'seed', 'softness', 'gridOffset', 'sizeReference'] },
	},
	primaryOutput: 'output',
});

