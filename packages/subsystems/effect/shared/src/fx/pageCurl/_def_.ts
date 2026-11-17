import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'pageCurl',
	displayName: 'Page Curl',
	description: {
		'ja-JP': '画像Aを紙のように丸めて裏面を見せながらめくり、下の画像Bへ切り替えます。',
		'en-US': 'Curls image A like a sheet of paper, revealing its back and image B underneath.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['composite', 'transition', 'distortion', '3d'],
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
		startEdge: {
			dataType: { kind: 'enum', options: ['left', 'right', 'top', 'bottom'] },
			ui: { label: 'Start Edge', control: { labels: { left: 'Left', right: 'Right', top: 'Top', bottom: 'Bottom' } } },
			defaultValue: { inputSource: 'literal', value: 'right' },
		},
		curlRadius: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Curl Radius (Reference Ratio)', control: { controlType: 'range', min: 0, max: 0.5, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0.08 },
		},
		backMode: {
			dataType: { kind: 'enum', options: ['source', 'color', 'input'] },
			ui: { label: 'Back Mode', control: { labels: { source: 'Tinted Front', color: 'Solid Color', input: 'Back Image' } } },
			defaultValue: { inputSource: 'literal', value: 'source' },
		},
		backColor: {
			dataType: { kind: 'color' },
			ui: { label: 'Back Color', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0.92, 0.90, 0.84, 1] },
		},
		backInput: {
			dataType: { kind: 'color' },
			ui: { label: 'Back Image', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		shadowOpacity: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Shadow Opacity', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0.35 },
		},
		shadowSoftness: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Shadow Softness (Reference Ratio)', control: { controlType: 'range', min: 0, max: 0.5, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0.02 },
		},
		shading: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Shading', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0.6 },
		},
		sizeReference: {
			dataType: { kind: 'sizeReference' },
			ui: { label: 'Size Reference', isAdvanced: true, control: {} },
			defaultValue: { inputSource: 'literal', value: 'longSide' },
		},
	},
	primaryInputParameter: 'inputA',
	resolutionInputParameters: ['inputA', 'inputB', 'backInput'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
