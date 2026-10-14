<template>
<canvas ref="canvas" :class="$style.canvas"></canvas>
</template>

<script lang="ts">
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';

type BgRendererInstance = {
	render: (ctx: {
		time: number;
		timeDelta: number;
		commandEncoder: GPUCommandEncoder;
		createPassEncoder: (commandEncoder: GPUCommandEncoder, descriptor?: GPURenderPassDescriptor) => GPURenderPassEncoder;
	}) => void;
	dispose?: () => void;
};

type BgRendererDef = {
	init: (args: {
		canvas: HTMLCanvasElement;
		width: number;
		height: number;
		wgpu: {
			device: GPUDevice;
			context: GPUCanvasContext;
			sampler: GPUSampler;
			defaultVertexShaderModule: GPUShaderModule;
		};
	}) => Promise<BgRendererInstance>;
};

function defineBgRenderer(def: BgRendererDef): BgRendererDef {
	return def;
}

const defaultBgRendererDef = defineBgRenderer({
	init: async ({ width, height, wgpu, canvas }) => {
		const code = `
struct Uniforms {
	aspectRatio: f32,
	divisions: f32,
};

@group(0) @binding(1) var<uniform> uniforms: Uniforms;
@group(0) @binding(2) var mySampler: sampler;
@group(0) @binding(3) var pointerTrailTexture: texture_2d<f32>;

fn getPixelatedUv(uv: vec2f, cellSize: vec2f) -> vec2f {
	return (cellSize * floor(uv / cellSize)) + (cellSize / 2.0);
}

fn getPointerTrailAspectVector(aspectUv: vec2f) -> vec2f {
	return scaleUvToCoverGivenAspectRatio(textureSample(pointerTrailTexture, mySampler, convertTexCoords(unscaleUvToCoverGivenAspectRatio(aspectUv, uniforms.aspectRatio))).rg, uniforms.aspectRatio);
}

fn scaleUvToCoverGivenAspectRatio(uv: vec2f, aspectRatio: f32) -> vec2f {
	return uv / vec2f(1.0, aspectRatio) * select(1.0, aspectRatio, 1.0 > aspectRatio);
}

fn unscaleUvToCoverGivenAspectRatio(uv: vec2f, aspectRatio: f32) -> vec2f {
	return uv * vec2f(1.0, aspectRatio) / select(1.0, aspectRatio, 1.0 > aspectRatio);
}

fn modVec2f(a: vec2f, b: vec2f) -> vec2f {
	return a - b * floor(a / b);
}

fn premultiplyAlpha(color: vec4f) -> vec4f {
	return vec4f(color.rgb * color.a, color.a);
}

fn convertTexCoords(uv: vec2f) -> vec2f {
	return vec2f(uv.x, -uv.y) * 0.5 + vec2f(0.5);
}

struct FragmentIn {
	@location(0) uv: vec2f,
};

@fragment
fn fs(fragData: FragmentIn) -> @location(0) vec4f {
	let uv = scaleUvToCoverGivenAspectRatio(fragData.uv, uniforms.aspectRatio);
	var cellSize = vec2f(1.0 / (uniforms.divisions * 0.5));
	var modUv = modVec2f(uv, cellSize);
	let cellUv = getPixelatedUv(uv, cellSize);
	let dotRadius = 0.1;
	let shiftStrength = 0.2;
	let shift = -getPointerTrailAspectVector(cellUv) * shiftStrength * cellSize;
	let power = length(getPointerTrailAspectVector(cellUv));
	let transformedCoords = (modUv + shift) / cellSize;
	let out_color = select(vec4f(0.0), vec4f(0.25 + min(power, 0.25)), distance(transformedCoords, vec2(0.5, 0.5)) < dotRadius);
	return premultiplyAlpha(out_color);
}

struct PointerTrailUniforms {
	aspectRatio: f32,
	timeDelta: f32,
	pointerPosition: vec2f,
	pointerVector: vec2f,
};

@group(1) @binding(1) var<uniform> pointerTrailUniforms: PointerTrailUniforms;
@group(1) @binding(2) var pointerTrailSampler: sampler;
@group(1) @binding(3) var pointerTrailBeforeTexture: texture_2d<f32>;

fn getPointerForceVector(uv: vec2f) -> vec2f {
	if (pointerTrailUniforms.pointerPosition.x <= -999.0 && pointerTrailUniforms.pointerPosition.y <= -999.0) {
		return vec2f(0.0);
	}

	var v = vec2f(0.0);
	let radius = 0.3;

	let pos = scaleUvToCoverGivenAspectRatio(pointerTrailUniforms.pointerPosition, pointerTrailUniforms.aspectRatio);
	let d = distance(uv, pos);
	if (d < radius) {
		let gradate = 1.0 - (d / radius);
		v = (gradate * gradate) * (pointerTrailUniforms.pointerVector * 32.0);
	}

	return v;
}

@fragment
fn fsPointerTrail(fragData: FragmentIn) -> @location(0) vec4f {
	var uv = scaleUvToCoverGivenAspectRatio(fragData.uv, pointerTrailUniforms.aspectRatio);
	var before = textureSample(pointerTrailBeforeTexture, pointerTrailSampler, convertTexCoords(fragData.uv)).rg;
	before *= exp2(-pointerTrailUniforms.timeDelta / 300.0);
	let v = getPointerForceVector(uv);
	return vec4f(before + v, 0.0, 1.0);
}
		`;

		const shaderModule = wgpu.device.createShaderModule({
			code: code,
		});

		const shaderDataDefinitions = makeShaderDataDefinitions(code);
		const pointerTrailTextureFormat: GPUTextureFormat = 'rg16float';

		const pointerTrailPipeline = wgpu.device.createRenderPipeline({
			vertex: {
				module: wgpu.defaultVertexShaderModule,
			},
			fragment: {
				module: shaderModule,
				entryPoint: 'fsPointerTrail',
				targets: [{
					format: pointerTrailTextureFormat,
				}],
			},
			primitive: {
				topology: 'triangle-list',
			},
			layout: 'auto',
		});

		const pointerTrailBuffers = [0, 1].map(() => wgpu.device.createTexture({
			size: { width, height },
			format: pointerTrailTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}));
		const pointerTrailBufferViews = pointerTrailBuffers.map(pointerTrailBuffer => pointerTrailBuffer.createView());

		const pointerTrailUniformValues = makeStructuredView(shaderDataDefinitions.uniforms.pointerTrailUniforms);
		const pointerTrailUniformBuffer = wgpu.device.createBuffer({
			size: pointerTrailUniformValues.arrayBuffer.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});

		const pointerTrailBindGroups = pointerTrailBufferViews.map(pointerTrailBufferView => wgpu.device.createBindGroup({
			layout: pointerTrailPipeline.getBindGroupLayout(1),
			entries: [
				{ binding: 1, resource: { buffer: pointerTrailUniformBuffer } },
				{ binding: 2, resource: wgpu.sampler },
				{ binding: 3, resource: pointerTrailBufferView },
			],
		}));
		let currentPointerTrailBufferIndex = 0;

		let pointerX = -99999.0;
		let pointerY = -99999.0;
		let pointerXPrev = pointerX;
		let pointerYPrev = pointerY;
		let lastPointerMovedAt = 0;

		const onPointerMove = (ev: PointerEvent) => {
			const rect = canvas.getBoundingClientRect();
			const w = rect.width;
			const h = rect.height;
			const x = (ev.clientX - rect.left) / w;
			const y = (ev.clientY - rect.top) / h;
			// 0~1 -> -1~1
			pointerX = x * 2 - 1;
			pointerY = y * 2 - 1;
			lastPointerMovedAt = performance.now();
		};

		window.addEventListener('pointermove', onPointerMove);

		const pipeline = wgpu.device.createRenderPipeline({
			vertex: {
				module: wgpu.defaultVertexShaderModule,
			},
			fragment: {
				module: shaderModule,
				entryPoint: 'fs',
				targets: [{
					format: navigator.gpu.getPreferredCanvasFormat(),
				}],
			},
			primitive: {
				topology: 'triangle-list',
			},
			layout: 'auto',
		});

		const uniformValues = makeStructuredView(shaderDataDefinitions.uniforms.uniforms);

		const uniformBuffer = wgpu.device.createBuffer({
			size: uniformValues.arrayBuffer.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});

		const bindGroups = pointerTrailBufferViews.map(pointerTrailBufferView => wgpu.device.createBindGroup({
			layout: pipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 1, resource: { buffer: uniformBuffer } },
				{ binding: 2, resource: wgpu.sampler },
				{ binding: 3, resource: pointerTrailBufferView },
			],
		}));

		return {
			render: ctx => {
				if (lastPointerMovedAt + 30 < performance.now()) {
					pointerX = -99999.0;
					pointerY = -99999.0;
				}

				const pointerVectorX = pointerXPrev === -99999.0 ? 0 : pointerX - pointerXPrev;
				const pointerVectorY = pointerYPrev === -99999.0 ? 0 : pointerY - pointerYPrev;

				pointerXPrev = pointerX;
				pointerYPrev = pointerY;
				const pointerTrailReadBufferIndex = currentPointerTrailBufferIndex;
				const pointerTrailWriteBufferIndex = 1 - pointerTrailReadBufferIndex;

				{ // pointer trail pass
					pointerTrailUniformValues.set({
						aspectRatio: width / height,
						timeDelta: ctx.timeDelta,
						pointerPosition: [pointerX, -pointerY],
						pointerVector: [pointerVectorX, -pointerVectorY],
					});
					wgpu.device.queue.writeBuffer(pointerTrailUniformBuffer, 0, pointerTrailUniformValues.arrayBuffer);

					const passEncoder = ctx.commandEncoder.beginRenderPass({
						colorAttachments: [{
							view: pointerTrailBufferViews[pointerTrailWriteBufferIndex],
							clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
							loadOp: 'clear',
							storeOp: 'store',
						}],
					});
					passEncoder.setPipeline(pointerTrailPipeline);
					passEncoder.setBindGroup(1, pointerTrailBindGroups[pointerTrailReadBufferIndex]);
					passEncoder.draw(6);
					passEncoder.end();
				}
				currentPointerTrailBufferIndex = pointerTrailWriteBufferIndex;

				uniformValues.set({
					aspectRatio: width / height,
					divisions: 64,
				});
				wgpu.device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);

				const passEncoder = ctx.createPassEncoder(ctx.commandEncoder);
				passEncoder.setPipeline(pipeline);
				passEncoder.setBindGroup(0, bindGroups[currentPointerTrailBufferIndex]);
				passEncoder.draw(6);
				passEncoder.end();
			},
			dispose() {
				window.removeEventListener('pointermove', onPointerMove);
				for (const pointerTrailBuffer of pointerTrailBuffers) pointerTrailBuffer.destroy();
				uniformBuffer.destroy();
			},
		};
	},
});
</script>

