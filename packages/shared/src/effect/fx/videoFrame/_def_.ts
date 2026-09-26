import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'videoFrame',
	displayName: 'Video Frame',
	tags: ['video'],
	primaryInputParameter: null,
	paramDefs: {
		asset: { dataType: { kind: 'videoAssetReference' }, ui: { label: 'Asset', control: {} }, defaultValue: { inputSource: 'literal', value: null } },
		time: { dataType: { kind: 'scalar' }, ui: { label: 'Time', control: { controlType: 'number', step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0 } },
		fit: { dataType: { kind: 'fitMode' }, ui: { label: 'Fit', control: {} }, defaultValue: { inputSource: 'literal', value: 'contain' } },
		outOfRange: {
			dataType: { kind: 'enum', options: ['clamp', 'loop', 'transparent'] },
			ui: { label: 'Out of range', control: { labels: { 'clamp': 'Clamp', 'loop': 'Loop', 'transparent': 'Transparent' } } },
			defaultValue: { inputSource: 'literal', value: 'clamp' },
		},
	},
	outputDefs: { output: { primary: true, dataType: { kind: 'color' } } },
});
