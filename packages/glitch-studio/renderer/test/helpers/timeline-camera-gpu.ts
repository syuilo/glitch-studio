import { createTransformTimelineLayer } from '@gs/subsystems_timeline_renderer/layers/transform/transform-timeline-layer.ts';
import { createTimelineTransformParameterValues } from '@gs/subsystems_timeline_shared/layers/transform/transform.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { TimelineRenderer } from '@gs/subsystems_timeline_renderer/timeline-renderer.ts';
import { createGroupTimelineLayer } from '@gs/subsystems_timeline_renderer/layers/group/group-timeline-layer.ts';
import { createShapeTimelineLayer } from '@gs/subsystems_timeline_renderer/layers/shape/shape-timeline-layer.ts';
import { createTextTimelineLayer } from '@gs/subsystems_timeline_renderer/layers/text/text-timeline-layer.ts';
import { createSceneTimelineLayer } from '@gs/subsystems_timeline_renderer/layers/scene/scene-timeline-layer.ts';
import { createTimelineCompositor } from '@gs/subsystems_timeline_renderer/timeline-compositor.ts';
import { TimelineCompositingParameters } from '@gs/subsystems_timeline_renderer/timeline-compositing-parameters.ts';
import { createSceneOutput } from '@gs/subsystems_timeline_renderer/scene-output.ts';
import { createShape } from '@gs/subsystems_timeline_shared/layers/shape/shape.ts';
import { createTextParameterValues } from '@gs/subsystems_timeline_shared/layers/text/text.ts';
import { timelineCompositingParamDefs, type TimelineLayerCoordinateSpace } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import { createTimelineCameraParameterValues, DEFAULT_CAMERA_DISTANCE } from '@gs/subsystems_timeline_shared/layers/camera/camera.ts';
import { TimelineSceneCamera } from '@gs/subsystems_timeline_shared/scene-camera.ts';
import { isTimelineRenderLayer } from '@gs/subsystems_timeline_shared/types.ts';
import { TIMELINE_IDENTITY, TIMELINE_FRAME } from '@gs/subsystems_timeline_shared/spatial.ts';
import type { TimelineLayer, TimelineScene, TimelineGroupLayer, TimelineTransformLayer, TimelineCameraLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineLayerRenderer } from '@gs/subsystems_timeline_renderer/timeline-renderer.ts';
import type { TimelineImage } from '@gs/subsystems_timeline_renderer/timeline-image.ts';

