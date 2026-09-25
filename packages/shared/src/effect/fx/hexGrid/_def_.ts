import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'hexGrid',
	displayName: 'Hex grid',
	tags: ['pattern'],
	primaryInputParameter: 'background',
	paramDefs: {
		background: { dataType: 'color', ui: { label: 'Background', control: 'color' }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		size: { dataType: 'vector', ui: { label: 'Size', control: 'vector', min: 0, max: 1, step: 0.001 }, canNode: true, defaultValue: { inputSource: 'literal', value: [1 / 3, 1 / 3] } },
		angle: { dataType: 'scalar', ui: { label: 'Angle', control: 'angle' }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		lineWidth: { dataType: 'scalar', ui: { label: 'Line width', control: 'range', min: 0, max: 1, step: 0.001 }, defaultValue: { inputSource: 'literal', value: 0.036 } },
		lineColor: { dataType: 'color', ui: { label: 'Line color', control: 'color' }, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 0.75] } },
		fitMode: { dataType: 'fitMode', ui: { label: 'Fit Mode', control: 'fitMode' }, defaultValue: { inputSource: 'literal', value: 'cover' } },
	},
	outputDefs: {
		output: { primary: true, dataType: 'color' },
	},
});
