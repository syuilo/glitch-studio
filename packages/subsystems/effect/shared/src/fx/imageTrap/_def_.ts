import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'imageTrap',
	displayName: 'Image Trap',
	description: {
		'ja-JP': 'Mandelbrot・Juliaの反復軌道で入力画像を参照し、フラクタル状に繰り返して合成します。',
		'en-US': 'Samples and composites an input image along Mandelbrot or Julia orbits to create fractal repetitions.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['pattern', 'distortion', 'math', 'gimmicky', 'experimental'],
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		formula: {
			dataType: { kind: 'enum', options: ['julia', 'mandelbrot'] },
			ui: { label: 'Formula', control: { labels: { julia: 'Julia', mandelbrot: 'Mandelbrot' } } },
			defaultValue: { inputSource: 'literal', value: 'julia' },
		},
		juliaConstant: {
			dataType: { kind: 'vector' },
			ui: { label: 'Julia Constant', control: { controlType: 'vector', min: -2, max: 2, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: [-0.745, 0.186] },
		},
		complexCenter: {
			dataType: { kind: 'vector' },
			ui: { label: 'Complex Center', control: { controlType: 'vector', min: -2, max: 2, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		zoom: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Zoom', control: { controlType: 'range', min: 0.1, max: 1000, logarithmic: true } },
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		rotation: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Rotation', control: { controlType: 'angle' } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		coordinateOffset: {
			dataType: { kind: 'vector' },
			ui: { label: 'Coordinate Offset', control: { controlType: 'vector', min: -0.5, max: 0.5, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		trapPosition: {
			dataType: { kind: 'vector' },
			ui: { label: 'Trap Position', control: { controlType: 'xy', min: -0.5, max: 0.5, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		trapSize: {
			dataType: { kind: 'vector' },
			ui: { label: 'Trap Size', control: { controlType: 'dimension', min: 0.01, max: 1, logarithmic: true } },
			defaultValue: { inputSource: 'literal', value: [0.25, 0.25] },
		},
		trapRotation: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Trap Rotation', control: { controlType: 'angle' } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		compositeMode: {
			dataType: { kind: 'enum', options: ['firstOnTop', 'lastOnTop', 'maximumAlpha'] },
			ui: { label: 'Composite Mode', control: { labels: {
				firstOnTop: 'First On Top', lastOnTop: 'Last On Top', maximumAlpha: 'Maximum Alpha',
			} } },
			defaultValue: { inputSource: 'literal', value: 'firstOnTop' },
		},
		opacity: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Sample Opacity', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		iterationDecay: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Iteration Decay', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0.98 },
		},
		firstIteration: {
			dataType: { kind: 'scalar' },
			ui: { label: 'First Iteration', control: { controlType: 'range', min: 1, max: 512, step: 1 } },
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		maximumIterations: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Maximum Iterations', control: { controlType: 'range', min: 1, max: 512, step: 1 } },
			defaultValue: { inputSource: 'literal', value: 128 },
		},
		bailoutRadius: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Bailout Radius', control: { controlType: 'range', min: 2, max: 256, logarithmic: true } },
			defaultValue: { inputSource: 'literal', value: 4 },
		},
		antialiasing: {
			dataType: { kind: 'bool' },
			ui: { label: 'Antialiasing', control: {} },
			defaultValue: { inputSource: 'literal', value: false },
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
