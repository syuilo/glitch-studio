import { defineEffect } from '../effect-definition.ts';

export default defineEffect({
	id: 'waveform',
	displayName: 'Waveform',
	tags: [],
	paramDefs: {
		input: { type: 'node', label: 'Input', dataType: 'color', primary: true, default: () => ({ type: 'literal', value: null }) },
		resolution: { type: 'enum', label: 'Resolution', options: [
			{ label: '1/1', value: 1 },
			{ label: '1/2', value: 2 },
			{ label: '1/4', value: 4 },
			{ label: '1/8', value: 8 },
			{ label: '1/16', value: 16 },
		], default: () => ({ type: 'literal', value: 1 }) },
		direction: { type: 'enum', label: 'Direction', options: [
			{ label: 'Horizontal', value: 'horizontal' },
			{ label: 'Vertical', value: 'vertical' },
		], default: () => ({ type: 'literal', value: 'horizontal' }) },
		mode: { type: 'enum', label: 'Mode', options: [
			{ label: 'RGB', value: 'rgb' },
			{ label: 'Luminance', value: 'luminance' },
		], default: () => ({ type: 'literal', value: 'rgb' }) },
		intensity: { type: 'range', label: 'Intensity', min: 0, max: 10, step: 0.01, default: () => ({ type: 'literal', value: 1 }) },
		showGrid: { type: 'bool', label: 'Grid', default: () => ({ type: 'literal', value: false }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
