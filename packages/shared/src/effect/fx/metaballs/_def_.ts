// Adapted from Paper Design's Metaballs (Apache-2.0; see LICENSE and NOTICE).
// Modified: color array, node background, explicit time and Glitch Studio sizing.
import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'metaballs',
	displayName: 'Metaballs',
	tags: [],
	primaryInputParameter: 'background',
	paramDefs: {
		background: { dataType: { kind: 'color' }, ui: { label: 'Background', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 1] } },
		colors: {
			dataType: { kind: 'array', elementType: { kind: 'color' } },
			ui: { label: 'Colors', control: { element: {} } },
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
			element: { canNode: true, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] } },
		},
		// 小数部分で最後のボールの大きさを変えるため、整数に丸めない。
		count: { dataType: { kind: 'scalar' }, ui: { label: 'Count', control: { controlType: 'range', min: 1, max: 20, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 10 } },
		size: { dataType: { kind: 'scalar' }, ui: { label: 'Size', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.83 } },
		time: { dataType: { kind: 'scalar' }, ui: { label: 'Time', control: { controlType: 'number', step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0 } },
		fitMode: { dataType: { kind: 'fitMode' }, ui: { label: 'Fit Mode', control: {} }, defaultValue: { inputSource: 'literal', value: 'contain' } },
		scale: { dataType: { kind: 'scalar' }, ui: { label: 'Scale', control: { controlType: 'range', min: 0.01, max: 4, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1 } },
		angle: { dataType: { kind: 'scalar' }, ui: { label: 'Angle', control: { controlType: 'angle' } }, defaultValue: { inputSource: 'literal', value: 0 } },
		offset: { dataType: { kind: 'vector' }, ui: { label: 'Offset', control: { controlType: 'vector', min: -1, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: [0, 0] } },
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'color' } },
	},
});
