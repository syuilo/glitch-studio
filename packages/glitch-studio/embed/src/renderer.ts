import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { createProjectEffectDefinitions, type NativeEffectDefinitions } from '@gs/glitch-studio_shared/project/effects.ts';
import { createEffectInstance } from '@gs/subsystems_effect_renderer/create-effect-instance.ts';
import type { EffectInstance, EffectFrameContext, NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createPortableEffectInputs } from './effect-inputs.ts';
import { AssetTextures } from '@gs/glitch-studio_renderer/asset-textures.ts';
import { PortableCanvasRenderer } from '@gs/glitch-studio_renderer/portable-canvas-renderer.ts';
import { getPortableRenderResolution, getPortablePointerPosition } from './protocol.ts';
import { PortableNodesEffectFrameRateLimiter } from './frame-rate-limiter.ts';
import { PointerStrokeInput, type PointerStrokeSegment } from '@gs/glitch-studio_shared/pointer-stroke-input.ts';
import type { PortableNodesEffectRendererConnection, PortableNodesEffectRendererInitialization, PortableNodesEffectRendererUpdate, PortablePointerPosition } from './protocol.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { Asset } from '@gs/shared/types.ts';

type PortablePointerClick = { position: PortablePointerPosition; time: number };
type PortableNodesEffectFrame = {
	physicalSize: Resolution;
	time: number;
	pointerElementPosition: PortablePointerPosition | null;
	pointerElementClicks: readonly PortablePointerClick[];
	pointerElementStrokeSegments: readonly PointerStrokeSegment[];
	parameters: Record<string, unknown> | null;
	resetHistory: boolean;
};

