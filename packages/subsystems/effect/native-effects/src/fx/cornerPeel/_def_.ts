import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Corner Peel',
	summary: {
		'ja-JP': '画像Aの隅を対角方向へ剥がし、丸まった紙の裏面と下の画像Bを見せます。',
		'en-US': 'Peels a corner of image A diagonally, revealing the curled back and image B underneath.',
	},
	kind: 'modify',
	thumbnail: {
		mode: 'customParameters',
		inputs: { inputA: 'sceneA', inputB: 'sceneB' },
		params: { progress: 0.52 },
	},
	dependsOnRenderHistory: false,
	tags: ['composite', 'transition', 'distortion', '3d'],
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
		corner: {
			dataType: { kind: 'enum', options: ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] },
			ui: { label: 'Corner', control: { labels: { topLeft: 'Top Left', topRight: 'Top Right', bottomLeft: 'Bottom Left', bottomRight: 'Bottom Right' } } },
			defaultValue: 'topRight',
		},
		curlRadius: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Curl Radius (Reference Ratio)', control: { controlType: 'range', min: 0, max: 0.5, step: 0.001 } },
			defaultValue: 0.08,
		},
		backMode: {
			dataType: { kind: 'enum', options: ['source', 'color', 'input'] },
			ui: { label: 'Back Mode', control: { labels: { source: 'Tinted Front', color: 'Solid Color', input: 'Back Image' } } },
			defaultValue: 'source',
		},
		backColor: {
			dataType: { kind: 'color' },
			ui: { label: 'Back Color', control: {} },
			canNode: true,
			defaultValue: [0.92, 0.90, 0.84, 1],
		},
		backInput: {
			dataType: { kind: 'color' },
			ui: { label: 'Back Image', control: {} },
			canNode: true,
			defaultValue: [0, 0, 0, 0],
		},
		shadowOpacity: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Shadow Opacity', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: 0.35,
		},
		shadowSoftness: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Shadow Softness (Reference Ratio)', control: { controlType: 'range', min: 0, max: 0.5, step: 0.001 } },
			defaultValue: 0.02,
		},
		shading: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Shading', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: 0.6,
		},
		sizeReference: {
			dataType: { kind: 'sizeReference' },
			ui: { label: 'Size Reference', isAdvanced: true, control: {} },
			defaultValue: 'longSide',
		},
	},
	primaryInputParameter: 'inputA',
	resolutionInputParameters: ['inputA', 'inputB', 'backInput'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
