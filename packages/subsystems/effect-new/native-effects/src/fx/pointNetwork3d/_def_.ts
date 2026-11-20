import { srgbToLinearSrgb } from '@gs/shared/color-space.ts';
import { defineNativeEffect } from '@gs/subsystems_effect-new_shared/effect-definition.ts';
import { MAX_POINT_COUNT, MAX_NEIGHBOR_COUNT } from './constants.ts';

export default defineNativeEffect({
	displayName: 'Point Network 3D',
	summary: {
		'ja-JP': '3D空間を漂う点を近接距離で結び、点・線・三角形のネットワークを描画します。',
		'en-US': 'Draws drifting 3D points connected by proximity with lines and triangular faces.',
	},
	kind: 'generate',
	dependsOnRenderHistory: false,
	canHaveLongRunningRenderPass: true,
	tags: ['3d', 'pattern'],
	paramDefs: {
		time: { dataType: { kind: 'scalar' }, ui: { label: 'Time', control: { controlType: 'number', step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0 } },
		pointCount: { dataType: { kind: 'scalar' }, ui: { label: 'Point Count', control: { controlType: 'range', min: 0, max: MAX_POINT_COUNT, step: 1 } }, defaultValue: { inputSource: 'literal', value: 256 } },
		distribution: {
			dataType: { kind: 'enum', options: ['box', 'ball', 'sphere', 'plane', 'grid'] },
			ui: { label: 'Distribution', control: { labels: { box: 'Box', ball: 'Sphere Volume', sphere: 'Sphere Surface', plane: 'Plane', grid: 'Grid' } } },
			defaultValue: { inputSource: 'literal', value: 'box' },
		},
		extent: { dataType: { kind: 'vector' }, ui: { label: 'Extent XY', control: { controlType: 'vector', min: 0, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: [0.8, 0.6] } },
		extentZ: { dataType: { kind: 'scalar' }, ui: { label: 'Extent Z', control: { controlType: 'range', min: 0, max: 2, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.6 } },
		seed: { dataType: { kind: 'scalar' }, ui: { label: 'Seed', control: { controlType: 'seed' } }, defaultValue: { inputSource: 'literal', value: 0 } },
		motionAmount: { dataType: { kind: 'scalar' }, ui: { label: 'Motion Amount', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.1 } },
		motionFrequency: { dataType: { kind: 'scalar' }, ui: { label: 'Motion Frequency', control: { controlType: 'range', min: 0, max: 20, step: 0.1 } }, defaultValue: { inputSource: 'literal', value: 4 } },
		motionSpeed: { dataType: { kind: 'scalar' }, ui: { label: 'Motion Speed', control: { controlType: 'range', min: -2, max: 2, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.2 } },
		connectionMode: {
			dataType: { kind: 'enum', options: ['dynamic', 'fixed'] },
			ui: { label: 'Connections', control: { labels: { dynamic: 'Dynamic', fixed: 'Fixed' } } },
			defaultValue: { inputSource: 'literal', value: 'dynamic' },
		},
		connectionDistance: { dataType: { kind: 'scalar' }, ui: { label: 'Connection Distance', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.2 } },
		maximumConnections: { dataType: { kind: 'scalar' }, ui: { label: 'Maximum Connections per Point', control: { controlType: 'range', min: 0, max: MAX_NEIGHBOR_COUNT, step: 1 } }, defaultValue: { inputSource: 'literal', value: 6 } },
		connectionFade: { dataType: { kind: 'scalar' }, ui: { label: 'Connection Fade', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.35 } },
		showPoints: { dataType: { kind: 'bool' }, ui: { label: 'Show Points', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
		pointSize: { dataType: { kind: 'scalar' }, ui: { label: 'Point Diameter', control: { controlType: 'range', min: 0, max: 0.05, step: 0.0005 } }, defaultValue: { inputSource: 'literal', value: 0.006 } },
		pointColor: { dataType: { kind: 'color' }, ui: { label: 'Point Color', control: {} }, defaultValue: { inputSource: 'literal', value: srgbToLinearSrgb([0.65, 0.9, 1, 1]) } },
		showLines: { dataType: { kind: 'bool' }, ui: { label: 'Show Lines', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
		lineWidth: { dataType: { kind: 'scalar' }, ui: { label: 'Line Width', control: { controlType: 'range', min: 0, max: 0.03, step: 0.0005 } }, defaultValue: { inputSource: 'literal', value: 0.0015 } },
		lineColor: { dataType: { kind: 'color' }, ui: { label: 'Line Color', control: {} }, defaultValue: { inputSource: 'literal', value: srgbToLinearSrgb([0.35, 0.7, 1, 0.55]) } },
		showFaces: { dataType: { kind: 'bool' }, ui: { label: 'Show Faces', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
		faceProbability: { dataType: { kind: 'scalar' }, ui: { label: 'Face Probability', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.5 } },
		faceColor: { dataType: { kind: 'color' }, ui: { label: 'Face Color', control: {} }, defaultValue: { inputSource: 'literal', value: srgbToLinearSrgb([0.3, 0.6, 1, 0.12]) } },
		shading: { dataType: { kind: 'scalar' }, ui: { label: 'Face Shading', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.3 } },
		sizeSpace: {
			dataType: { kind: 'enum', options: ['screen', 'world'] },
			ui: { label: 'Point / Line Size Space', control: { labels: { screen: 'Screen', world: '3D Space' } } },
			defaultValue: { inputSource: 'literal', value: 'screen' },
		},
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Screen Size Reference', isAdvanced: true, control: {} }, defaultValue: { inputSource: 'literal', value: 'longSide' } },
		renderMode: {
			dataType: { kind: 'enum', options: ['additive', 'depth'] },
			ui: { label: 'Rendering', control: { labels: { additive: 'Additive', depth: 'Depth (Nearest Surface)' } } },
			defaultValue: { inputSource: 'literal', value: 'additive' },
		},
		position: { dataType: { kind: 'vector' }, ui: { label: 'Position XY', control: { controlType: 'vector', step: 0.01 } }, defaultValue: { inputSource: 'literal', value: [0, 0] } },
		positionZ: { dataType: { kind: 'scalar' }, ui: { label: 'Position Z', control: { controlType: 'number', step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0 } },
		rotationX: { dataType: { kind: 'scalar' }, ui: { label: 'Rotation X', control: { controlType: 'angle' } }, defaultValue: { inputSource: 'literal', value: 0 } },
		rotationY: { dataType: { kind: 'scalar' }, ui: { label: 'Rotation Y', control: { controlType: 'angle' } }, defaultValue: { inputSource: 'literal', value: 0 } },
		rotationZ: { dataType: { kind: 'scalar' }, ui: { label: 'Rotation Z', control: { controlType: 'angle' } }, defaultValue: { inputSource: 'literal', value: 0 } },
		scale: { dataType: { kind: 'vector' }, ui: { label: 'Scale XY', control: { controlType: 'vector', step: 0.01 } }, defaultValue: { inputSource: 'literal', value: [1, 1] } },
		scaleZ: { dataType: { kind: 'scalar' }, ui: { label: 'Scale Z', control: { controlType: 'number', step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1 } },
		projection: {
			dataType: { kind: 'enum', options: ['perspective', 'orthographic'] },
			ui: { label: 'Projection', control: { labels: { perspective: 'Perspective', orthographic: 'Orthographic' } } },
			defaultValue: { inputSource: 'literal', value: 'perspective' },
		},
		cameraPosition: { dataType: { kind: 'vector' }, ui: { label: 'Camera XY', control: { controlType: 'vector', step: 0.01 } }, defaultValue: { inputSource: 'literal', value: [0, 0] } },
		cameraZ: { dataType: { kind: 'scalar' }, ui: { label: 'Camera Z', control: { controlType: 'number', step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.5 / Math.tan(Math.PI / 8) } },
		cameraTarget: { dataType: { kind: 'vector' }, ui: { label: 'Camera Target XY', control: { controlType: 'vector', step: 0.01 } }, defaultValue: { inputSource: 'literal', value: [0, 0] } },
		cameraTargetZ: { dataType: { kind: 'scalar' }, ui: { label: 'Camera Target Z', control: { controlType: 'number', step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0 } },
		fieldOfView: { dataType: { kind: 'scalar' }, ui: { label: 'Field of View (Long Side)', control: { controlType: 'angle' } }, defaultValue: { inputSource: 'literal', value: 0.125 } },
		orthographicSize: { dataType: { kind: 'scalar' }, ui: { label: 'Orthographic Size (Long Side)', control: { controlType: 'number', min: 0.001, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1 } },
		nearClip: { dataType: { kind: 'scalar' }, ui: { label: 'Near Clip', control: { controlType: 'number', min: 0.001, step: 0.001 } }, defaultValue: { inputSource: 'literal', value: 0.01 } },
		nearFade: { dataType: { kind: 'scalar' }, ui: { label: 'Near Fade Distance', control: { controlType: 'number', min: 0, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.1 } },
	},
	ui: {
		parameterLayout: [
			{
				type: 'section', id: 'distribution', label: 'Point Distribution',
				children: ['pointCount', 'distribution', 'extent', 'extentZ', 'seed'],
			},
			{
				type: 'section', id: 'motion', label: 'Motion',
				children: ['time', 'motionAmount', 'motionFrequency', 'motionSpeed'],
			},
			{
				type: 'section', id: 'pointCloudTransform', label: 'Point Cloud Transform',
				children: ['position', 'positionZ', 'rotationX', 'rotationY', 'rotationZ', 'scale', 'scaleZ'],
			},
			{
				type: 'section', id: 'connections', label: 'Connections',
				children: ['connectionMode', 'connectionDistance', 'maximumConnections', 'connectionFade'],
			},
			{
				type: 'section', id: 'points', label: 'Points',
				children: ['showPoints', 'pointSize', 'pointColor'],
			},
			{
				type: 'section', id: 'lines', label: 'Lines',
				children: ['showLines', 'lineWidth', 'lineColor'],
			},
			{
				type: 'section', id: 'faces', label: 'Faces',
				children: ['showFaces', 'faceProbability', 'faceColor', 'shading'],
			},
			{
				type: 'section', id: 'rendering', label: 'Rendering',
				children: ['renderMode', 'sizeSpace', 'sizeReference'],
			},
			{
				type: 'section', id: 'camera', label: 'Camera',
				children: ['projection', 'cameraPosition', 'cameraZ', 'cameraTarget', 'cameraTargetZ', 'fieldOfView', 'orthographicSize', 'nearClip', 'nearFade'],
			},
		],
	},
	primaryInputParameter: null,
	resolutionInputParameters: [],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
