import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'geometricOptics2d',
	displayName: '2D Geometric Optics',
	description: {
		'ja-JP': 'SDFで配置した鏡・透明物体・遮蔽物に光を当て、反射・屈折・分散の光路を描画します。',
		'en-US': 'Traces reflection, refraction and dispersion through SDF mirrors, dielectrics and blockers in 2D.',
	},
	kind: 'generate',
	dependsOnRenderHistory: false,
	tags: ['light', 'simulation', 'sdf'],
	paramDefs: {
		objects: {
			dataType: { kind: 'array', elementType: { kind: 'struct', fields: {
				sdf: { kind: 'scalar' },
				material: { kind: 'enum', options: ['dielectric', 'mirror', 'absorber'] },
				ior: { kind: 'scalar' }, dispersion: { kind: 'scalar' }, reflectivity: { kind: 'scalar' },
				absorptionRed: { kind: 'scalar' }, absorptionGreen: { kind: 'scalar' }, absorptionBlue: { kind: 'scalar' },
			} } },
			ui: { label: 'Objects', control: { element: { fields: {
				sdf: { label: 'SDF', control: { controlType: 'number', step: 0.001 } },
				material: { label: 'Material', control: { labels: { dielectric: 'Dielectric', mirror: 'Mirror', absorber: 'Absorber' } } },
				ior: { label: 'IOR (550 nm)', control: { controlType: 'range', min: 1, max: 3, step: 0.01 } },
				dispersion: { label: 'Dispersion', control: { controlType: 'range', min: 0, max: 0.05, step: 0.0001 } },
				reflectivity: { label: 'Mirror Reflectivity', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
				absorptionRed: { label: 'Red Absorption', control: { controlType: 'range', min: 0, max: 20, step: 0.01 } },
				absorptionGreen: { label: 'Green Absorption', control: { controlType: 'range', min: 0, max: 20, step: 0.01 } },
				absorptionBlue: { label: 'Blue Absorption', control: { controlType: 'range', min: 0, max: 20, step: 0.01 } },
			} } } },
			defaultValue: { inputSource: 'literal', value: [] },
			element: {
				defaultValue: { inputSource: 'literal', value: {
					sdf: { inputSource: 'literal', value: 65504 }, material: { inputSource: 'literal', value: 'dielectric' },
					ior: { inputSource: 'literal', value: 1.5 }, dispersion: { inputSource: 'literal', value: 0 },
					reflectivity: { inputSource: 'literal', value: 1 },
					absorptionRed: { inputSource: 'literal', value: 0 }, absorptionGreen: { inputSource: 'literal', value: 0 }, absorptionBlue: { inputSource: 'literal', value: 0 },
				} },
				fields: {
					sdf: { canNode: true, defaultValue: { inputSource: 'literal', value: 65504 } },
					material: { defaultValue: { inputSource: 'literal', value: 'dielectric' } },
					ior: { defaultValue: { inputSource: 'literal', value: 1.5 } }, dispersion: { defaultValue: { inputSource: 'literal', value: 0 } },
					reflectivity: { defaultValue: { inputSource: 'literal', value: 1 } },
					absorptionRed: { defaultValue: { inputSource: 'literal', value: 0 } }, absorptionGreen: { defaultValue: { inputSource: 'literal', value: 0 } }, absorptionBlue: { defaultValue: { inputSource: 'literal', value: 0 } },
				},
			},
		},
		sources: {
			dataType: { kind: 'array', elementType: { kind: 'struct', fields: {
				type: { kind: 'enum', options: ['singleRay', 'parallelBeam', 'pointSource'] },
				position: { kind: 'vector' }, direction: { kind: 'scalar' }, width: { kind: 'scalar' }, spread: { kind: 'scalar' }, power: { kind: 'scalar' },
				spectrum: { kind: 'enum', options: ['white', 'monochromatic'] }, wavelength: { kind: 'scalar' },
			} } },
			ui: { label: 'Sources', control: { element: { fields: {
				type: { label: 'Type', control: { labels: { singleRay: 'Single Ray', parallelBeam: 'Parallel Beam', pointSource: 'Point Source' } } },
				position: { label: 'Position', control: { controlType: 'xy', min: -0.5, max: 0.5, step: 0.01 } },
				direction: { label: 'Direction', control: { controlType: 'angle' } },
				width: { label: 'Beam Width (Long Side Ratio)', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } },
				spread: { label: 'Point Source Spread (Turns)', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } },
				power: { label: 'Power', control: { controlType: 'range', min: 0, max: 10, step: 0.01 } },
				spectrum: { label: 'Spectrum', control: { labels: { white: 'White', monochromatic: 'Monochromatic' } } },
				wavelength: { label: 'Wavelength (nm)', control: { controlType: 'range', min: 380, max: 780, step: 1 } },
			} } } },
			defaultValue: { inputSource: 'literal', value: [{ id: 'source', binding: { inputSource: 'literal', value: {
				type: { inputSource: 'literal', value: 'parallelBeam' }, position: { inputSource: 'literal', value: [-0.4, 0] },
				direction: { inputSource: 'literal', value: 0 }, width: { inputSource: 'literal', value: 0.2 }, spread: { inputSource: 'literal', value: 1 },
				power: { inputSource: 'literal', value: 1 }, spectrum: { inputSource: 'literal', value: 'white' }, wavelength: { inputSource: 'literal', value: 550 },
			} } }] },
			element: {
				defaultValue: { inputSource: 'literal', value: {
					type: { inputSource: 'literal', value: 'parallelBeam' }, position: { inputSource: 'literal', value: [-0.4, 0] },
					direction: { inputSource: 'literal', value: 0 }, width: { inputSource: 'literal', value: 0.2 }, spread: { inputSource: 'literal', value: 1 },
					power: { inputSource: 'literal', value: 1 }, spectrum: { inputSource: 'literal', value: 'white' }, wavelength: { inputSource: 'literal', value: 550 },
				} },
				fields: {
					type: { defaultValue: { inputSource: 'literal', value: 'parallelBeam' } }, position: { defaultValue: { inputSource: 'literal', value: [-0.4, 0] } },
					direction: { defaultValue: { inputSource: 'literal', value: 0 } }, width: { defaultValue: { inputSource: 'literal', value: 0.2 } }, spread: { defaultValue: { inputSource: 'literal', value: 1 } },
					power: { defaultValue: { inputSource: 'literal', value: 1 } }, spectrum: { defaultValue: { inputSource: 'literal', value: 'white' } }, wavelength: { defaultValue: { inputSource: 'literal', value: 550 } },
				},
			},
		},
		exteriorIor: { dataType: { kind: 'scalar' }, ui: { label: 'Exterior IOR', control: { controlType: 'range', min: 1, max: 3, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1 } },
		raySamples: { dataType: { kind: 'scalar' }, ui: { label: 'Ray Samples', control: { controlType: 'range', min: 1, max: 2048, step: 1 } }, defaultValue: { inputSource: 'literal', value: 128 } },
		wavelengthSamples: { dataType: { kind: 'scalar' }, ui: { label: 'Wavelength Samples', control: { controlType: 'range', min: 1, max: 81, step: 1 } }, defaultValue: { inputSource: 'literal', value: 9 } },
		maxInteractions: { dataType: { kind: 'scalar' }, ui: { label: 'Max Interactions', control: { controlType: 'range', min: 0, max: 32, step: 1 } }, defaultValue: { inputSource: 'literal', value: 12 } },
		minimumRelativePower: { dataType: { kind: 'scalar' }, ui: { label: 'Minimum Relative Power', control: { controlType: 'range', min: 0, max: 0.1, step: 0.0001 } }, defaultValue: { inputSource: 'literal', value: 0.001 } },
		pathBudget: { dataType: { kind: 'scalar' }, ui: { label: 'Path Budget', control: { controlType: 'range', min: 1024, max: 262144, step: 1024 } }, defaultValue: { inputSource: 'literal', value: 65536 } },
		maximumStep: { dataType: { kind: 'scalar' }, ui: { label: 'Maximum Trace Step (Long Side Ratio)', control: { controlType: 'range', min: 0.0001, max: 0.05, step: 0.0001 } }, defaultValue: { inputSource: 'literal', value: 0.005 } },
		maximumSteps: { dataType: { kind: 'scalar' }, ui: { label: 'Maximum Trace Steps', control: { controlType: 'range', min: 64, max: 8192, step: 64 } }, defaultValue: { inputSource: 'literal', value: 2048 } },
		lineWidth: { dataType: { kind: 'scalar' }, ui: { label: 'Line Width (Long Side Ratio)', control: { controlType: 'range', min: 0, max: 0.02, step: 0.0001 } }, defaultValue: { inputSource: 'literal', value: 0.003 } },
		exposure: { dataType: { kind: 'scalar' }, ui: { label: 'Exposure (EV)', control: { controlType: 'range', min: -10, max: 10, step: 0.1 } }, defaultValue: { inputSource: 'literal', value: -2 } },
	},
	primaryInputParameter: null,
	resolutionInputParameters: ['objects'],
	outputDefs: { output: { dataType: { kind: 'color' }, label: 'Light Paths' } },
	primaryOutput: 'output',
});
