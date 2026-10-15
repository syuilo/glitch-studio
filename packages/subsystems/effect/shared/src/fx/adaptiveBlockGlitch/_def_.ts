import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'adaptiveBlockGlitch',
	displayName: 'Adaptive block glitch',
	description: {
		'ja-JP': '入力の色・透明度の変化に応じて大小のブロックに分割し、位置ずれや色の破損を加えます。',
		'en-US': 'Divides the input into blocks sized according to color and opacity variation, then applies displacement and color corruption.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['glitch', 'pixel', 'color', 'stylized'],
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		maxBlockSize: { dataType: { kind: 'scalar' }, ui: { label: 'Maximum block size (% of short side)', control: { controlType: 'range', min: 5, max: 100, step: 1 } }, defaultValue: { inputSource: 'literal', value: 25 } },
		subdivisions: { dataType: { kind: 'scalar' }, ui: { label: 'Subdivision levels', control: { controlType: 'range', min: 0, max: 8, step: 1 } }, defaultValue: { inputSource: 'literal', value: 5 } },
		threshold: { dataType: { kind: 'scalar' }, ui: { label: 'Detail threshold', control: { controlType: 'range', min: 0, max: 0.3, step: 0.001 } }, defaultValue: { inputSource: 'literal', value: 0.06 } },
		analysisSamples: { dataType: { kind: 'scalar' }, ui: { label: 'Analysis samples per axis', control: { controlType: 'range', min: 1, max: 8, step: 1 } }, defaultValue: { inputSource: 'literal', value: 4 } },
		amount: { dataType: { kind: 'scalar' }, ui: { label: 'Corruption probability', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.6 } },
		strength: { dataType: { kind: 'scalar' }, ui: { label: 'Strength', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1 } },
		displacement: { dataType: { kind: 'scalar' }, ui: { label: 'Displacement (block widths)', control: { controlType: 'range', min: 0, max: 4, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1 } },
		snapToBlocks: { dataType: { kind: 'bool' }, ui: { label: 'Snap displacement to blocks', control: {} }, defaultValue: { inputSource: 'literal', value: false } },
		colorShift: { dataType: { kind: 'scalar' }, ui: { label: 'Color error', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.2 } },
		channelShift: { dataType: { kind: 'scalar' }, ui: { label: 'Channel displacement (block widths)', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.1 } },
		flattenBlocks: { dataType: { kind: 'bool' }, ui: { label: 'Flatten blocks', control: {} }, defaultValue: { inputSource: 'literal', value: false } },
		preserveAlpha: { dataType: { kind: 'bool' }, ui: { label: 'Preserve alpha', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
		outline: { dataType: { kind: 'scalar' }, ui: { label: 'Block outline width', control: { controlType: 'range', min: 0, max: 0.1, step: 0.001 } }, defaultValue: { inputSource: 'literal', value: 0 } },
		seed: { dataType: { kind: 'scalar' }, ui: { label: 'Seed', control: { controlType: 'seed' } }, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	primaryInputParameter: 'input',
	resolutionInputParameter: 'input',
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
