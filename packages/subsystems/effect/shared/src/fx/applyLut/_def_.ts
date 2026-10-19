import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'applyLut',
	displayName: 'Apply LUT',
	description: {
		'ja-JP': '.cubeの1D・3D LUTをRGBへ直接適用します。色空間変換は行いません。',
		'en-US': 'Applies a .cube 1D or 3D LUT directly to RGB without color space conversion.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['color'],
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		lut: { dataType: { kind: 'assetReference', assetType: 'lut' }, ui: { label: 'LUT', control: {} }, defaultValue: { inputSource: 'literal', value: null } },
	},
	primaryInputParameter: 'input',
	resolutionInputParameter: 'input',
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
