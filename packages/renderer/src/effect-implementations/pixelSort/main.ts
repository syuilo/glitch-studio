import { implementEffect } from '../../effect-implementation.ts';
import code from './shader.wgsl?raw';
import type definition from '@glitch/shared/effect-definitions/pixelSort.ts';

export default implementEffect<typeof definition>({
	getOut: ({ wgpu, resolution }) => {
		const out = wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		});
		return { output: out };
	},
	init: ({ wgpu: { device, defaultVertexShaderModule, intermediateTextureFormat }, resolution, params, fallbackTexture }) => {
		const module = device.createShaderModule({ code });
		const initialize = device.createComputePipeline({
			layout: 'auto', compute: { module, entryPoint: 'initialize' },
		});
		const merge = device.createComputePipeline({
			layout: 'auto', compute: { module, entryPoint: 'merge' },
		});
		const output = device.createRenderPipeline({
			layout: 'auto',
			vertex: { module: defaultVertexShaderModule },
			fragment: { module, entryPoint: 'fs', targets: [{ format: intermediateTextureFormat }] },
			primitive: { topology: 'triangle-list' },
		});
		const maxPasses = Math.ceil(Math.log2(Math.max(resolution.width, resolution.height)));
		const uniformSize = 40;
		const alignment = device.limits.minUniformBufferOffsetAlignment;
		const stride = Math.ceil(uniformSize / alignment) * alignment;
		// Keep complete rows/columns together so chunk boundaries never split a sort run.
		const maxPixels = Math.floor(Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize) / 12);
		const linesPerBatch = (length: number) => Math.floor(maxPixels / length);
		if (linesPerBatch(Math.max(resolution.width, resolution.height)) < 1) {
			throw new Error('Pixel sort: a single row or column exceeds the storage buffer limit');
		}
		const maxBatches = Math.max(
			Math.ceil(resolution.height / linesPerBatch(resolution.width)),
			Math.ceil(resolution.width / linesPerBatch(resolution.height)),
		);
		const values = new ArrayBuffer(stride * (maxPasses + 1) * maxBatches);
		const integers = new Uint32Array(values);
		const floats = new Float32Array(values);
		const uniforms = device.createBuffer({ size: values.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		let input = params.input;
		let vertical = params.direction === 'vertical';
		const createBatches = () => {
			const length = vertical ? resolution.height : resolution.width;
			const lines = vertical ? resolution.width : resolution.height;
			const batchLines = linesPerBatch(length);
			return Array.from({ length: Math.ceil(lines / batchLines) }, (_, batch) => {
				const lineOffset = batch * batchLines;
				const count = Math.min(batchLines, lines - lineOffset);
				// Only keys and source indices move; RGBA stays in the source texture.
				const buffers = [0, 1].map(() => device.createBuffer({
					size: length * count * 12,
					usage: GPUBufferUsage.STORAGE,
				}));
				const uniformEntry = (pass: number) => ({ binding: 0, resource: {
					buffer: uniforms, offset: (batch * (maxPasses + 1) + pass) * stride, size: uniformSize,
				} });
				const mergeGroups = Array.from({ length: maxPasses }, (_, pass) => device.createBindGroup({
					layout: merge.getBindGroupLayout(0),
					entries: [
						uniformEntry(pass + 1),
						{ binding: 2, resource: { buffer: buffers[pass % 2] } },
						{ binding: 3, resource: { buffer: buffers[1 - pass % 2] } },
					],
				}));
				return { lineOffset, count, buffers, uniformEntry, mergeGroups };
			});
		};
		let batches = createBatches();
		const createInputGroups = () => {
			const view = (input ?? fallbackTexture).createView();
			return batches.map(({ buffers, uniformEntry }) => ({
				initializeGroup: device.createBindGroup({
					layout: initialize.getBindGroupLayout(0),
					entries: [uniformEntry(0), { binding: 1, resource: view }, { binding: 3, resource: { buffer: buffers[0] } }],
				}),
				outputGroups: buffers.map(buffer => device.createBindGroup({
					layout: output.getBindGroupLayout(0),
					entries: [uniformEntry(0), { binding: 1, resource: view }, { binding: 2, resource: { buffer } }],
				})),
			}));
		};
		let inputGroups = createInputGroups();
		return {
			render: ctx => {
				const nextVertical = ctx.params.direction === 'vertical';
				const directionChanged = vertical !== nextVertical;
				if (directionChanged) {
					for (const batch of batches) for (const buffer of batch.buffers) buffer.destroy();
					vertical = nextVertical;
					batches = createBatches();
				}
				if (input !== ctx.params.input || directionChanged) {
					input = ctx.params.input;
					inputGroups = createInputGroups();
				}
				const length = vertical ? resolution.height : resolution.width;
				const passes = Math.ceil(Math.log2(length));
				for (const [batchIndex, batch] of batches.entries()) {
					for (let pass = 0; pass <= passes; pass++) {
						const offset = (batchIndex * (maxPasses + 1) + pass) * stride / 4;
						integers.set([resolution.width, resolution.height, length, batch.count, Number(vertical), Number(ctx.params.order === 'descending'), 2 ** Math.max(0, pass - 1)], offset);
						floats[offset + 7] = Math.min(1, Math.max(0, ctx.params.shadow ? ctx.params.threshold : 1 - ctx.params.threshold));
						integers[offset + 8] = ctx.params.shadow ? 1 : 0;
						integers[offset + 9] = batch.lineOffset;
					}
				}
				// Separate uniform slices keep every dispatch's merge width intact until submission.
				device.queue.writeBuffer(uniforms, 0, values, 0, stride * (maxPasses + 1) * batches.length);
				const compute = ctx.createComputePassEncoder(ctx.commandEncoder);
				for (const [batchIndex, batch] of batches.entries()) {
					compute.setPipeline(initialize);
					compute.setBindGroup(0, inputGroups[batchIndex].initializeGroup);
					compute.dispatchWorkgroups(Math.ceil(batch.count / 64));
					compute.setPipeline(merge);
					for (let pass = 0; pass < passes; pass++) {
						compute.setBindGroup(0, batch.mergeGroups[pass]);
						compute.dispatchWorkgroups(Math.ceil(length / 64), batch.count);
					}
				}
				compute.end();
				const render = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				render.setPipeline(output);
				for (const [batchIndex, batch] of batches.entries()) {
					render.setScissorRect(vertical ? batch.lineOffset : 0, vertical ? 0 : batch.lineOffset,
						vertical ? batch.count : resolution.width, vertical ? resolution.height : batch.count);
					render.setBindGroup(0, inputGroups[batchIndex].outputGroups[passes % 2]);
					render.draw(6);
				}
				render.end();
			},
			dispose: () => {
				uniforms.destroy();
				for (const batch of batches) for (const buffer of batch.buffers) buffer.destroy();
			},
		};
	},
});
