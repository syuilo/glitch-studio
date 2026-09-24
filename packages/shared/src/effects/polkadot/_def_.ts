import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'polkadot',
	displayName: 'Polka dot',
	tags: ['pattern'],
	paramDefs: {
		background: { dataType: 'color', ui: { label: 'Background', control: 'color' }, canNode: true, primary: true, defaultValue: { inputSource: 'node', nodeId: null, outputPort: null } },
		size: { dataType: 'vector', ui: { label: 'Size', control: 'vector', min: 0, max: 1, step: 0.001 }, canNode: true, defaultValue: { inputSource: 'literal', value: [1 / 3, 1 / 3] } },
		angle: { dataType: 'scalar', ui: { label: 'Angle', control: 'angle' }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		majorRadius: { dataType: 'scalar', ui: { label: 'Major radius', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.1 } },
		majorColor: { dataType: 'color', ui: { label: 'Major color', control: 'color' }, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 0.75] } },
		minorDivisions: { dataType: 'scalar', ui: { label: 'Minor divisions', control: 'range', min: 0, max: 16, step: 1 }, defaultValue: { inputSource: 'literal', value: 4 } },
		minorRadius: { dataType: 'scalar', ui: { label: 'Minor radius', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.25 } },
		minorColor: { dataType: 'color', ui: { label: 'Minor color', control: 'color' }, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 0.5] } },
		fitMode: { dataType: 'fitMode', ui: { label: 'Fit Mode', control: 'fitMode' }, defaultValue: { inputSource: 'literal', value: 'cover' } },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
