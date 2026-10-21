import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'contentErrorPropagation',
	displayName: 'Content Error Propagation',
	description: {
		'ja-JP': '画像の輪郭や色の変化に沿って色の誤差を伝播させます。元画像の細部と透明度を保ち、強い境界で伝播を抑えます。',
		'en-US': 'Propagates color errors along image contours and color changes while preserving input detail and alpha. Strong boundaries can block propagation.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['glitch', 'color', 'stylized'],
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		sourceProbability: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Source Probability',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: 0.12 },
		},
		sourceSpacing: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Source Spacing (% of Short Side)',
				control: {
					controlType: 'range',
					min: 0.5,
					max: 20,
					step: 0.1,
				},
			},
			defaultValue: { inputSource: 'literal', value: 4 },
		},
		sourceSize: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Source Size / Spacing',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: 0.2 },
		},
		errorMode: {
			dataType: { kind: 'enum', options: ['rgb', 'luminance', 'chroma'] },
			ui: { label: 'Error Mode', control: { labels: { rgb: 'RGB', luminance: 'Luminance', chroma: 'Chroma' } } },
			defaultValue: { inputSource: 'literal', value: 'chroma' },
		},
		flowMode: {
			dataType: { kind: 'enum', options: ['contour', 'gradient', 'fixed'] },
			ui: { label: 'Propagation Path', control: { labels: { contour: 'Along Contours', gradient: 'Across Contours', fixed: 'Fixed Direction' } } },
			defaultValue: { inputSource: 'literal', value: 'contour' },
		},
		following: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Content Following',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		angle: { dataType: { kind: 'scalar' }, ui: { label: 'Fallback Direction', control: { controlType: 'angle' } }, defaultValue: { inputSource: 'literal', value: 0 } },
		guidanceRadius: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Guidance Radius (% of Short Side)',
				control: {
					controlType: 'range',
					min: 0.1,
					max: 5,
					step: 0.1,
				},
			},
			defaultValue: { inputSource: 'literal', value: 0.8 },
		},
		propagationLength: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Propagation Length (% of Short Side)',
				control: {
					controlType: 'range',
					min: 0,
					max: 50,
					step: 0.5,
				},
			},
			defaultValue: { inputSource: 'literal', value: 20 },
		},
		retention: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Retention at Full Length',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: 0.2 },
		},
		boundaryThreshold: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Boundary Threshold',
				control: {
					controlType: 'range',
					min: 0.01,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: 0.12 },
		},
		boundaryStrength: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Boundary Blocking',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		steps: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Propagation Steps',
				control: {
					controlType: 'range',
					min: 1,
					max: 256,
					step: 1,
				},
			},
			defaultValue: { inputSource: 'literal', value: 64 },
		},
		analysisResolution: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Analysis Resolution (Short Side)',
				control: {
					controlType: 'range',
					min: 128,
					max: 1024,
					step: 128,
				},
			},
			defaultValue: { inputSource: 'literal', value: 512 },
		},
		seed: { dataType: { kind: 'scalar' }, ui: { label: 'Seed', control: { controlType: 'seed' } }, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	primaryInputParameter: 'input',
	resolutionInputParameter: 'input',
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
