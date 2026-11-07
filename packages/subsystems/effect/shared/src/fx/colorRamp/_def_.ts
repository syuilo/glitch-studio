import { createDefaultColorRamp } from '@gs/shared/color-ramp.ts';
import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'colorRamp',
	displayName: 'Color Ramp',
	description: {
		'ja-JP': 'スカラー値をグラデーションに沿った色に変換します。',
		'en-US': 'Maps scalar values to colors along a gradient.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['color', 'gradient', 'convert'],
	paramDefs: {
		input: { dataType: { kind: 'scalar' }, ui: { label: 'Input', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		ramp: { dataType: { kind: 'colorRamp' }, ui: { label: 'Ramp', control: {} }, defaultValue: { inputSource: 'literal', value: createDefaultColorRamp() } },
		mode: {
			dataType: { kind: 'enum', options: ['clamp', 'wrap', 'pingPong'] },
			ui: { label: 'Mode', control: { labels: { clamp: 'Clamp', wrap: 'Wrap', pingPong: 'Ping-pong' } } },
			defaultValue: { inputSource: 'literal', value: 'clamp' },
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
