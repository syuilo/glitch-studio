import { createDefaultColorRamp } from '@gs/shared/color-ramp.ts';
import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Color Ramp',
	summary: {
		'ja-JP': 'スカラー値をグラデーションに沿った色に変換します。',
		'en-US': 'Maps scalar values to colors along a gradient.',
	},
	kind: 'modify',
	thumbnail: { mode: 'none' },
	dependsOnRenderHistory: false,
	tags: ['color', 'gradient', 'convert'],
	paramDefs: {
		input: { dataType: { kind: 'scalar' }, ui: { label: 'Input', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, canNode: true, defaultValue: 0 },
		ramp: { dataType: { kind: 'colorRamp' }, ui: { label: 'Ramp', control: {} }, defaultValue: createDefaultColorRamp() },
		repeatCount: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Repeat Count', control: { controlType: 'number', min: 0, step: 0.1 } },
			canNode: true,
			defaultValue: 1,
		},
		repeatMode: {
			dataType: { kind: 'enum', options: ['wrap', 'pingPong'] },
			ui: { label: 'Repeat Mode', control: { labels: { wrap: 'Wrap', pingPong: 'Ping-pong' } } },
			defaultValue: 'wrap',
		},
		mode: {
			dataType: { kind: 'enum', options: ['clamp', 'wrap', 'pingPong'] },
			ui: { label: 'Input Range Mode', control: { labels: { clamp: 'Clamp', wrap: 'Wrap', pingPong: 'Ping-pong' } } },
			defaultValue: 'clamp',
		},
	},
	primaryInputParameter: 'input',
	// 繰り返し数だけがスカラー場の場合も、その場の解像度で画素ごとの変化を描画する。
	resolutionInputParameters: ['input', 'repeatCount'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
