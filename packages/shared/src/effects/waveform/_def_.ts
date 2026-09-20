import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'waveform',
	displayName: 'Waveform',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { control: 'color' }, label: 'Input', canNode: true, primary: true, default: () => ({ inputSource: 'node', nodeId: null, outputPort: null }) },
		resolution: { dataType: 'enum', ui: { control: 'enum' }, label: 'Resolution', options: [
			{ label: '1/1', value: 1 },
			{ label: '1/2', value: 2 },
			{ label: '1/4', value: 4 },
			{ label: '1/8', value: 8 },
			{ label: '1/16', value: 16 },
		], default: () => ({ inputSource: 'literal', value: 1 }) },
		direction: { dataType: 'enum', ui: { control: 'enum' }, label: 'Direction', options: [
			{ label: 'Horizontal', value: 'horizontal' },
			{ label: 'Vertical', value: 'vertical' },
		], default: () => ({ inputSource: 'literal', value: 'horizontal' }) },
		mode: { dataType: 'enum', ui: { control: 'enum' }, label: 'Mode', options: [
			{ label: 'RGB', value: 'rgb' },
			{ label: 'Luminance', value: 'luminance' },
		], default: () => ({ inputSource: 'literal', value: 'rgb' }) },
		intensity: { dataType: 'scalar', ui: { control: 'range', min: 0, max: 10, step: 0.01 }, label: 'Intensity', default: () => ({ inputSource: 'literal', value: 1 }) },
		showGrid: { dataType: 'bool', ui: { control: 'bool' }, label: 'Grid', default: () => ({ inputSource: 'literal', value: false }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
