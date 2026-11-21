import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'JPEG Compression',
	summary: {
		'ja-JP': 'JPEG圧縮による細部の消失、色のにじみ、ブロック模様を再現します。',
		'en-US': 'Simulates detail loss, chroma bleeding, and block artifacts from JPEG compression.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['glitch'],
	paramDefs: {
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: 'longSide' },
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: [0, 0, 0, 0],
		},
		quality: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Quality',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.001,
				},
			},
			canNode: true,
			defaultValue: 0.6,
		},
		blockSize: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Block Size (% of Reference)',
				control: {
					controlType: 'range',
					min: 0.5,
					max: 10,
					step: 0.1,
				},
			},
			defaultValue: 2,
		},
		blockOrigin: {
			dataType: { kind: 'enum', options: ['topLeft', 'center'] },
			ui: { label: 'Block Origin', control: { labels: { topLeft: 'Top Left', center: 'Center' } } },
			defaultValue: 'center',
		},
		preserveDetails: { dataType: { kind: 'bool' }, ui: { label: 'Preserve Input Detail', control: {} }, defaultValue: true },
		chromaSubsampling: {
			dataType: { kind: 'enum', options: ['444', '420'] },
			ui: { label: 'Chroma Subsampling', control: { labels: { '444': '4:4:4 (Off)', '420': '4:2:0' } } },
			defaultValue: '420',
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
