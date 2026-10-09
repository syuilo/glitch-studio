import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { TimelineLayerContext, TimelineLayerRenderer } from '@gs/subsystems_timeline_renderer/timeline-renderer.ts';
import { createGroupTimelineLayer } from '@gs/subsystems_timeline_renderer/layers/group/group-timeline-layer.ts';
import { TimelineRenderer } from '@gs/subsystems_timeline_renderer/timeline-renderer.ts';
import { timelineCompositingParamDefs } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import type { TimelineGroupLayer, TimelineLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { UniformOrTexture } from '@gs/shared/gpu/uniform-or-texture.ts';

export async function checkTimelineGroups(device: GPUDevice, vertex: GPUShaderModule, read: (output: GPUTexture) => Promise<number[]>) {
	const resolution = { width: 8, height: 4 };
	const blue: UniformOrTexture = { kind: 'uniform', value: [0, 0, 1, 1] };
	const transparent: UniformOrTexture = { kind: 'uniform', value: [0, 0, 0, 0] };
	const child: TimelineLayer = { id: 'child', name: 'child', isDisabled: false, automationGraphs: [], layerType: 'image',
		compositingParamValues: Object.fromEntries(Object.entries(timelineCompositingParamDefs).map(([key, def]) => [key, structuredClone(def.defaultValue)])) as TimelineGroupLayer['compositingParamValues'],
		clips: [
			{ id: 'red', assetId: 'red', startMs: 100, durationMs: 100, contentOffsetMs: 25 },
			{ id: 'transparent', assetId: 'transparent', startMs: 300, durationMs: 100, contentOffsetMs: 0 },
		] };
	const group = (id: string, layers: TimelineLayer[]): TimelineGroupLayer => ({ id, name: id, layerType: 'group', layers,
		isDisabled: false, automationGraphs: [], audioParamValues: { volume: { inputSource: 'literal', value: 1 } },
		compositingParamValues: { ...structuredClone(child.compositingParamValues), opacity: { inputSource: 'literal', value: 0.5 } } });
	const inner = group('inner', [child]);
	const outer = group('outer', [inner]);
	const contexts: TimelineLayerContext<UniformOrTexture>[] = [];
	const destroyed: string[] = [];
	const completed: string[] = [];
	const createLayer = (layer: TimelineLayer, clipId: string | null): TimelineLayerRenderer<UniformOrTexture> => {
		if (layer.layerType === 'group') {
			if (clipId !== null) throw new Error('Groups must not create artificial clips');
			return createGroupTimelineLayer(() => layer, { device, vertex, resolution, format: 'rgba8unorm', createLayer, getLayerVersion: () => 0 });
		}
		return { async evaluate(context) {
			contexts.push(context);
			return { output: clipId === 'red' ? { kind: 'uniform', value: [1, 0, 0, 1] } : transparent, gpuTime: 7 };
		}, destroy() { destroyed.push(clipId!); } };
	};
	const renderer = new TimelineRenderer<UniformOrTexture, TimelineLayer>({ fallbackOutput: blue, createLayer });
	async function check(name: string, time: number, expected: number[], delta = 0) {
		const result = await renderer.evaluateAt(time, [outer], delta, true);
		if (!result) throw new Error('Frame unexpectedly cancelled');
		const actual = result.output.kind === 'texture' ? await read(result.output.texture)
			: Array.from({ length: 32 }, () => result.output.kind === 'uniform' ? result.output.value.map(value => Math.round(value * 255)) : []).flat();
		if (actual.length !== 128 || actual.some((value, i) => Math.abs(value - expected[i % 4]) > 2)) throw new Error(`${name}: ${actual} != ${expected}`);
		completed.push(name);
		return result;
	}
	try {
		// 【入れ子の不透明度は各グループの合成後に適用する】
		// 親の青を子の背景へ流すと結果が変わる。時刻も素材の内容時刻へ変換してはいけない。
		const first = await check('nested groups isolate backgrounds and apply each opacity once', 150, [64, 0, 191, 255]);
		if (first.gpuTime !== 7 || JSON.stringify(contexts[0].input) !== JSON.stringify(transparent)
			|| contexts[0].sceneTimeMs !== 150 || contexts[0].contentTimeMs !== 75 || !contexts[0].isExport) throw new Error('Invalid group evaluation context');
		await check('groups preserve child histories between active frames', 175, [64, 0, 191, 255], 25);
		if (contexts[1].timeDelta !== 25 || destroyed.length !== 0) throw new Error('Active child history was reset');
		// 【空白区間と透明画像のreplaceを区別する】
		// 仮クリップ全体を有効な映像とすると、子が存在しない隙間まで背景を消してしまう。
		outer.compositingParamValues.blendMode = { inputSource: 'literal', value: 'replace' };
		outer.compositingParamValues.opacity = { inputSource: 'literal', value: 1 };
		await check('group gaps preserve the parent background even with replace', 250, [0, 0, 255, 255]);
		if (destroyed.join() !== 'red') throw new Error('Inactive clip resources were retained');
		await check('active transparent group output replaces the parent background', 300, [0, 0, 0, 0]);
		// 【祖先の無効化は子の評価を止め、保持中の配置を解放する】
		// 親のopacityを下げる実装ではデコードやGPU資源が残るため、破棄も確認する。
		outer.isDisabled = true;
		await check('disabling an ancestor releases nested instances', 320, [0, 0, 255, 255]);
		if (destroyed.join() !== 'red,transparent' || contexts.length !== 3) throw new Error('Disabled descendants were evaluated or retained');
		return completed;
	} finally { renderer.clear(); }
}

// 【グループ単体のGPU検証を他のエフェクトの成否から独立させる】
// 借用した合成結果にはCOPY_SRCを要求せず、読み出し用テクスチャへ転写して検証する。
export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (!adapter) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	device.pushErrorScope('validation');
	const vertex = device.createShaderModule({ code: vertexCode });
	const target = device.createTexture({ size: [8, 4], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
	const buffer = device.createBuffer({ size: 4 * 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
	const copy = createShaderInputPipeline({ device, vertex, schema: { source: 'color' }, targets: [{ format: 'rgba8unorm' }],
		code: '@fragment fn fs(@location(0) position: vec2f) -> @location(0) vec4f { return read_source(position); }' });
	try {
		const completed = await checkTimelineGroups(device, vertex, async output => {
			const encoder = device.createCommandEncoder();
			const variant = copy.update({ source: textureShaderInput(output, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest' }) }, { width: 8, height: 4 });
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(variant.pipeline);
			pass.setBindGroup(copy.inputGroup, variant.bindGroup);
			pass.draw(6);
			pass.end();
			encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow: 256 }, [8, 4]);
			device.queue.submit([encoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			const bytes = new Uint8Array(buffer.getMappedRange());
			const pixels = Array.from({ length: 4 }, (_, y) => Array.from(bytes.slice(y * 256, y * 256 + 32))).flat();
			buffer.unmap();
			return pixels;
		});
		const error = await device.popErrorScope();
		if (error) throw new Error(error.message);
		return completed;
	} finally { copy.dispose(); buffer.destroy(); target.destroy(); device.destroy(); }
}
