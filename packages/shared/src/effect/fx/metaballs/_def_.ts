// Adapted from Paper Design's Metaballs (Apache-2.0; see LICENSE and NOTICE).
// Modified: color array, node background, explicit time and Glitch Studio sizing.
import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'metaballs',
	displayName: 'Metaballs',
	tags: [],
	primaryInputParameter: 'background',
	paramDefs: {
		background: { dataType: 'color', ui: { label: 'Background', control: 'color' }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 1] } },
		colors: {
			dataType: 'array',
			ui: { label: 'Colors' },
			item: {
				dataType: 'color', ui: { label: 'Color', control: 'color' }, canNode: true,
				defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] },
			},
			defaultValue: {
				inputSource: 'literal',
				value: [
					{ inputSource: 'literal', value: [110 / 255, 51 / 255, 204 / 255, 1] },
					{ inputSource: 'literal', value: [1, 85 / 255, 0, 1] },
					{ inputSource: 'literal', value: [1, 193 / 255, 5 / 255, 1] },
					{ inputSource: 'literal', value: [1, 200 / 255, 0, 1] },
					{ inputSource: 'literal', value: [245 / 255, 133 / 255, 1, 1] },
				],
			},
		},
		// 小数部分で最後のボールの大きさを変えるため、整数に丸めない。
		count: { dataType: 'scalar', ui: { label: 'Count', control: 'range', min: 1, max: 20, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 10 } },
		size: { dataType: 'scalar', ui: { label: 'Size', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.83 } },
		time: { dataType: 'scalar', ui: { label: 'Time', control: 'number', step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0 } },
		fitMode: { dataType: 'fitMode', ui: { label: 'Fit Mode', control: 'fitMode' }, defaultValue: { inputSource: 'literal', value: 'contain' } },
		scale: { dataType: 'scalar', ui: { label: 'Scale', control: 'range', min: 0.01, max: 4, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 1 } },
		angle: { dataType: 'scalar', ui: { label: 'Angle', control: 'angle' }, defaultValue: { inputSource: 'literal', value: 0 } },
		offset: { dataType: 'vector', ui: { label: 'Offset', control: 'vector', min: -1, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: [0, 0] } },
	},
	outputDefs: {
		output: { primary: true, dataType: 'color' },
	},
});