// 【実GPUでカメラ・平面化・画面外コンテンツの回復を検証する】
// 行列だけのテストでは、描画前の切り取りやGPUサンプリング、二重投影を検出できない。
export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (!adapter) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	device.pushErrorScope('validation');
	const frame = { width: 128, height: 64 };
	const vertex = device.createShaderModule({ code: vertexCode });
	const options = {
		device,
		vertex,
		resolution: frame,
		format: 'rgba16float' as const,
	};
	const output = createSceneOutput(options);
	const cameraParameters = new TimelineSceneCamera();
	const literal = (value: any) => ({ inputSource: 'literal' as const, value });
	const composite = (values = {}) => ({ ...Object.fromEntries(Object.entries(timelineCompositingParamDefs).map(([key, def]) => [key, structuredClone(def.defaultValue)])), ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, literal(value)])) } as TimelineGroupLayer['compositingParamValues']);
	const base = {
		isDisabled: false,
		forceDisableMotionBlur: false,
		automationGraphs: [],
		clips: [{
			id: 'clip',
			startMs: 0,
			durationMs: 1000,
			contentOffsetMs: 0,
		}],
	};
	let nextId = 0;
	// colorをundefinedで省略する呼び出しは既定の赤を適用し、後続の変形・合成引数だけを指定する。
	const shape = (color = [1, 0, 0, 1], values = {}, compositing = {}, coordinateSpace: TimelineLayerCoordinateSpace = 'world'): TimelineLayer => {
		const shape = createShape('rectangle');
		Object.assign(shape.paramValues, { size: literal([0.5, 0.5]), fillColor: literal(color), strokeWidth: literal(0) }, Object.fromEntries(Object.entries(values).map(([key, value]) => [key, literal(value)])));
		return {
			...base,
			id: 'shape' + nextId++,
			name: 'shape',
			layerType: 'shape',
			shape,
			mask: null,
			coordinateSpace,
			compositingParamValues: composite(compositing),
		};
	};
	const group = (layers: TimelineLayer[], mode: 'flat' | 'preserveDepth' = 'flat', values = {}): TimelineGroupLayer => ({
		isDisabled: false,
		forceDisableMotionBlur: false,
		automationGraphs: [],
		id: `group${nextId++}`,
		name: 'group',
		layerType: 'group',
		layers,
		mask: null,
		coordinateSpace: 'world',
		compositingMode: mode,
		compositingParamValues: composite(values),
		audioParamValues: { volume: literal(1) },
	});
	const transform = (layers: TimelineLayer[], values = {}): TimelineTransformLayer => ({
		isDisabled: false,
		forceDisableMotionBlur: false,
		automationGraphs: [],
		id: `transform${nextId++}`,
		name: 'Transform',
		layerType: 'transform',
		layers,
		transformParamValues: { ...createTimelineTransformParameterValues(), ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, literal(value)])) },
	});
	const text = (position: number): TimelineLayer => ({
		...base,
		id: `text${nextId++}`,
		name: 'text',
		layerType: 'text',
		mask: null,
		coordinateSpace: 'world',
		textParamValues: {
			...createTextParameterValues(),
			text: literal('OFFSCREEN'),
			size: literal(0.3),
			position: literal([position, 0]),
		},
		compositingParamValues: composite(),
	});
	let sceneLayers: TimelineLayer[] = [];
	let childScene: TimelineScene;
	const imageSources = new Map<string, GPUTexture>();
	const image = (width: number, height: number, pixel: (x: number, y: number) => number[]): TimelineLayer => {
		const id = `image${nextId++}`;
		const texture = device.createTexture({ size: { width, height }, format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		const pixels = new Uint8Array(Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => pixel(x, y))).flat(2));
		device.queue.writeTexture({ texture }, pixels, { bytesPerRow: width * 4 }, { width, height });
		imageSources.set(id, texture);
		return {
			...base,
			id,
			name: id,
			layerType: 'image',
			mask: null,
			coordinateSpace: 'world',
			clips: [{ ...base.clips[0], assetId: id }],
			compositingParamValues: composite({ fitMode: 'stretch', blendMode: 'replace' }),
		};
	};
	const createLayer = (layer: TimelineLayer, clipId: string | null): TimelineLayerRenderer<TimelineImage> => {
		switch (layer.layerType) {
			case 'transform': return createTransformTimelineLayer(() => layer, { resolution: frame, fallbackOutput: { kind: 'uniform', value: [0, 0, 0, 0] } as TimelineImage, createLayer });
			case 'group': return createGroupTimelineLayer(() => layer, { ...options, createLayer, getLayerVersion: () => 0 });
			case 'shape': return createShapeTimelineLayer(layer, options);
			case 'image': {
				// 定数を返すEffectと同じ合成経路。無限の一様色として扱わないことを検証する。
				const compositor = createTimelineCompositor(options);
				const parameters = new TimelineCompositingParameters();
				return {
					async evaluate(context) {
						const settings = parameters.evaluate({
							time: context.sceneTimeMs,
							isExport: context.isExport,
							coordinateSpace: layer.coordinateSpace,
							mask: layer.mask,
							paramValues: layer.compositingParamValues,
							automationGraphs: [],
						});
						const texture = imageSources.get(layer.clips[0].assetId);
						const source: TimelineImage = texture ? { kind: 'texture', texture } : { kind: 'uniform', value: layer.name === 'red' ? [1, 0, 0, 1] : [0, 0, 0, 0] };
						return compositor.evaluate(context, source, settings);
					},
					destroy() { compositor.dispose(); },
				};
			}
			case 'text': return createTextTimelineLayer(layer, { ...options, getFont: () => null });
			case 'scene': return createSceneTimelineLayer(() => childScene, layer, {
				...options,
				sceneResolution: frame,
				createLayer,
				getLayerVersion: () => 0,
			});
			default: throw new Error(`Unsupported fixture layer ${layer.layerType} ${clipId}`);
		}
	};
	const renderer = new TimelineRenderer<TimelineImage, TimelineLayer>({
		fallbackOutput: { kind: 'uniform', value: [0, 0, 0, 0] },
		createLayer,
		getRenderSpace: (time, isExport) => ({
			parent: TIMELINE_IDENTITY,
			depth: 0,
			viewport: TIMELINE_FRAME,
			camera: cameraParameters.evaluate(sceneLayers, time, isExport, frame),
		}),
	});
	const readback = device.createBuffer({ size: 128 * 8 * 64, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
	// 出力はCOPY_SRCを持たないため、Scene出力から読み出し用の描画先へ転写する。
	const copy = device.createRenderPipeline({
		layout: 'auto',
		vertex: { module: vertex, entryPoint: 'vs' },
		fragment: {
			module: device.createShaderModule({ code: '@group(0) @binding(0) var tex: texture_2d<f32>; @fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f { return textureLoad(tex, vec2i(p.xy), 0); }' }),
			entryPoint: 'fs',
			targets: [{ format: 'rgba16float' }],
		},
	});
	const target = device.createTexture({ size: frame, format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
	const completed: string[] = [];

	async function render(layers: TimelineLayer[], settings?: TimelineCameraLayer, time = 100) {
		renderer.clear();
		sceneLayers = settings ? [settings, ...layers] : layers;
		const result = await renderer.evaluateAt(time, sceneLayers.filter(isTimelineRenderLayer), 0, true);
		if (!result) throw new Error('Cancelled frame');
		const encoder = device.createCommandEncoder();
		const texture = output.render(encoder, result.output);
		const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
		pass.setPipeline(copy);
		pass.setBindGroup(0, device.createBindGroup({ layout: copy.getBindGroupLayout(0), entries: [{ binding: 0, resource: texture.createView() }] }));
		pass.draw(6); pass.end();
		encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: 1024 }, [128, 64]);
		device.queue.submit([encoder.finish()]);
		await readback.mapAsync(GPUMapMode.READ);
		const bits = new Uint16Array(readback.getMappedRange());
		const values = Array.from(bits, value => { const sign = value & 0x8000 ? -1 : 1; const exponent = (value >> 10) & 31; const mantissa = value & 1023; return sign * (exponent === 0 ? mantissa * 2 ** -24 : (1 + mantissa / 1024) * 2 ** (exponent - 15)); });
		readback.unmap();
		return values;
	}

	function same(name: string, actual: number[], expected: number[], tolerance = 0.03) {
		const difference = Math.max(...actual.map((value, index) => Math.abs(value - expected[index])));
		if (difference > tolerance) throw new Error(`${name}: maximum pixel error ${difference}`);
		completed.push(name);
	}

	const view = (values: Record<string, any>): TimelineCameraLayer => ({
		...base,
		id: 'camera' + nextId++,
		name: 'Camera',
		layerType: 'camera',
		cameraParamValues: { ...createTimelineCameraParameterValues(), ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, literal(value)])) },
	});
	try {
		const baseline = await render([shape()]);
		if (baseline[(32 * 128 + 64) * 4] < 0.99) throw new Error('Baseline shape was not drawn');
		same('flat group recovers shape pixels translated beyond the frame', await render([group([shape(undefined, { position: [2, 0] })], 'flat', { position: [-2, 0] })]), baseline);
		same('preserved group recovers shape pixels before projection', await render([group([shape(undefined, { position: [2, 0] })], 'preserveDepth', { position: [-2, 0] })]), baseline);
		const textBaseline = await render([text(0)]);
		if (!textBaseline.some((value, i) => i % 4 === 3 && value > 0.5)) throw new Error('Baseline text was not drawn');
		same('text ink outside the frame survives parent translation', await render([group([text(2)], 'flat', { position: [-2, 0] })]), textBaseline, 0.06);
		const twice = await render([shape(undefined, {}, { scale: [2, 2] })]);
		same('positive Z magnifies a plane', await render([shape(undefined, {}, { depth: DEFAULT_CAMERA_DISTANCE / 2 })], view({})), twice);
		same('camera Z magnifies every world plane', await render([shape()], view({ z: DEFAULT_CAMERA_DISTANCE / 2 })), twice);
		// カメラなしではZに関係なく2D合成となるため、投影を検証するケースには明示的にカメラを置く。
		same('flat group ignores child depth', await render([group([shape(undefined, {}, { depth: 100 })])], view({})), baseline);
		same('nested flat groups ignore all inner depth', await render([group([group([shape(undefined, {}, { depth: 100 })], 'preserveDepth', { depth: 200 })])], view({})), baseline);
		same('preserved group carries child depth', await render([group([shape(undefined, {}, { depth: DEFAULT_CAMERA_DISTANCE / 2 })], 'preserveDepth')], view({})), twice);
		same('group and child depth add before projection', await render([group([shape(undefined, {}, { depth: DEFAULT_CAMERA_DISTANCE / 4 })], 'preserveDepth', { depth: DEFAULT_CAMERA_DISTANCE / 4 })], view({})), twice);
		// 【有効な最上段カメラをクリップで切り替え、映像の上下関係には依存させない】
		// Scene設定のまま評価していたり、カメラを描画順に適用すると、この比較が一致しない。
		const upperCamera = view({ z: DEFAULT_CAMERA_DISTANCE / 2 });
		upperCamera.clips = [{ ...base.clips[0], durationMs: 100 }];
		const lowerCamera = view({});
		same('topmost active camera controls layers on either side', await render([shape(), upperCamera, lowerCamera], undefined, 50), twice);
		same('camera cuts use half-open clip intervals', await render([shape(), upperCamera, lowerCamera], undefined, 100), baseline);
		same('disabled cameras fall back to the next camera', await render([shape(), { ...upperCamera, isDisabled: true }, lowerCamera], undefined, 50), baseline);
		same('gaps use the default camera', await render([upperCamera, shape()], undefined, 150), baseline);
		same('camera XY moves the world in the opposite direction', await render([shape()], view({ position: [0.4, -0.2] })), await render([shape(undefined, {}, { position: [-0.4, 0.2] })]));
		same('screen layer ignores camera and depth', await render([shape(undefined, {}, { depth: 100 }, 'screen')], view({ position: [5, 4], z: 0 })), baseline);
		same('screen child avoids inherited projection', await render([group([shape(undefined, {}, {}, 'screen')], 'preserveDepth', { position: [1, 1], depth: 1 })], view({ position: [5, 4], z: 0 })), baseline);
		const constant = (name: string, compositing = {}): TimelineLayer => ({
			...base,
			id: 'constant' + nextId++,
			name,
			layerType: 'image',
			mask: null,
			coordinateSpace: 'world',
			clips: [{ ...base.clips[0], assetId: 'unused' }],
			compositingParamValues: composite(compositing),
		});
		// 【正方形素材のStretchを、親グループのContainで取り消さない】
		// Replaceが元テクスチャを借用する場合も、親は子のScene基準の配置を維持する。
		same('flat groups preserve stretched replace images', await render([group([image(128, 128, () => [255, 0, 0, 255])])]), await render([constant('red')]));
		// 【画面外へ透明レイヤーを動かしても、静止した背景画像を再クロップしない】
		// 上下の色を変え、拡張後の横長テクスチャに対するCoverが入り込むと画素比較が失敗する。
		const stripedBackground = image(128, 64, (_x, y) => y < 16 ? [255, 0, 0, 255] : [0, 0, 255, 255]);
		same('expanded flat groups preserve background texture sampling', await render([group([constant('transparent', { position: [2, 0] }), stripedBackground])]), await render([stripedBackground]));
		same('uniform backgrounds stay bounded when flat group bounds expand', await render([group([constant('transparent', { position: [2, 0] }), constant('red', { blendMode: 'replace' })], 'flat', { position: [-2, 0] })]), new Array(baseline.length).fill(0));
		const blue = shape([0, 0, 1, 1]);
		same('timeline order wins over Z', await render([shape(undefined, {}, { depth: -1 }), blue], view({})), await render([shape(undefined, {}, { scale: [DEFAULT_CAMERA_DISTANCE / (DEFAULT_CAMERA_DISTANCE + 1), DEFAULT_CAMERA_DISTANCE / (DEFAULT_CAMERA_DISTANCE + 1)] }), shape([0, 0, 1, 1])]));
		same('group opacity is applied once after overlapping projected children', await render([group([shape(), shape()], 'preserveDepth', { opacity: 0.5 })]), await render([shape(undefined, {}, { opacity: 0.5 })]));
		same('a plane behind the camera does not erase the background with replace', await render([shape(undefined, {}, { depth: 10, blendMode: 'replace' }), blue], view({})), await render([blue]));
		same('explicit clipping restores the old frame crop', await render([group([shape(undefined, { position: [2, 0] })], 'flat', { position: [-2, 0], clipToFrame: true })]), new Array(baseline.length).fill(0));
		childScene = {
			id: 'child',
			name: 'child',
			resolution: { mode: 'project' },
			layers: [view({ z: DEFAULT_CAMERA_DISTANCE / 2 }), shape()],
		};
		const nested: TimelineLayer = {
			...base,
			id: 'scene',
			name: 'scene',
			layerType: 'scene',
			mask: null,
			coordinateSpace: 'world',
			clips: [{ ...base.clips[0], sceneId: 'child' }],
			compositingParamValues: composite(),
			audioParamValues: { volume: literal(1) },
		};
		same('child scene uses its own camera and is a plane in its parent', await render([nested]), twice);
		// 【Transformは子の深度と合成を保ち、カメラにも同じ親移動を与える】
		// ピクセル比較により、早すぎる切り取り、二重投影、Group化による背景分離を検出する。
		same('transform recovers offscreen text', await render([transform([text(2)], { position: [-2, 0] })]), textBaseline, 0.06);
		same('nested transforms add depth before projection', await render([transform([transform([shape()], { z: DEFAULT_CAMERA_DISTANCE / 4 })], { z: DEFAULT_CAMERA_DISTANCE / 4 })], view({})), twice);
		same('transform shares translation with its camera', await render([transform([view({}), shape()], { position: [0.75, -0.25], z: 0.5 })]), baseline);
		same('parented camera moves world in the opposite direction', await render([transform([view({})], { position: [0.4, -0.2] }), shape()]), await render([shape(undefined, {}, { position: [-0.4, 0.2] })]));
		same('disabled transform does not supply a camera', await render([{ ...transform([view({ z: DEFAULT_CAMERA_DISTANCE / 2 })]), isDisabled: true }, shape()]), baseline);
		same('screen children inherit transform XY without camera or depth', await render([transform([shape(undefined, {}, {}, 'screen')], { position: [0.25, 0], z: 100 })], view({ position: [5, 5], z: 0 })), await render([shape(undefined, {}, { position: [0.25, 0] })]));
		same('flat group ignores transform depth inside it', await render([group([transform([shape()], { z: 100 })])], view({})), baseline);
		same('transform outside flat group sets plane depth once', await render([transform([group([transform([shape()], { z: 100 })])], { z: DEFAULT_CAMERA_DISTANCE / 2 })], view({})), twice);
		same('transform and preserved group share depth', await render([transform([group([shape()], 'preserveDepth', { depth: DEFAULT_CAMERA_DISTANCE / 4 })], { z: DEFAULT_CAMERA_DISTANCE / 4 })], view({})), twice);
		// 【親子の拡縮・回転とカメラのロールを、行列だけでなく実画素で検証する】
		// 非等方scaleを含む入れ子は既存の奥行き維持Groupと比較し、せん断とサンプリングを確認する。
		// カメラへscaleまで逆適用したり、On screenへロールが漏れる退行も検出する。
		const transformed = { position: [0.1, -0.1], scale: [1.5, 0.75], rotation: 0.2 };
		same('transform preserves shear from a rotated child',
			await render([transform([transform([shape()], { rotation: 0.25 })], transformed)]),
			await render([group([group([shape()], 'preserveDepth', { rotation: 0.25 })], 'preserveDepth', transformed)]));
		same('camera roll applies inverse rotation', await render([shape()], view({ roll: 0.25 })), await render([shape(undefined, {}, { rotation: -0.25 })]));
		same('camera and world share parent rotation', await render([transform([view({}), shape()], { position: [0.3, -0.2], rotation: 0.25 })]), baseline);
		same('camera inherits parent scale only for position',
			await render([transform([view({ position: [0.1, 0.2] })], { scale: [2, 0.5] }), shape()]),
			await render([shape()], view({ position: [0.2, 0.1] })));
		same('parent scale does not cancel world magnification through its camera', await render([transform([view({}), shape()], { scale: [2, 2] })]), twice);
		same('screen children inherit scale and rotation without camera roll',
			await render([transform([shape(undefined, {}, {}, 'screen')], transformed)], view({ position: [5, 5], z: 0, roll: 0.3 })),
			await render([shape(undefined, {}, transformed)]));
		same('zero transform scale removes the foreground', await render([transform([shape()], { scale: [0, 1] }), blue]), await render([blue]));
		same('negative transform scale mirrors children', await render([transform([shape(undefined, {}, { position: [0.2, 0.1] })], { scale: [-1, 1] })]),
			await render([shape(undefined, {}, { position: [-0.2, 0.1], scale: [-1, 1] })]));
		const translucent = shape([1, 0, 0, 1], {}, { opacity: 0.5, blendMode: 'multiply' });
		same('transform preserves blending against the outside background', await render([transform([translucent]), blue]), await render([translucent, blue]));
		const partial = shape(undefined, {}, { opacity: 0.5 });
		const otherPartial = shape(undefined, {}, { opacity: 0.5 });
		same('transform does not merge overlapping child opacity', await render([transform([partial, otherPartial]), blue]), await render([partial, otherPartial, blue]));
		childScene.layers = [transform([view({ z: DEFAULT_CAMERA_DISTANCE / 2 })]), shape()];
		same('child scene resolves its own transform-parented camera', await render([nested]), twice);
		childScene.layers = [transform([view({ roll: 0.1 }), shape(undefined, {}, { rotation: 0.1 })], { rotation: 0.2 })];
		same('child scene applies its own camera roll and parent rotation', await render([nested]), baseline);
		const error = await device.popErrorScope();
		if (error) throw new Error(error.message);
		return completed;
	} finally { renderer.clear(); output.dispose(); readback.destroy(); target.destroy(); for (const texture of imageSources.values()) texture.destroy(); device.destroy(); }
}
