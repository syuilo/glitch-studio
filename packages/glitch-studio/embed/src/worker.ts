import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { createProjectEffectDefinitions, type NativeEffectDefinitions } from '@gs/glitch-studio_shared/project/effects.ts';
import { createEffectInstance } from '@gs/subsystems_effect_renderer/create-effect-instance.ts';
import type { EffectInstance, EffectFrameContext, NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createPortableEffectInputs } from './effect-inputs.ts';
import { AssetTextures } from '@gs/glitch-studio_renderer/asset-textures.ts';
import { PortableCanvasRenderer } from '@gs/glitch-studio_renderer/portable-canvas-renderer.ts';
import { getPortableRenderResolution, getPortablePointerPosition } from './protocol.ts';
import type { PortableCustomNodeGraphEffectRequest, PortableCustomNodeGraphEffectResponse, PortableCustomNodeGraphEffectFrame } from './protocol.ts';
import type { PortableCustomNodeGraphEffect } from '@gs/glitch-studio_shared/portable-custom-node-graph-effect.ts';

/** 作品に配置されたNative Effectだけをカタログから受け取る。 */
export function startPortableCustomNodeGraphEffectWorker(definitions: NativeEffectDefinitions, implementations: Readonly<Record<string, NativeEffectImplementation>>) {
	const worker = globalThis as unknown as {
		onmessage: (event: MessageEvent<PortableCustomNodeGraphEffectRequest>) => void;
		postMessage: (message: PortableCustomNodeGraphEffectResponse) => void;
	};
	const controller = new AbortController();
	let device: GPUDevice | null = null;
	let assetTextures: AssetTextures | null = null;
	let effect: EffectInstance | null = null;
	let presenter: PortableCanvasRenderer | null = null;
	let renderFrame: ((frame: PortableCustomNodeGraphEffectFrame) => Promise<void>) | null = null;
	let processingFrame = false;

	function dispose() {
		controller.abort();
		effect?.dispose();
		assetTextures?.dispose();
		presenter?.destroy();
		device?.destroy();
		effect = null;
		renderFrame = null;
		device = null;
	}

	function fail(error: unknown) {
		if (controller.signal.aborted) return;
		worker.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
		dispose();
	}

	async function initialize(canvas: OffscreenCanvas, data: PortableCustomNodeGraphEffect) {
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
		const customNodeGraphEffect = data.customNodeGraphEffect;
		const port = customNodeGraphEffect.primaryOutput!;
		const effectDefinitions = createProjectEffectDefinitions(data, definitions);
		const gpu = { device, defaultVertexShaderModule: device.createShaderModule({ code: vertexCode }), enable32bitDataTextures: false };
		// Web書き出しではPlayerの権限取得や再生管理を避けるため、Playerと音声入力は未接続として扱う。
		const resources = { assets, assetTextures: assetTextures.textures };
		presenter = new PortableCanvasRenderer(device, canvas);
		let inputs: ReturnType<typeof createPortableEffectInputs> | null = null;
		let previousTime = 0;
		let previousPointer: [number, number] | null = null;
		renderFrame = async frame => {
			const resolution = getPortableRenderResolution(frame.resolution.width, frame.resolution.height,
				{ resolutionScale: 1, maxPixels: Number.MAX_SAFE_INTEGER, fpsLimit: null }, createdDevice.limits.maxTextureDimension2D)!;
			const resized = canvas.width !== resolution.width || canvas.height !== resolution.height;
			if (resized) { canvas.width = resolution.width; canvas.height = resolution.height; }
			const layoutChanged = frame.parameters != null && inputs != null && !inputs.update(frame.parameters);
			if (inputs == null || layoutChanged) inputs = createPortableEffectInputs(customNodeGraphEffect.paramDefs, frame.parameters!);
			// 実際の表示寸法と公開配列の構造が確定してから配置を生成する。値だけの更新では履歴を保つ。
			if (effect == null || resized || layoutChanged) {
				effect?.dispose();
				effect = await createEffectInstance({
					effectSource: { type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect }, definitions: effectDefinitions,
					resolution, resources, inputs: inputs.inputs, usedOutputPorts: new Set([port]),
				}, gpu, id => implementations[id], controller.signal);
				previousPointer = null;
				previousTime = frame.time;
			} else if (frame.resetHistory) {
				effect.resetRenderHistory();
				previousPointer = null;
				previousTime = frame.time;
			}
			const output = effect.outputs.get(port);
			// リサイズ直後も、今回の出力寸法でポインターの座標を変換する。
			const outputResolution = output?.resolution ?? resolution;
			const position = getPortablePointerPosition(frame.pointerElementPosition, resolution, outputResolution);
			const context: EffectFrameContext = {
				time: frame.time / 1000, timeDelta: Math.max(0, frame.time - previousTime), endTime: Infinity, progress: 0, isExport: false,
				pointerPosition: position ?? [-99999, -99999], pointerVector: position == null || previousPointer == null
					? [0, 0] : [position[0] - previousPointer[0], position[1] - previousPointer[1]],
			};
			// 動画などの準備と描画に同じContextを使い、準備中に再生時刻が進んでも対象フレームを保つ。
			await effect.prepare(context, controller.signal);
			controller.signal.throwIfAborted();
			const encoder = createdDevice.createCommandEncoder();
			effect.render(context, encoder);
			presenter!.render(output?.texture ?? null, encoder, outputResolution.width / outputResolution.height);
			createdDevice.queue.submit([encoder.finish()]);
			await createdDevice.queue.onSubmittedWorkDone();
			controller.signal.throwIfAborted();
			previousTime = frame.time;
			previousPointer = position;
			worker.postMessage({ type: 'frame', resolution, time: frame.time });
		};
		worker.postMessage({ type: 'ready' });
	}

	worker.onmessage = event => {
		if (controller.signal.aborted) return;
		const message = event.data;
		if (message.type === 'initialize') void initialize(message.canvas, message.artwork).catch(fail);
		else if (message.type === 'frame') {
			// GPU完了まで一つのフレームを処理し、重い作品でGPUキューと入力遅延が積み上がるのを防ぐ。
			if (renderFrame == null || processingFrame) return;
			processingFrame = true;
			void renderFrame(message.frame).catch(fail).finally(() => { processingFrame = false; });
		} else dispose();
	};
}
