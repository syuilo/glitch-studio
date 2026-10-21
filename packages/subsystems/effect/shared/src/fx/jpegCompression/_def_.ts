import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'jpegCompression',
	displayName: 'JPEG Compression',
	description: {
		'ja-JP': 'JPEG圧縮による細部の消失、色のにじみ、ブロック模様を再現します。Qualityにノードを接続すると、ブロックごとに圧縮の強さを変えられます。',
		'en-US': 'Simulates detail loss, chroma bleeding, and block artifacts from JPEG compression. Connect a node to Quality to control compression per block.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['color', 'pixel', 'stylized'],
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
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
			defaultValue: { inputSource: 'literal', value: 0.6 },
		},
		blockSize: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Block Size (% of Short Side)',
				control: {
					controlType: 'range',
					min: 0.5,
					max: 10,
					step: 0.1,
				},
			},
			defaultValue: { inputSource: 'literal', value: 2 },
		},
		blockOrigin: {
			dataType: { kind: 'enum', options: ['topLeft', 'center'] },
			ui: { label: 'Block Origin', control: { labels: { topLeft: 'Top Left', center: 'Center' } } },
			defaultValue: { inputSource: 'literal', value: 'center' },
		},
		preserveDetails: { dataType: { kind: 'bool' }, ui: { label: 'Preserve Input Detail', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
		chromaSubsampling: {
			dataType: { kind: 'enum', options: ['444', '420'] },
			ui: { label: 'Chroma Subsampling', control: { labels: { '444': '4:4:4 (Off)', '420': '4:2:0' } } },
			defaultValue: { inputSource: 'literal', value: '420' },
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameter: 'input',
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
