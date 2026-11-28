import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export const MAX_BLOCK_COUNT = 512;

export default defineNativeEffect({
	displayName: 'Block Glitch',
	summary: {
		'ja-JP': '散らばった矩形の中で画像と色チャンネルをずらし、映像が断片的に乱れるグリッチを作ります。',
		'en-US': 'Offsets the image and color channels within scattered rectangles to create a fragmented glitch.',
	},
	kind: 'modify',
	tags: ['glitch', 'distortion'],
	thumbnail: { mode: 'defaultParameters' },
	dependsOnRenderHistory: false,
	paramDefs: {
		image: {
			dataType: { kind: 'color' },
			ui: { label: 'Image', control: {} },
			defaultValue: [0, 0, 0, 0],
			canNode: true,
		},
		blockCount: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Block Count', control: { controlType: 'range', min: 0, max: MAX_BLOCK_COUNT, step: 1 } },
			defaultValue: 32,
		},
		seed: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Seed', control: { controlType: 'seed' } },
			defaultValue: 0,
		},
		dimension: {
			dataType: { kind: 'vector' },
			ui: { label: 'Dimension', control: { controlType: 'dimension', min: 0, max: 1, step: 0.001 } },
			defaultValue: [0.14, 0.045],
		},
		aspectRatioRandomness: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Aspect Ratio Randomness', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: 0.35,
		},
		scaleRandomness: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Scale Randomness', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: 0.6,
		},
		angle: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Angle', control: { controlType: 'angle', step: 1 / 360 } },
			defaultValue: 0,
		},
		angleSpread: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Angle Spread', control: { controlType: 'angle', step: 1 / 360 } },
			defaultValue: 0,
		},
		imageSource: {
			dataType: { kind: 'enum', options: ['shift', 'randomPosition'] },
			ui: { label: 'Image Source', control: { labels: { shift: 'Shift', randomPosition: 'Random Position' } } },
			defaultValue: 'shift',
		},
		maxImageShift: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Max Image Shift', control: { controlType: 'range', min: 0, max: 0.25, step: 0.001 } },
			defaultValue: 0.05,
		},
		maxChannelShift: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Max Channel Shift', control: { controlType: 'range', min: 0, max: 0.1, step: 0.001 } },
			defaultValue: 0.008,
		},
	},
	primaryInputParameter: 'image',
	resolutionInputParameters: ['image'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
