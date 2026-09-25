import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'snoise',
	displayName: 'snoise',
	tags: [],
	primaryInputParameter: null,
	paramDefs: {
		scale: { dataType: 'vector', ui: { label: 'Scale', control: 'vector', min: 0, max: 16, step: 0.01 }, canNode: true, defaultValue: { inputSource: 'literal', value: [1, 1] } },
		offset: { dataType: 'vector', ui: { label: 'Offset', control: 'vector', min: 0, max: 16, step: 0.01 }, defaultValue: { inputSource: 'literal', value: [0, 0] } },
		outputMin: { dataType: 'scalar', ui: { label: 'Output Min', control: 'number', step: 0.01 }, canNode: true, defaultValue: { inputSource: 'literal', value: -1 } },
		outputMax: { dataType: 'scalar', ui: { label: 'Output Max', control: 'number', step: 0.01 }, canNode: true, defaultValue: { inputSource: 'literal', value: 1 } },
		// canNodeでは環境によってTimeが16bitテクスチャに丸められ、経過時間とともに
		// 値の刻みが粗くなって動きがカクつくため、32bitのuniformで渡す。
		time: { dataType: 'scalar', ui: { label: 'Time', control: 'number', step: 0.01 }, canNode: false, defaultValue: { inputSource: 'literal', value: 0 } },
		seed: { dataType: 'scalar', ui: { label: 'Seed', control: 'seed' }, canNode: false, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	outputDefs: {
		output: { primary: true, dataType: 'scalar' },
	},
});
