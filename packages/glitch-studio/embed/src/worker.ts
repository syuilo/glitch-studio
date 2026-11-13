import { AssetTextures } from '@gs/glitch-studio_renderer/asset-textures.ts';
import { PortableCanvasRenderer } from '@gs/glitch-studio_renderer/portable-canvas-renderer.ts';
import { createProjectEffects } from '@gs/glitch-studio_renderer/custom-shader-effects.ts';
import { VisualModuleRenderer } from '@gs/subsystems_visual-module_renderer/visual-module-renderer.ts';
import { effectDefinitions } from '@gs/subsystems_effect_shared/effect-definitions.ts';
import { effectImplementations } from '@gs/subsystems_effect_shared/effect-implementations.ts';
import { UniformOrTextureToTextureResolver } from '@gs/shared/gpu/uniform-or-texture-to-texture-resolver.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { getPortableRenderResolution, getPortablePointerPosition } from './protocol.ts';
import type { PortableVisualModuleRequest, PortableVisualModuleResponse, PortableVisualModuleFrame } from './protocol.ts';
import type { PortableVisualModule } from '@gs/glitch-studio_shared/portable-visual-module.ts';
import type { VisualModuleRenderContext } from '@gs/subsystems_visual-module_renderer/visual-module-renderer.ts';

const worker = globalThis as unknown as {
	onmessage: (event: MessageEvent<PortableVisualModuleRequest>) => void;
	postMessage: (message: PortableVisualModuleResponse) => void;
};
const controller = new AbortController();
let device: GPUDevice | null = null;
let assetTextures: AssetTextures | null = null;
let renderer: VisualModuleRenderer | null = null;
let presenter: PortableCanvasRenderer | null = null;
let outputTextures: UniformOrTextureToTextureResolver | null = null;
let fallbackTexture: GPUTexture | null = null;
let canvas: OffscreenCanvas | null = null;
let artwork: PortableVisualModule | null = null;
let previousTime = 0;
let previousPointer = { x: -99999, y: -99999 };
let processingFrame = false;

function dispose() {
	controller.abort();
	renderer?.destroy();
	assetTextures?.dispose();
	outputTextures?.dispose();
	presenter?.destroy();
	fallbackTexture?.destroy();
	device?.destroy();
	renderer = null;
	device = null;
}

function fail(error: unknown) {
	if (controller.signal.aborted) return;
	worker.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
	dispose();
}

