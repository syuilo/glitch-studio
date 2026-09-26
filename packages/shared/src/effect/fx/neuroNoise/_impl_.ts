import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { implementEffect } from '../../effect-implementation.ts';
import { createShaderInputPipeline } from '../../../shader-input-pipeline.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

function randomValue(cell: number, seed: number): number {
	let bits = (cell | 0) ^ seed;
	bits = Math.imul(bits ^ (bits >>> 16), 0x7feb352d);
	bits = Math.imul(bits ^ (bits >>> 15), 0x846ca68b);
	return ((bits ^ (bits >>> 16)) >>> 0) / 0x100000000;
}

function phaseNoise(time: number, seed: number): number {
	const cell = Math.floor(time);
	const fraction = time - cell;
	// 格子境界で速度・加速度が連続になる補間。逆再生や任意時刻へのシークにも状態を持たない。
	const weight = fraction ** 3 * (fraction * (fraction * 6 - 15) + 10);
	const start = randomValue(cell, seed);
	return start + (randomValue(cell + 1, seed) - start) * weight;
}

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution, format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu }) => {
		const device = wgpu.device;
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(code).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const pipelines = createShaderInputPipeline({
			device, vertex: wgpu.defaultVertexShaderModule, code,
			schema: { background: 'color', colorFront: 'color', colorMid: 'color' },
			targets: [{ format: wgpu.intermediateTextureFormat }],
			internalLayouts: [layout],
		});
		// uniform配列の16byte strideに合わせ、xyだけ使うvec4を15層分用意する。
		const phases = new Float32Array(15 * 4);
		return {
			render: ctx => {
				const output = ctx.outputDataMap.output.texture;
				const extent = ctx.params.fitMode === 'cover'
					? Math.max(output.width, output.height)
					: Math.min(output.width, output.height);
				const time = ctx.params.time;
				const fullTurn = 2 * Math.PI;
				for (let layer = 0; layer < 15; layer++) {
					for (let axis = 0; axis < 2; axis++) {
						const seed = Math.imul(layer * 2 + axis + 1, 0x9e3779b9);
						// 元は全層がtime*0.5だけ進むため、time=4πで完全に同じ形へ戻る。
						// 時間を折り返さないノイズを層・軸ごとに加え、相対位相そのものを変化させる。
						// time=0では補正を0にし、元の初期形状を保つ。
						const evolution = phaseNoise(time * 0.15, seed) - phaseNoise(0, seed);
						// 全画素で共通の計算をCPUで行う。f32へ変換する前に三角関数の位相だけを
						// 小さく保ち、長時間再生で時間の量子化が目立つのを抑える。
						phases[layer * 4 + axis] = ((time * 0.5) % fullTurn + fullTurn * evolution) % fullTurn;
					}
				}
				uniformValues.set({
					coordinateScale: ctx.params.fitMode === 'stretch' ? [1, 1] : [output.width / extent, output.height / extent],
					offset: ctx.params.offset,
					scale: Math.max(0.01, ctx.params.scale),
					angle: ctx.params.angle * Math.PI,
					brightness: Math.max(0, Math.min(1, ctx.params.brightness)),
					contrast: Math.max(0, Math.min(1, ctx.params.contrast)),
					phases,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const variant = pipelines.update({ background: ctx.params.background, colorFront: ctx.params.colorFront, colorMid: ctx.params.colorMid }, output);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(0, group);
				pass.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				pass.draw(6);
				pass.end();
			},
			dispose: () => {
				pipelines.dispose();
				uniformBuffer.destroy();
			},
		};
	},
});
