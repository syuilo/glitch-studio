import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'videoFrame',
	displayName: 'Video Frame',
	tags: ['video'],
	primaryInputParameter: null,
	paramDefs: {
		asset: {
			dataType: 'videoAssetReference',
			ui: { label: 'Asset', control: 'videoAsset' },
			defaultValue: { inputSource: 'literal', value: null },
		},
		time: {
			dataType: 'scalar',
			ui: { label: 'Time', control: 'number', step: 0.01 },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		fit: {
			dataType: 'fitMode',
			ui: { label: 'Fit', control: 'fitMode' },
			defaultValue: { inputSource: 'literal', value: 'contain' },
		},
		outOfRange: {
			dataType: 'enum',
			ui: { label: 'Out of range', control: 'enum' },
			options: [
				{ label: 'Clamp', value: 'clamp' },
				{ label: 'Loop', value: 'loop' },
				{ label: 'Transparent', value: 'transparent' },
			],
			defaultValue: { inputSource: 'literal', value: 'clamp' },
		},
	},
	outputDefs: { output: { primary: true, dataType: 'color' } },
});