async function initialize(offscreenCanvas: OffscreenCanvas, data: PortableVisualModule) {
	artwork = data;
	canvas = offscreenCanvas;
	if (navigator.gpu == null) throw new Error('WebGPU requires a supported browser and a secure context (HTTPS or localhost)');
	const adapter = await navigator.gpu.requestAdapter();
	controller.signal.throwIfAborted();
	if (adapter == null) throw new Error('A WebGPU adapter is unavailable');
	const createdDevice = await adapter.requestDevice();
	if (controller.signal.aborted) { createdDevice.destroy(); return; }
	device = createdDevice;
	void device.lost.then(info => { if (!controller.signal.aborted) fail(new Error(`WebGPU device lost: ${info.message}`)); });
	device.addEventListener('uncapturederror', event => fail(event.error));
	const assets = data.assets.map(({ fileDataBase64, ...asset }) => ({
		...asset, fileData: new Blob([Uint8Array.fromBase64(fileDataBase64)], { type: asset.fileDataType }),
	}));
	assetTextures = new AssetTextures(device, assets);
	await assetTextures.waitUntilReady(controller.signal);
	controller.signal.throwIfAborted();
	fallbackTexture = device.createTexture({ size: [1, 1], format: INTERMEDIATE_TEXTURE_FORMAT, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
	const effects = createProjectEffects(data.customShaderEffects, effectDefinitions, effectImplementations);
	// 実寸の初回通知で生成する。1pxの仮寸法で履歴や重いエフェクトを準備しない。
	const createRenderer = (resolution: { width: number; height: number }) => new VisualModuleRenderer({
		gpuDevice: device!, fallbackTexture: fallbackTexture!, resolution, resolutionScale: 1,
		assets, assetTextures: assetTextures!.textures, visualModule: data.visualModule,
		effectDefinitions: effects.definitions, effectImplementations: effects.implementations,
		enableStats: false, timingHelper: null, enable32bitDataTextures: false,
		effectRenderTiling: { mode: 'disabled' }, videoFrameVersions: new Map(),
		// Playerの権限取得・再生・音声履歴を持たない。未入力の既存動作を使う。
		getPlayerVideoTexture: () => null, resolveAudioSource: () => null,
	});
	createVisualModuleRenderer = createRenderer;
	outputTextures = new UniformOrTextureToTextureResolver(device, false);
	presenter = new PortableCanvasRenderer(device, canvas);
	worker.postMessage({ type: 'ready' });
}

let createVisualModuleRenderer: ((resolution: { width: number; height: number }) => VisualModuleRenderer) | null = null;

async function renderFrame(frame: PortableVisualModuleFrame) {
	if (device == null || canvas == null || artwork == null || createVisualModuleRenderer == null || processingFrame) return;
	processingFrame = true;
	try {
		const resolution = getPortableRenderResolution(frame.resolution.width, frame.resolution.height,
			{ resolutionScale: 1, maxPixels: Number.MAX_SAFE_INTEGER, fpsLimit: null }, device.limits.maxTextureDimension2D)!;
		const resized = canvas.width !== resolution.width || canvas.height !== resolution.height;
		if (resized) { canvas.width = resolution.width; canvas.height = resolution.height; }
		if (renderer == null) renderer = createVisualModuleRenderer(resolution);
		else if (resized) renderer.resize(resolution);
		// 前フレームの出力寸法を使わず、リサイズ後の最初の描画からポインターを正しく評価する。
		const outputResolution = renderer.getOutputResolution(artwork.visualModule.primaryOutputId!) ?? resolution;
		const pointerPosition = getPortablePointerPosition(frame.pointerElementPosition, resolution, outputResolution);
		if (frame.resetHistory) { renderer.resetRenderHistory(); previousTime = frame.time; }
		if (resized || frame.resetHistory) previousPointer = { ...pointerPosition };
		const context: VisualModuleRenderContext = {
			time: frame.time, timeDelta: Math.max(0, frame.time - previousTime), endTime: Infinity, progress: 0, isExport: false,
			pointerPosition, pointerPositionPrev: previousPointer,
			evaluatedParamValues: new Map(artwork.visualModule.paramDefs.map(definition => [definition.id, frame.parameters[definition.nameForReference]])),
		};
		// 素材準備中も同じContextを保持する。新しい時刻で置き換え続けると動画の準備が完了しない。
		await renderer.prepare(context, controller.signal);
		controller.signal.throwIfAborted();
		const encoder = device.createCommandEncoder();
		const output = renderer.render(context, encoder) ?? { kind: 'uniform' as const, value: [0, 0, 0, 0] as [number, number, number, number] };
		const texture = outputTextures!.resolve(output);
		presenter!.render(texture, encoder, output.kind === 'texture' ? texture.width / texture.height : resolution.width / resolution.height);
		device.queue.submit([encoder.finish()]);
		// 送信済みフレームを一つに制限し、重い作品でGPUキューや入力遅延が積み上がるのを防ぐ。
		await device.queue.onSubmittedWorkDone();
		controller.signal.throwIfAborted();
		previousTime = frame.time;
		previousPointer = { ...pointerPosition };
		worker.postMessage({ type: 'frame', resolution, time: frame.time });
	} finally { processingFrame = false; }
}

worker.onmessage = event => {
	if (controller.signal.aborted) return;
	const message = event.data;
	if (message.type === 'initialize') void initialize(message.canvas, message.artwork).catch(fail);
	else if (message.type === 'frame') void renderFrame(message.frame).catch(fail);
	else dispose();
};
