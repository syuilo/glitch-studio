import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createNativeEffectInputBindings } from '../../shader-input.ts';
import type definition from './_def_.ts';
import { MAX_BLOCK_COUNT } from './_def_.ts';
import shader, { storages } from './block-glitch.shader.ts?shader';

type BlockInstance = {
	center: [number, number];
	halfWidthAxis: [number, number];
	halfHeightAxis: [number, number];
	imageShift: [number, number];
	channelShift: [number, number];
};

const inputImageInstance: BlockInstance = {
	center: [0, 0], halfWidthAxis: [1, 0], halfHeightAxis: [0, 1], imageShift: [0, 0], channelShift: [0, 0],
};

/** ブロックの個数や描画順序を変えても、各番号の各用途で同じ乱数を引く。 */
function blockRandom(seed: number, blockIndex: number, sampleIndex: number): number {
	const uint32Range = 0x100000000;
	let hash = seed ^ Math.imul(Math.floor(seed / uint32Range), 0x27d4eb2d)
		^ Math.imul(blockIndex + 1, 0x9e3779b9) ^ Math.imul(sampleIndex + 1, 0x85ebca6b);
	hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
	hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
	return ((hash ^ (hash >>> 16)) >>> 0) / uint32Range * 2 - 1;
}

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	async init({ device, resolution, outputTextures, inputs }) {
		const output = outputTextures.get('output')!;
		const descriptor: GPURenderPassDescriptor = {
			colorAttachments: [{ view: output.createView(), loadOp: 'clear', storeOp: 'store' }],
		};
		const [halfExtentX, halfExtentY] = getSpatialHalfExtent(resolution);
		const instanceData = createShaderBuffer(storages.blockInstances);
		const inputBindings = createNativeEffectInputBindings({
			device, resolution, inputs, schema: { image: 'color' }, group: 1, sampling: 'level0',
		});
		let instanceBuffer: GPUBuffer | null = null;

		function createInstances(): BlockInstance[] {
			const instances = [inputImageInstance];
			const [width, height] = inputs.dimension.value;
			const maxImageShift = Math.max(0, inputs.maxImageShift.value);
			const maxChannelShift = Math.max(0, inputs.maxChannelShift.value);
			const blockCount = Math.min(MAX_BLOCK_COUNT, Math.max(0, Math.trunc(inputs.blockCount.value)));
			if (blockCount === 0 || width <= 0 || height <= 0 || (maxImageShift === 0 && maxChannelShift === 0)) return instances;

			const seed = Math.trunc(inputs.seed.value);
			const aspectRatioRandomness = Math.min(1, Math.max(0, inputs.aspectRatioRandomness.value));
			const scaleRandomness = Math.min(1, Math.max(0, inputs.scaleRandomness.value));
			const angle = inputs.angle.value;
			const angleSpread = Math.abs(inputs.angleSpread.value);
			for (let blockIndex = 0; blockIndex < blockCount; blockIndex++) {
				const widthFactor = 2 ** (aspectRatioRandomness * blockRandom(seed, blockIndex, 2));
				const scale = 2 ** (scaleRandomness * blockRandom(seed, blockIndex, 3));
				const halfWidth = width * widthFactor * scale / 2;
				const halfHeight = height * scale / widthFactor / 2;
				const blockAngle = angle + angleSpread * blockRandom(seed, blockIndex, 4);
				// UIの正の角度は時計回り。長辺基準で回転してから各軸の画面座標へ換算する。
				const radians = -2 * Math.PI * (blockAngle % 1);
				const cosine = Math.cos(radians);
				const sine = Math.sin(radians);
				const widthAxisX = cosine / halfExtentX;
				const widthAxisY = sine / halfExtentY;
				const imageShift = maxImageShift * blockRandom(seed, blockIndex, 5);
				const channelShift = maxChannelShift * blockRandom(seed, blockIndex, 6);
				instances.push({
					center: [blockRandom(seed, blockIndex, 0), blockRandom(seed, blockIndex, 1)],
					halfWidthAxis: [halfWidth * widthAxisX, halfWidth * widthAxisY],
					halfHeightAxis: [-halfHeight * sine / halfExtentX, halfHeight * cosine / halfExtentY],
					imageShift: [imageShift * widthAxisX, imageShift * widthAxisY],
					channelShift: [channelShift * widthAxisX, channelShift * widthAxisY],
				});
			}
			return instances;
		}

		function dispose() {
			instanceBuffer?.destroy();
			inputBindings.dispose();
		}

		try {
			const layout = device.createBindGroupLayout({ entries: [
				{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
			] });
			const module = device.createShaderModule({ code: inputBindings.code + '\n' + shader });
			const pipeline = await device.createRenderPipelineAsync({
				layout: device.createPipelineLayout({ bindGroupLayouts: [layout, inputBindings.layout] }),
				vertex: { module, entryPoint: 'vertexMain' },
				primitive: { topology: 'triangle-strip' },
				fragment: { module, entryPoint: 'fragmentMain', targets: [{ format: output.format }] },
			});
			const buffer = device.createBuffer({ size: instanceData.arrayBuffer.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
			instanceBuffer = buffer;
			const instanceBindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer } }] });

			return {
				cacheKey: 0,
				render({ commandEncoder }) {
					const instances = createInstances();
					instanceData.set(instances);
					device.queue.writeBuffer(buffer, 0, instanceData.arrayBuffer);
					const inputBindGroup = inputBindings.getBindGroup();
					const pass = commandEncoder.beginRenderPass(descriptor);
					try {
						pass.setPipeline(pipeline);
						pass.setBindGroup(0, instanceBindGroup);
						pass.setBindGroup(1, inputBindGroup);
						// 入力画像を最初に描き、番号順の矩形をブレンドなしで上書きする。
						pass.draw(4, instances.length);
					} finally { pass.end(); }
				},
				dispose,
			};
		} catch (error) {
			dispose();
			throw error;
		}
	},
};

export default implementation;
