import definition from '../../src/fx/magneticPendulum/_def_.ts';
import implementation from '../../src/fx/magneticPendulum/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput } from '@gs/shared/gpu/shader-input.ts';
import { mapParameterTree } from '@gs/shared/parameter/parameter-tree.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { RuntimeEffectParameters } from '../../src/effect-implementation.ts';

type Parameters = RuntimeEffectParameters<typeof definition.paramDefs>;

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	const wgpu = { device, defaultVertexShaderModule: device.createShaderModule({ code: vertexCode }), enable32bitDataTextures: false };
	const checks: string[] = [];
	const resources: (() => void)[] = [];
	const defaults = Object.fromEntries(Object.entries(definition.paramDefs).map(([name, parameter]) => [name,
		mapParameterTree<ValueParameterBinding>(parameter, parameter.defaultValue, [], (field, binding) => {
			if (binding.inputSource !== 'literal') throw new Error('Expected literal test defaults');
			return 'canNode' in field && field.canNode === true ? constantShaderInput(field.dataType.kind, binding.value) : structuredClone(binding.value);
		}),
	])) as Parameters;
	const reader = device.createRenderPipeline({ layout: 'auto', vertex: { module: wgpu.defaultVertexShaderModule }, fragment: {
		module: device.createShaderModule({ code: `@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(position.xy), 0); }` }), targets: [{ format: 'rgba32float' }],
	} });
	function createRenderer(width: number, height: number) {
		const resolution = { width, height };
		const output = implementation.outputTextureFactories.output({ wgpu, resolution });
		const instance = implementation.init({ wgpu, resolution, params: defaults, resources: {}, fallbackTexture: output, reportStatus: () => {} });
		const copy = device.createTexture({ size: resolution, format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const rowBytes = Math.ceil(width * 16 / 256) * 256;
		const buffer = device.createBuffer({ size: rowBytes * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		const group = device.createBindGroup({ layout: reader.getBindGroupLayout(0), entries: [{ binding: 0, resource: output.createView() }] });
		resources.push(() => { instance.dispose(); output.destroy(); copy.destroy(); buffer.destroy(); });
		return async (params: Parameters) => {
			device.pushErrorScope('validation');
			const encoder = device.createCommandEncoder();
			instance.render({ params, commandEncoder: encoder, time: 0, timeDelta: 0,
				outputDataMap: { output: { texture: output, textureView: output.createView(), previousFrameTexture: null, previousFrameTextureView: null } },
				createPassEncoder: (commandEncoder, descriptor) => commandEncoder.beginRenderPass(descriptor),
				createPassEncoderFor: (commandEncoder, view) => commandEncoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
				createComputePassEncoder: commandEncoder => commandEncoder.beginComputePass(),
				pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
			});
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: copy.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(reader); pass.setBindGroup(0, group); pass.draw(3); pass.end();
			encoder.copyTextureToBuffer({ texture: copy }, { buffer, bytesPerRow: rowBytes }, resolution);
			device.queue.submit([encoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			const pixels = new Float32Array(buffer.getMappedRange().slice(0));
			buffer.unmap();
			const error = await device.popErrorScope();
			if (error != null) throw new Error(error.message);
			return (x: number, y: number) => Array.from(pixels.slice(y * rowBytes / 4 + x * 4, y * rowBytes / 4 + x * 4 + 4));
		};
	}
	try {
		// 【既知の位置に置いた磁石で、表示中心・ズーム・上向きの公開座標を実画素から確かめる】
		// 磁力を十分小さくして初期位置を保ち、最寄りの磁石の色を座標の目印にする。
		// 強さ0は収束先から除外されるため、正の微小値を使う。内部モデルの倍率を誤って
		// UIへ持ち出した場合や、拡大率・縦横比によって移動量が変わる場合を検出する。
		for (const [width, height] of [[9, 9], [9, 5], [5, 9], [27, 27]]) {
			const render = createRenderer(width, height);
			for (const zoom of [1, 1000]) {
				const center: [number, number] = [0.1, -0.05];
				const distance = 1 / (9 * zoom);
				const colors: [number, number, number, number][] = [[1, 0, 0, 1], [0, 1, 0, 1], [0, 0, 1, 1]];
				const positions: [number, number][] = [center, [center[0] + distance, center[1]], [center[0], center[1] + distance]];
				const magnets: Parameters['magnets'] = positions.map((position, index) => ({
					position, height: 0.08, strength: 1e-20, color: constantShaderInput('color', colors[index]), value: index,
				}));
				const pixel = await render({ ...defaults, view: { center, zoom }, magnets,
					damping: constantShaderInput('scalar', 0), restoringStrength: constantShaderInput('scalar', 0),
					timeStep: 0.1, maximumSteps: 6, settlingShading: 0,
				});
				const centerX = (width - 1) / 2;
				const centerY = (height - 1) / 2;
				const offset = width === 27 ? 3 : 1;
				for (const [index, [x, y]] of [[centerX, centerY], [centerX + offset, centerY], [centerX, centerY - offset]].entries()) {
					const actual = pixel(x, y);
					const label = `${width}x${height} zoom ${zoom} ${['center', 'right', 'up'][index]}`;
					if (!actual.every((value, channel) => Number.isFinite(value) && Math.abs(value - colors[index][channel]) < 0.001)) {
						throw new Error(`${label}: ${actual} != ${colors[index]}`);
					}
					checks.push(label);
				}
			}
		}
		return { checks };
	} finally {
		for (const dispose of resources.reverse()) dispose();
		device.destroy();
	}
}