/** 呼び出された実行先で作品の時計と描画ループを開始する。 */
export function startPortableNodesEffectRenderer(initialization: PortableNodesEffectRendererInitialization,
	definitions: NativeEffectDefinitions, implementations: Readonly<Record<string, NativeEffectImplementation>>): PortableNodesEffectRendererConnection {
	const { canvas, artwork, artworkModuleUrl } = initialization;
	const { resolutionScale, fpsLimit } = artwork.settings;
	const controller = new AbortController();
	const signal = controller.signal;
	const timeOrigin = performance.timeOrigin;
	const frameRateLimiter = new PortableNodesEffectFrameRateLimiter();
	const pointerStroke = new PointerStrokeInput();
	const pointerElementClicks: PortablePointerClick[] = [];
	let pointerElementPosition = initialization.pointerElementPosition;
	let pointerStrokeStartTimestamp = 0;
	let parameters = initialization.parameters;
	let parametersChanged = true;
	let physicalSize: Resolution = { width: 0, height: 0 };
	let canRender = false;
	let playbackStartTimestamp: number | null = null;
	let frameId: number | null = null;
	let frameInFlight = false;
	let resetHistory = true;
	let device: GPUDevice | null = null;
	let assetTextures: AssetTextures | null = null;
	let effect: EffectInstance | null = null;
	let presenter: PortableCanvasRenderer | null = null;
	let renderFrame: (frame: PortableNodesEffectFrame) => Promise<void>;

	function dispose() {
		controller.abort();
		if (frameId != null) cancelAnimationFrame(frameId);
		effect?.dispose();
		assetTextures?.dispose();
		presenter?.destroy();
		device?.destroy();
	}

	function ignoreCancellation(error: unknown) {
		// DOMからの取り外しで、待機中の素材取得や描画準備がキャンセルされる。
		if (!signal.aborted) throw error;
	}

	function getPlaybackTime(timestamp: number): number {
		return playbackStartTimestamp == null ? 0 : Math.max(0, timestamp - playbackStartTimestamp);
	}

	function update(change: PortableNodesEffectRendererUpdate) {
		switch (change.type) {
			case 'layout':
				physicalSize = change.physicalSize;
				canRender = change.canRender;
				frameRateLimiter.reset();
				pointerStroke.reset();
				pointerStrokeStartTimestamp = change.timestamp;
				// 再表示時の時刻は進んでいるため、休止前の画像を直前のフレームとして使わない。
				if (!canRender) resetHistory = true;
				schedule();
				break;
			case 'parameters':
				parameters = change.parameters;
				parametersChanged = true;
				break;
			case 'pointer':
				pointerElementPosition = change.position;
				// 入力の到着時刻に関係なく、採取した瞬間を描画と同じ作品時刻に載せる。
				if (change.clickTimestamp != null) {
					pointerElementClicks.unshift({ position: change.position, time: getPlaybackTime(change.clickTimestamp) });
					if (pointerElementClicks.length > 16) pointerElementClicks.pop();
				}
				if (!canRender) break;
				for (const sample of change.samples) {
					// 復帰後に届くcoalesced sampleにも、表示休止前の入力が含まれる場合がある。
					if (sample.timestamp < pointerStrokeStartTimestamp) continue;
					if (sample.position == null) pointerStroke.end(change.pointerId);
					else pointerStroke.sample(change.pointerId, sample.position, getPlaybackTime(sample.timestamp) / 1000);
				}
				break;
			case 'endPointerStroke':
				pointerStroke.end(change.pointerId);
				break;
		}
	}

	function schedule() {
		if (frameId != null || frameInFlight || playbackStartTimestamp == null || !canRender || signal.aborted) return;
		frameId = requestAnimationFrame(tick);
	}

	function tick(timestamp: number) {
		frameId = null;
		if (!canRender || signal.aborted) return;
		if (!frameRateLimiter.takeFrame(timestamp, fpsLimit)) { schedule(); return; }

		// 非同期の素材準備中に公開値や表示状態が変わっても、このフレームの入力は描画を始めた時点で揃える。
		const frame: PortableNodesEffectFrame = {
			physicalSize, time: getPlaybackTime(timeOrigin + timestamp), pointerElementPosition,
			pointerElementClicks: pointerElementClicks.slice(), pointerElementStrokeSegments: pointerStroke.takeSegments(),
			parameters: parametersChanged ? parameters : null, resetHistory,
		};
		parametersChanged = false;
		resetHistory = false;
		frameInFlight = true;
		// GPU完了を待って次の枠を要求し、重い作品でも描画命令を積み上げない。
		void renderFrame(frame).then(() => {
			frameInFlight = false;
			schedule();
		}, ignoreCancellation);
	}

	async function initialize() {
		const adapter = (await navigator.gpu.requestAdapter())!;
		signal.throwIfAborted();
		const createdDevice = await adapter.requestDevice();
		if (signal.aborted) { createdDevice.destroy(); return; }
		device = createdDevice;
		const assets: Asset[] = [];
		for (const encodedAsset of artwork.assets) {
			if ('fileDataPath' in encodedAsset) {
				const { fileDataPath, ...asset } = encodedAsset;
				const response = await fetch(new URL(fileDataPath, artworkModuleUrl!), { signal });
				const contents = await response.blob();
				// サーバーのMIME判定によらず、デコーダーには書き出し時の型を渡す。
				assets.push({ ...asset, fileData: contents.slice(0, contents.size, asset.fileDataType) });
			} else {
				const { fileDataBase64, ...asset } = encodedAsset;
				assets.push({ ...asset, fileData: new Blob([Uint8Array.fromBase64(fileDataBase64)], { type: asset.fileDataType }) });
			}
		}
		signal.throwIfAborted();
		assetTextures = new AssetTextures(device, assets);
		await assetTextures.waitUntilReady(signal);
		signal.throwIfAborted();
		const nodesEffect = artwork.nodesEffect;
		const port = nodesEffect.primaryOutput!;
		const effectDefinitions = createProjectEffectDefinitions(artwork, definitions);
		const gpu = { device, defaultVertexShaderModule: device.createShaderModule({ code: vertexCode }), enable32bitDataTextures: false };
		// Web書き出しの音声入力は未接続として扱う。
		const resources = { assets, assetTextures: assetTextures.textures };
		presenter = new PortableCanvasRenderer(device, canvas);
		let inputs: ReturnType<typeof createPortableEffectInputs> | null = null;
		let previousTime = 0;
		renderFrame = async frame => {
			const resolution = getPortableRenderResolution(frame.physicalSize.width, frame.physicalSize.height, resolutionScale, createdDevice.limits.maxTextureDimension2D)!;
			const resized = canvas.width !== resolution.width || canvas.height !== resolution.height;
			if (resized) { canvas.width = resolution.width; canvas.height = resolution.height; }
			const layoutChanged = frame.parameters != null && inputs != null && !inputs.update(frame.parameters);
			if (inputs == null || layoutChanged) inputs = createPortableEffectInputs(nodesEffect.paramDefs, frame.parameters!);
			// 実際の表示寸法と公開配列の構造が確定してから配置を生成する。値だけの更新では履歴を保つ。
			if (effect == null || resized || layoutChanged) {
				effect?.dispose();
				effect = null;
				const replacement = await createEffectInstance({
					effectSource: { type: 'inlineNodesEffect', nodesEffect }, definitions: effectDefinitions,
					resolution, resources, inputs: inputs.inputs, usedOutputPorts: new Set([port]),
				}, gpu, id => implementations[id], signal);
				// メインスレッド実行では、非同期の生成中に要素が外れても処理が戻ってくることがある。
				if (signal.aborted) { replacement.dispose(); return; }
				effect = replacement;
				previousTime = frame.time;
			} else if (frame.resetHistory) {
				effect.resetRenderHistory();
				previousTime = frame.time;
			}
			const output = effect.outputs.get(port);
			// リサイズ直後も、今回の出力寸法でポインターの座標を変換する。
			const outputResolution = output?.resolution ?? resolution;
			const pointerToSpatial = (position: { x: number; y: number }) => getPortablePointerPosition(position, resolution, outputResolution);
			const position = frame.pointerElementPosition == null ? null : pointerToSpatial(frame.pointerElementPosition);
			const context: EffectFrameContext = {
				time: frame.time / 1000, timeDelta: Math.max(0, frame.time - previousTime), endTime: Infinity, progress: 0, isExport: false,
				pointerPosition: position ?? [-99999, -99999],
				pointerClicks: frame.pointerElementClicks.map(click => ({
					position: pointerToSpatial(click.position), time: click.time / 1000,
				})),
				pointerStrokeSegments: frame.pointerElementStrokeSegments.map(segment => ({ ...segment, start: pointerToSpatial(segment.start), end: pointerToSpatial(segment.end) })),
			};
			// 動画などの準備と描画に同じContextを使い、準備中に再生時刻が進んでも対象フレームを保つ。
			await effect.prepare(context, signal);
			signal.throwIfAborted();
			const encoder = createdDevice.createCommandEncoder();
			effect.render(context, encoder);
			presenter!.render(output?.texture ?? null, encoder, outputResolution.width / outputResolution.height);
			createdDevice.queue.submit([encoder.finish()]);
			await createdDevice.queue.onSubmittedWorkDone();
			signal.throwIfAborted();
			previousTime = frame.time;
		};
		// 表示休止で時計を止めず、新しい接続では初期化完了から数える。
		playbackStartTimestamp = timeOrigin + performance.now();
		schedule();
	}

	void initialize().catch(ignoreCancellation);
	return { update, dispose };
}