<script lang="ts" setup>
import { onBeforeUnmount, onMounted, useTemplateRef } from 'vue';

const canvas = useTemplateRef('canvas');

let dispose: (() => void) | null = null;

const pixelRatio = 1;
const fps: number | null = null;

onMounted(async () => {
	if (canvas.value == null) return;

	const adapter = await navigator.gpu?.requestAdapter({
		powerPreference: 'low-power',
	});
	const _device = await adapter?.requestDevice();
	if (_device == null) return;
	const device = _device as GPUDevice;

	const _context = canvas.value.getContext('webgpu');
	if (_context == null) return;
	const context = _context as GPUCanvasContext;

	canvas.value.width = Math.max(1, Math.min(canvas.value.offsetWidth * pixelRatio, device.limits.maxTextureDimension2D));
	canvas.value.height = Math.max(1, Math.min(canvas.value.offsetHeight * pixelRatio, device.limits.maxTextureDimension2D));

	context.configure({
		device,
		format: navigator.gpu.getPreferredCanvasFormat(),
		alphaMode: 'premultiplied',
	});

	const sampler = device.createSampler({
		magFilter: 'linear',
		minFilter: 'linear',
		mipmapFilter: 'linear',
		addressModeU: 'mirror-repeat',
		addressModeV: 'mirror-repeat',
		addressModeW: 'mirror-repeat',
	});

	const defaultVertexShaderModule = device.createShaderModule({
		code: `struct VertexOut {
	@builtin(position) position: vec4f,
	@location(0) uv: vec2f,
};

const vertices = array(
	// 1st triangle
	vec2f(-1.0, -1.0),  // center
	vec2f( 1.0, -1.0),  // right, center
	vec2f(-1.0,  1.0),  // center, top

	// 2st triangle
	vec2f(-1.0,  1.0),  // center, top
	vec2f( 1.0, -1.0),  // right, center
	vec2f( 1.0,  1.0),  // right, top
);

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
	let pos = vertices[vertexIndex];
	var output: VertexOut;
	output.position = vec4f(pos, 0.0, 1.0);
	output.uv = pos.xy;
	return output;
}`,
	});

	const initialTime = (Date.now() % (1000 * 60 * 60 * 24));

	const bgRendererInstance = await defaultBgRendererDef.init({
		width: canvas.value.width,
		height: canvas.value.height,
		wgpu: { device, context, sampler, defaultVertexShaderModule },
		canvas: canvas.value,
	});

	let disposed = false;
	let latestTimestamp = performance.now();
	let time = initialTime;

	const createPassEncoder = (commandEncoder: GPUCommandEncoder, descriptor?: GPURenderPassDescriptor) => {
		const _descriptor = descriptor ?? {
			colorAttachments: [{
				view: context.getCurrentTexture().createView(),
				clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
				loadOp: 'clear',
				storeOp: 'store',
			}],
		} satisfies GPURenderPassDescriptor;
		return commandEncoder.beginRenderPass(_descriptor);
	};

	function render(timeStamp: number) {
		if (disposed) return;
		const timeDelta = timeStamp - latestTimestamp;
		time += Math.floor(timeDelta);
		const commandEncoder = device.createCommandEncoder();
		bgRendererInstance.render({
			commandEncoder,
			createPassEncoder,
			time: time,
			timeDelta: timeDelta,
		});
		device.queue.submit([commandEncoder.finish()]);
		latestTimestamp = timeStamp;
	}

	let then = 0;
	const interval = 1000 / (fps ?? 30);

	function renderLoop(timeStamp: number) {
		if (disposed) return;

		window.requestAnimationFrame(renderLoop);

		if (fps != null) {
			const delta = timeStamp - then;
			if (delta <= interval) return;
			then = timeStamp - (delta % interval);
		}

		render(timeStamp);
	}

	window.requestAnimationFrame(renderLoop);

	dispose = () => {
		disposed = true;
		device.destroy();
		context.unconfigure();
		bgRendererInstance.dispose?.();
	};
});

onBeforeUnmount(() => {
	if (dispose != null) dispose();
});
</script>

<style module>
.canvas {
	position: relative;
	display: block;
	width: 100%;
	height: 100%;
}
</style>
