import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import transformDefinition from '../../src/fx/transform/_def_.ts';
import transform from '../../src/fx/transform/_impl_.ts';
import displacementDefinition from '../../src/fx/vectorDisplacement/_def_.ts';
import displacement from '../../src/fx/vectorDisplacement/_impl_.ts';
import gradientDefinition from '../../src/fx/scalarGradient/_def_.ts';
import gradient from '../../src/fx/scalarGradient/_impl_.ts';
import pointerDefinition from '../../src/fx/pointerTrail/_def_.ts';
import pointer from '../../src/fx/pointerTrail/_impl_.ts';
import trailDefinition from '../../src/fx/positionTrail/_def_.ts';
import trail from '../../src/fx/positionTrail/_impl_.ts';
import opticalFlowDefinition from '../../src/fx/opticalFlow/_def_.ts';
import opticalFlow from '../../src/fx/opticalFlow/_impl_.ts';

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	device.pushErrorScope('validation');
	const vertex = device.createShaderModule({ code: vertexCode });
	const resources: (() => void)[] = [];
	const checks: string[] = [];
	const near = (actual: number, expected: number, name: string) => {
		if (!Number.isFinite(actual) || Math.abs(actual - expected) > 0.002) throw new Error(`${name}: ${actual} != ${expected}`);
	};
	const reader = device.createRenderPipeline({
		layout: 'auto', vertex: { module: vertex },
		fragment: { module: device.createShaderModule({ code: `@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(p.xy), 0); }` }), targets: [{ format: 'rgba32float' }] },
	});
	function field(width: number, height: number, scalar: boolean) {
		const texture = device.createTexture({ size: [width, height], format: scalar ? 'r16float' : 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		const data = new Float16Array(Array.from({ length: width * height }, (_, index) => {
			const x = (index % width + 0.5 - width / 2) / Math.max(width, height);
			const y = (height / 2 - Math.floor(index / width) - 0.5) / Math.max(width, height);
			return scalar ? [x + 2 * y] : [0.5 + x, 0.5 + y, 0, 1];
		}).flat());
		device.queue.writeTexture({ texture }, data, { bytesPerRow: width * (scalar ? 1 : 4) * 2 }, [width, height]);
		resources.push(() => texture.destroy());
		return textureShaderInput(texture, { filterMode: 'linear', fitMode: 'stretch', wrapMode: 'clamp' });
	}
	function movingPattern(width: number, height: number, deltaX: number, deltaY: number) {
		const texture = device.createTexture({ size: [width, height], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		const values = new Float16Array(Array.from({ length: width * height }, (_, index) => {
			const x = index % width - deltaX;
			const y = Math.floor(index / width) - deltaY;
			const value = 0.5 + 0.2 * Math.sin(x * 0.35) + 0.2 * Math.cos(y * 0.28);
			return [value, value, value, 1];
		}).flat());
		device.queue.writeTexture({ texture }, values, { bytesPerRow: width * 8 }, [width, height]);
		resources.push(() => texture.destroy());
		return textureShaderInput(texture, { filterMode: 'linear', fitMode: 'stretch', wrapMode: 'clamp' });
	}
	function effect(definition: any, implementation: any, width: number, height: number) {
		const resolution = { width, height };
		const wgpu = { device, defaultVertexShaderModule: vertex, enable32bitDataTextures: false, intermediateTextureFormat: 'rgba16float' };
		const defaults = Object.fromEntries(Object.entries(definition.paramDefs).map(([key, parameter]: [string, any]) => [key, parameter.canNode === true ? constantShaderInput(parameter.dataType.kind, parameter.defaultValue.value) : structuredClone(parameter.defaultValue.value)]));
		const outputs = Object.fromEntries(Object.entries(implementation.outputTextureFactories).map(([key, factory]: [string, any]) => {
			const texture = factory({ wgpu, resolution, params: defaults });
			// ゼロ初期化された別テクスチャを履歴とし、単位の検証へ以前の力を混ぜない。
			const previous = device.createTexture({ size: resolution, format: texture.format, usage: GPUTextureUsage.TEXTURE_BINDING });
			resources.push(() => { texture.destroy(); previous.destroy(); });
			return [key, { texture, textureView: texture.createView(), previousFrameTexture: previous, previousFrameTextureView: previous.createView() }];
		}));
		const instance = implementation.init({ wgpu, resolution, params: defaults, fallbackTexture: outputs.output.texture, reportStatus: () => {} });
		const copy = device.createTexture({ size: resolution, format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const bytesPerRow = Math.ceil(width * 16 / 256) * 256;
		const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
		resources.push(() => { instance.dispose(); copy.destroy(); buffer.destroy(); });
		return async (overrides: Record<string, any>, pointerVector = { x: 0, y: 0 }) => {
			const encoder = device.createCommandEncoder();
			instance.render({ params: { ...defaults, ...overrides }, outputDataMap: outputs, commandEncoder: encoder, time: 0, timeDelta: 16,
				pointerPosition: { x: 0, y: 0 }, pointerVector,
				createPassEncoder: (e: GPUCommandEncoder, descriptor: GPURenderPassDescriptor) => e.beginRenderPass(descriptor),
				createPassEncoderFor: (e: GPUCommandEncoder, view: GPUTextureView) => e.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
			});
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: copy.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(reader);
			pass.setBindGroup(0, device.createBindGroup({ layout: reader.getBindGroupLayout(0), entries: [{ binding: 0, resource: outputs.output.textureView }] }));
			pass.draw(3); pass.end();
			encoder.copyTextureToBuffer({ texture: copy }, { buffer, bytesPerRow }, resolution);
			device.queue.submit([encoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			const result = new Float32Array(buffer.getMappedRange().slice(0));
			buffer.unmap();
			return (x: number, y: number) => result.slice(y * bytesPerRow / 4 + x * 4, y * bytesPerRow / 4 + x * 4 + 4);
		};
	}
	try {
		// 【位置の差と移動ベクトルが、横長・縦長で同じ画素距離を動かす】
		// TransformとVector Displacementを独立した既知の色勾配と照合し、片軸だけの倍率漏れを検出する。
		for (const [width, height] of [[64, 32], [32, 64]]) {
			const input = field(width, height, false);
			for (const [definition, implementation, overrides] of [
				[transformDefinition, transform, { translation: constantShaderInput('vector', [0.125, 0.125]) }],
				[displacementDefinition, displacement, { vector: constantShaderInput('vector', [0.125, 0.125]), amount: 1 }],
			] as const) {
				const pixel = (await effect(definition, implementation, width, height)({ input, ...overrides }))(width / 2, height / 2);
				near(pixel[0], 0.375 + 0.5 / 64, `${definition.id} X displacement`);
				near(pixel[1], 0.375 - 0.5 / 64, `${definition.id} Y displacement`);
				checks.push(`${definition.id} ${width}x${height} common displacement`);
			}
			// 【偏微分も共通単位で計算する】
			// f=x+2yの勾配は縦横比にかかわらず(1,2)。正規化後は長さ1を保つ。
			const renderGradient = effect(gradientDefinition, gradient, width, height);
			const scalar = field(width, height, true);
			for (const normalize of [false, true]) {
				const pixel = (await renderGradient({ input: scalar, normalize, strength: 1 }))(width / 2, height / 2);
				near(pixel[0], 1 / (normalize ? Math.sqrt(5) : 1), 'common gradient X');
				near(pixel[1], 2 / (normalize ? Math.sqrt(5) : 1), 'common gradient Y');
			}
			checks.push(`${width}x${height} common gradient`);
			// 【Optical Flowの出力は長辺単位/秒で、縦横の同じ画素移動を同じ長さにする】
			// 既知の半画素移動を低周波の2次元模様で推定し、LK近似の誤差だけを許容する。
			// 各軸±1の倍率を残すと横長のY成分だけが増幅されるため、この比較で検出できる。
			for (const axis of [0, 1]) {
				const renderFlow = effect(opticalFlowDefinition, opticalFlow, width, height);
				await renderFlow({ input: movingPattern(width, height, 0, 0), confidence: 0.000001, smoothing: 0 });
				const pixel = (await renderFlow({ input: movingPattern(width, height, axis === 0 ? 0.5 : 0, axis === 1 ? -0.5 : 0), confidence: 0.000001, smoothing: 0 }))(width / 2, height / 2);
				const expected = 0.5 / 64 / 0.016;
				if (Math.abs(pixel[axis] - expected) > 0.06 || Math.abs(pixel[1 - axis]) > 0.06) throw new Error(`optical flow ${width}x${height} axis ${axis}: ${pixel} != ${expected}`);
			}
			checks.push(`${width}x${height} optical flow common units per second`);
		}
		// 【ポインターと位置入力が同じ距離・ベクトル出力を使う】
		// 画素中心で力を測り、位置の差を取るPosition Trailにも余分な縦横比補正が入らないことを確認する。
		const pointerPixel = (await effect(pointerDefinition, pointer, 65, 33)({ radius: 0.2, strength: 1 }, { x: 1 / 64, y: 1 / 64 }))(32, 16);
		near(pointerPixel[0], 0.5, 'pointer X'); near(pointerPixel[1], 0.5, 'pointer Y');
		for (const axis of [0, 1]) {
			const renderTrail = effect(trailDefinition, trail, 65, 33);
			await renderTrail({ position: [0, 0], strength: 1 });
			const position = axis === 0 ? [8 / 65, 0] : [0, 8 / 65];
			const pixel = (await renderTrail({ position, radius: 0.2, strength: 1 }))(axis === 0 ? 40 : 32, axis === 0 ? 16 : 8);
			near(pixel[axis], 32 * 8 / 65, 'position delta'); near(pixel[1 - axis], 0, 'orthogonal position delta');
		}
		checks.push('pointer and position trails share common vector units');
		const error = await device.popErrorScope();
		if (error != null) throw new Error(error.message);
		return { checks };
	} finally {
		for (const dispose of resources.reverse()) dispose();
		device.destroy();
	}
}
