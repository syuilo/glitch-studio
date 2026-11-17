import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { implementEffect } from '../../effect-implementation.ts';
import { MAX_POINT_COUNT, MAX_NEIGHBOR_COUNT } from './constants.ts';
import commonCode, { uniforms, structs } from './common.shader.ts?shader';
import updateCode from './update.wgsl?raw';
import connectCode from './connect.wgsl?raw';
import renderCode from './render.wgsl?raw';
import type definition from './_def_.ts';

type Vector3 = [number, number, number];
const cross = (a: Vector3, b: Vector3): Vector3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (value: Vector3): Vector3 => {
	const length = Math.hypot(...value);
	return value.map(component => component / length) as Vector3;
};
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution, format: INTERMEDIATE_TEXTURE_FORMAT,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu, resolution }) => {
		const { device } = wgpu;
		const uniformValues = createShaderBuffer(uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const uniformEntry = { binding: 0, resource: { buffer: uniformBuffer } };
		const updatePipeline = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: commonCode + '\n' + updateCode }), entryPoint: 'update' } });
		const connectPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: commonCode + '\n' + connectCode }), entryPoint: 'connect' } });
		const renderLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
			{ binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
		] });
		const renderModule = device.createShaderModule({ code: commonCode + '\n' + renderCode });
		type Primitive = 'point' | 'line' | 'face';
		const pipelines = new Map<string, GPURenderPipeline>();
		const getPipeline = (primitive: Primitive, mode: 'additive' | 'depth') => {
			const key = `${primitive}:${mode}`;
			let pipeline = pipelines.get(key);
			if (pipeline == null) {
				pipeline = device.createRenderPipeline({
					layout: device.createPipelineLayout({ bindGroupLayouts: [renderLayout] }),
					vertex: { module: renderModule, entryPoint: `${primitive}Vertex` },
					fragment: { module: renderModule, entryPoint: primitive === 'point' ? 'pointFragment' : 'surfaceFragment', targets: [{
						format: INTERMEDIATE_TEXTURE_FORMAT,
						...(mode === 'additive' ? { blend: {
							color: { srcFactor: 'one' as const, dstFactor: 'one' as const, operation: 'add' as const },
							// RGBは光として加算するが、alphaは被覆の和集合とし1を超えさせない。
							alpha: { srcFactor: 'one' as const, dstFactor: 'one-minus-src-alpha' as const, operation: 'add' as const },
						} } : {}),
					}] },
					primitive: { topology: 'triangle-list', cullMode: 'none' },
					...(mode === 'depth' ? { depthStencil: {
						format: 'depth24plus' as const, depthWriteEnabled: true, depthCompare: 'less-equal' as const,
						// 面上の辺と頂点を僅かに優先し、同じ面とのZ-fightingを避ける。
						depthBias: primitive === 'face' ? 0 : primitive === 'line' ? -1 : -2,
					} } : {}),
					multisample: { count: 4 },
				});
				pipelines.set(key, pipeline);
			}
			return pipeline;
		};
		const colorTexture = device.createTexture({ size: resolution, format: INTERMEDIATE_TEXTURE_FORMAT, sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT });
		const colorView = colorTexture.createView();
		let depthTexture: GPUTexture | null = null;
		let buffers: { points: GPUBuffer; neighbors: GPUBuffer; update: GPUBindGroup; connect: GPUBindGroup; render: GPUBindGroup; count: number } | null = null;
		return {
			render: ctx => {
				const params = ctx.params;
				const pointCount = Math.floor(params.pointCount);
				const maximumConnections = Math.floor(params.maximumConnections);
				// 上限を越えた指定を黙って間引くと、書き出しとプレビューで作品の形が変わり得る。
				if (!Number.isFinite(pointCount) || pointCount < 0 || pointCount > MAX_POINT_COUNT) throw new Error(`Point Network 3D: Point Count must be between 0 and ${MAX_POINT_COUNT}.`);
				if (!Number.isFinite(maximumConnections) || maximumConnections < 0 || maximumConnections > MAX_NEIGHBOR_COUNT) throw new Error(`Point Network 3D: Maximum Connections must be between 0 and ${MAX_NEIGHBOR_COUNT}.`);
				const showPoints = params.showPoints && params.pointSize > 0 && params.pointColor[3] > 0;
				const showLines = params.showLines && params.lineWidth > 0 && params.lineColor[3] > 0 && maximumConnections > 0;
				const showFaces = params.showFaces && params.faceProbability > 0 && params.faceColor[3] > 0 && maximumConnections > 1;
				if (pointCount === 0 || (!showPoints && !showLines && !showFaces)) {
					const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
					pass.end();
					return;
				}
				if (buffers == null || buffers.count !== pointCount) {
					buffers?.points.destroy();
					buffers?.neighbors.destroy();
					const points = device.createBuffer({ size: pointCount * structs.PointState.byteLength, usage: GPUBufferUsage.STORAGE });
					const neighbors = device.createBuffer({ size: pointCount * structs.Neighbors.byteLength, usage: GPUBufferUsage.STORAGE });
					const entries = [uniformEntry, { binding: 1, resource: { buffer: points } }, { binding: 2, resource: { buffer: neighbors } }];
					buffers = {
						points, neighbors, count: pointCount,
						update: device.createBindGroup({ layout: updatePipeline.getBindGroupLayout(0), entries: entries.slice(0, 2) }),
						connect: device.createBindGroup({ layout: connectPipeline.getBindGroupLayout(0), entries }),
						render: device.createBindGroup({ layout: renderLayout, entries }),
					};
				}
				const cameraPosition: Vector3 = [...params.cameraPosition, params.cameraZ];
				const direction: Vector3 = [params.cameraTarget[0] - cameraPosition[0], params.cameraTarget[1] - cameraPosition[1], params.cameraTargetZ - cameraPosition[2]];
				// 視点と注視点の一致、真上/真下への注視でも有効な基底を使う。
				const cameraForward = Math.hypot(...direction) < 1e-8 ? [0, 0, -1] as Vector3 : normalize(direction);
				const cameraRight = normalize(cross(cameraForward, Math.abs(cameraForward[1]) > 0.999 ? [0, 0, 1] : [0, 1, 0]));
				const cameraUp = cross(cameraRight, cameraForward);
				const sizeScale = params.sizeSpace === 'screen' ? getSizeReferenceLength(params.sizeReference, resolution) / Math.max(resolution.width, resolution.height) : 1;
				uniformValues.set({
					halfExtent: getSpatialHalfExtent(resolution), pointCount, maximumConnections,
					extent: [...params.extent, params.extentZ].map(value => Math.max(0, value)),
					distribution: ['box', 'ball', 'sphere', 'plane', 'grid'].indexOf(params.distribution), seed: params.seed >>> 0,
					scale: [...params.scale, params.scaleZ], translation: [...params.position, params.positionZ],
					rotation: [params.rotationX, params.rotationY, params.rotationZ], time: params.time,
					motionAmount: Math.max(0, params.motionAmount), motionFrequency: Math.max(0, params.motionFrequency), motionSpeed: params.motionSpeed,
					connectionDistance: Math.max(0, params.connectionDistance), connectionFade: clamp(params.connectionFade, 0, 1), fixedConnections: Number(params.connectionMode === 'fixed'),
					faceProbability: clamp(params.faceProbability, 0, 1), shading: clamp(params.shading, 0, 1),
					pointSize: Math.max(0, params.pointSize) * sizeScale, lineWidth: Math.max(0, params.lineWidth) * sizeScale,
					pointColor: params.pointColor, lineColor: params.lineColor, faceColor: params.faceColor,
					cameraPosition, cameraRight, cameraUp, cameraForward,
					perspective: Number(params.projection === 'perspective'), worldSize: Number(params.sizeSpace === 'world'),
					projectionScale: params.projection === 'perspective' ? 0.5 / Math.tan(clamp(params.fieldOfView, 0.001, 0.499) * Math.PI) : 1 / Math.max(0.001, params.orthographicSize),
					nearClip: clamp(params.nearClip, 0.001, 999), nearFade: Math.max(0, params.nearFade),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const updatePass = ctx.createComputePassEncoder(ctx.commandEncoder);
				updatePass.setPipeline(updatePipeline); updatePass.setBindGroup(0, buffers.update);
				updatePass.dispatchWorkgroups(Math.ceil(pointCount / 64)); updatePass.end();
				if (showLines || showFaces) {
					const connectPass = ctx.createComputePassEncoder(ctx.commandEncoder);
					connectPass.setPipeline(connectPipeline); connectPass.setBindGroup(0, buffers.connect);
					connectPass.dispatchWorkgroups(Math.ceil(pointCount / 64)); connectPass.end();
				}
				if (params.renderMode === 'depth' && depthTexture == null) depthTexture = device.createTexture({ size: resolution, format: 'depth24plus', sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT });
				const pass = ctx.createPassEncoder(ctx.commandEncoder, {
					colorAttachments: [{ view: colorView, resolveTarget: ctx.outputDataMap.output.textureView, loadOp: 'clear', storeOp: 'discard', clearValue: [0, 0, 0, 0] }],
					...(params.renderMode === 'depth' && depthTexture != null ? { depthStencilAttachment: { view: depthTexture.createView(), depthClearValue: 1, depthLoadOp: 'clear' as const, depthStoreOp: 'discard' as const } } : {}),
				});
				pass.setBindGroup(0, buffers.render);
				if (showFaces) { pass.setPipeline(getPipeline('face', params.renderMode)); pass.draw(3, pointCount * maximumConnections * (maximumConnections - 1) / 2); }
				if (showLines) { pass.setPipeline(getPipeline('line', params.renderMode)); pass.draw(6, pointCount * maximumConnections); }
				if (showPoints) { pass.setPipeline(getPipeline('point', params.renderMode)); pass.draw(6, pointCount); }
				pass.end();
			},
			dispose: () => {
				uniformBuffer.destroy(); buffers?.points.destroy(); buffers?.neighbors.destroy();
				colorTexture.destroy(); depthTexture?.destroy();
			},
		};
	},
});
