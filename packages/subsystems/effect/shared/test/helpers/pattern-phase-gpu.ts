import stripeDefinition from '../../src/fx/stripe/_def_.ts';
import stripeImplementation from '../../src/fx/stripe/_impl_.ts';
import checkerDefinition from '../../src/fx/checker/_def_.ts';
import checkerImplementation from '../../src/fx/checker/_impl_.ts';
import gridDefinition from '../../src/fx/grid/_def_.ts';
import gridImplementation from '../../src/fx/grid/_impl_.ts';
import polkadotDefinition from '../../src/fx/polkadot/_def_.ts';
import polkadotImplementation from '../../src/fx/polkadot/_impl_.ts';
import hexGridDefinition from '../../src/fx/hexGrid/_def_.ts';
import hexGridImplementation from '../../src/fx/hexGrid/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { EffectDefinition } from '../../src/effect-definition.ts';
import type { EffectImplementation, RuntimeEffectParameters } from '../../src/effect-implementation.ts';

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	device.pushErrorScope('validation');
	const resolution = { width: 192, height: 128 };
	const { width, height } = resolution;
	const wgpu = { device, intermediateTextureFormat: 'rgba8unorm' as const, enable32bitDataTextures: false, defaultVertexShaderModule: device.createShaderModule({ code: vertexCode }) };
	const copyTarget = device.createTexture({ size: resolution, format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
	const buffer = device.createBuffer({ size: width * height * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
	const reader = device.createRenderPipeline({ layout: 'auto', vertex: { module: wgpu.defaultVertexShaderModule }, fragment: { module: device.createShaderModule({ code: `
@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(position.xy), 0); }` }), targets: [{ format: 'rgba8unorm' }] } });
	const scalar = (value: number) => constantShaderInput('scalar', value);
	const vector = (value: [number, number]) => constantShaderInput('vector', value);
	const checks: string[] = [];
	const textures: GPUTexture[] = [];
	function inputTexture(pixels: number[]) {
		const texture = device.createTexture({ size: [2, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		textures.push(texture);
		device.queue.writeTexture({ texture }, new Uint8Array(pixels), { bytesPerRow: 8 }, [2, 1]);
		return textureShaderInput(texture, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest' });
	}
	const phaseField = inputTexture([0, 0, 0, 255, 64, 32, 0, 255]);
	const backgroundField = inputTexture([0, 0, 128, 128, 0, 128, 0, 128]);
	const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
	function compare(actual: Uint8Array, expected: Uint8Array, label: string, sourceOffsetX = 0, sourceOffsetY = 0) {
		let mismatches = 0;
		let compared = 0;
		for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
			const sourceX = x + sourceOffsetX;
			const sourceY = y + sourceOffsetY;
			if (sourceX < 0 || sourceX >= width || sourceY < 0 || sourceY >= height) continue;
			const targetIndex = (y * width + x) * 4;
			const sourceIndex = (sourceY * width + sourceX) * 4;
			if (actual.subarray(targetIndex, targetIndex + 4).some((value, channel) => Math.abs(value - expected[sourceIndex + channel]) > 1)) mismatches++;
			compared++;
		}
		// 六角格子の境界などではfloat32の丸めで判定が変わり得るので、0.1%までの境界画素を許容する。
		assert(mismatches <= compared * 0.001, `${label}: ${mismatches}/${compared} pixels differ`);
		checks.push(label);
	}
	const effects: [EffectDefinition, EffectImplementation][] = [
		[stripeDefinition, stripeImplementation], [checkerDefinition, checkerImplementation],
		[gridDefinition, gridImplementation], [polkadotDefinition, polkadotImplementation], [hexGridDefinition, hexGridImplementation],
	];
	try {
		for (const [definition, implementation] of effects) {
			const isStripe = definition.id === 'stripe';
			const phase = (x: number, y = 0) => isStripe ? scalar(x) : vector([x, y]);
			const defaults = Object.fromEntries(Object.entries(definition.paramDefs).map(([name, parameter]) => [name, parameter.canNode === true ? constantShaderInput(parameter.dataType.kind, parameter.defaultValue.value) : parameter.defaultValue.value]));
			const base: RuntimeEffectParameters<typeof definition.paramDefs> = {
				...defaults, angle: scalar(0), density: isStripe ? scalar(3) : vector([3, 2]), fitMode: 'stretch',
				...('color' in defaults ? { color: [1, 1, 1, 1] } : {}),
				...('majorColor' in defaults ? { majorColor: [1, 0, 0, 1], minorColor: [0, 1, 0, 0.75], minorDivisions: 4 } : {}),
			};
			const output = implementation.outputTextureFactories.output({ wgpu, resolution });
			const effect = implementation.init({ wgpu, resolution, params: base, reportStatus: () => {}, fallbackTexture: output });
			const readGroup = device.createBindGroup({ layout: reader.getBindGroupLayout(0), entries: [{ binding: 0, resource: output.createView() }] });
			async function render(overrides: Partial<typeof base> = {}) {
				const commandEncoder = device.createCommandEncoder();
				effect.render({ params: { ...base, ...overrides }, commandEncoder, time: 0, timeDelta: 0, pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
					outputDataMap: { output: { texture: output, textureView: output.createView(), previousFrameTexture: null, previousFrameTextureView: null } },
					createPassEncoder: (encoder, descriptor) => encoder.beginRenderPass(descriptor), createComputePassEncoder: encoder => encoder.beginComputePass(),
					createPassEncoderFor: (encoder, view) => encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
				});
				const pass = commandEncoder.beginRenderPass({ colorAttachments: [{ view: copyTarget.createView(), loadOp: 'clear', storeOp: 'store' }] });
				pass.setPipeline(reader);
				pass.setBindGroup(0, readGroup);
				pass.draw(6);
				pass.end();
				commandEncoder.copyTextureToBuffer({ texture: copyTarget }, { buffer, bytesPerRow: width * 4 }, resolution);
				device.queue.submit([commandEncoder.finish()]);
				await buffer.mapAsync(GPUMapMode.READ);
				const pixels = new Uint8Array(buffer.getMappedRange()).slice();
				buffer.unmap();
				const error = await device.popErrorScope();
				device.pushErrorScope('validation');
				if (error != null) throw new Error(`${definition.id}: ${error.message}`);
				return pixels;
			}
			try {
				const original = await render();
				compare(await render({ phase: phase(0) }), original, `${definition.id}: zero phase`);
				const shifted = await render({ phase: phase(0.25) });
				assert(shifted.some((value, index) => Math.abs(value - original[index]) > 1), `${definition.id}: phase did not change the pattern`);
				// Stretchでは幅192/Density=3より、1周期は64画素。1/4周期は左へ16画素となる。
				compare(shifted, original, `${definition.id}: quarter cycle and sign`, 16);
				if (!isStripe) {
					// 六角格子のY方向は√3周期なので、16画素になる位相量へ換算する。
					const yPhase = definition.id === 'hexGrid' ? 0.25 / Math.sqrt(3) : 0.25;
					compare(await render({ phase: phase(0, yPhase) }), original, `${definition.id}: y phase`, 0, -16);
				}
				const negative = await render({ phase: phase(-0.125, -0.25) });
				compare(await render({ phase: phase(0.875, -0.25) }), negative, `${definition.id}: negative phase and x period`);
				if (!isStripe) compare(await render({ phase: phase(-0.125, 0.75) }), negative, `${definition.id}: y period`);
				const rotated = await render({ angle: scalar(0.25) });
				compare(await render({ angle: scalar(0.25), phase: phase(0.25) }), rotated, `${definition.id}: rotated local axis`, 0, 16);
				const dense = { density: isStripe ? scalar(6) : vector([6, 2]) };
				compare(await render({ ...dense, phase: phase(0.25) }), await render(dense), `${definition.id}: density-independent cycle`, 8);
				const uniformFieldPhase = await render({ phase: phase(64 / 255, 32 / 255) });
				const expectedField = original.map((value, index) => Math.floor(index / 4) % width < width / 2 ? value : uniformFieldPhase[index]);
				compare(await render({ phase: phaseField }), expectedField, `${definition.id}: phase field in output coordinates`);
				const transparentColors = Object.fromEntries(['color', 'majorColor', 'minorColor', 'lineColor'].filter(name => name in defaults).map(name => [name, [0, 0, 0, 0]]));
				const background = await render({ ...transparentColors, background: backgroundField });
				compare(await render({ ...transparentColors, background: backgroundField, phase: phase(0.25, -0.375) }), background, `${definition.id}: stable background coordinates`);
				if (definition.id === 'checker') {
					const halfCycle = await render({ phase: phase(0.5) });
					assert(halfCycle.every((value, index) => value + original[index] === 255), 'Checker: half cycle must invert the checkerboard');
					checks.push('checker: half cycle swaps cells');
				}
				if (definition.id === 'polkadot') {
					// 非整数分割でも模様全体を連続的にずらす。Phaseをfractするとこの移動が失われる。
					const fractionalDivisions = { minorDivisions: 2.5 };
					const fractionalOriginal = await render(fractionalDivisions);
					compare(await render({ ...fractionalDivisions, phase: phase(1) }), fractionalOriginal, 'polkadot: fractional subdivisions move continuously', 64);
				}
			} finally { effect.dispose(); output.destroy(); }
		}
		return { checks };
	} finally {
		for (const texture of textures) texture.destroy();
		copyTarget.destroy(); buffer.destroy(); device.destroy();
	}
}
