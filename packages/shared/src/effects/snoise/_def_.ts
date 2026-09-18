import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'snoise',
	displayName: 'snoise',
	tags: [],
	paramDefs: {
		scale: { type: 'vector', label: 'Scale', min: 0, max: 16, step: 0.01, canNode: true, default: () => ({ type: 'literal', value: [1, 1] }) },
		offset: { type: 'vector', label: 'Offset', min: 0, max: 16, step: 0.01, default: () => ({ type: 'literal', value: [0, 0] }) },
		outputMin: { type: 'number', label: 'Output Min', step: 0.01, canNode: true, default: () => ({ type: 'literal', value: -1 }) },
		outputMax: { type: 'number', label: 'Output Max', step: 0.01, canNode: true, default: () => ({ type: 'literal', value: 1 }) },
		// canNodeでは環境によってTimeが16bitテクスチャに丸められ、経過時間とともに
		// 値の刻みが粗くなって動きがカクつくため、32bitのuniformで渡す。
		time: { type: 'range', min: 0, max: 100, step: 0.01, label: 'Time', canNode: false, default: () => ({ type: 'expression', expression: 'TIME' }) },
		seed: { type: 'seed', label: 'Seed', canNode: false, default: () => ({ type: 'literal', value: 0 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'scalar' },
	},
});
