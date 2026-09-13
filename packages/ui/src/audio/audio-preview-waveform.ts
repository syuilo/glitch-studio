import type { AudioHistory } from '@glitch/shared/audio-history.ts';
import type { MonitorSettings } from './audio-preview-types.ts';

export function createPreviewWaveform(device: GPUDevice) {
	const columns = 2048;
	const samples = new Float32Array(columns * 4);
	const buffer = device.createBuffer({ size: samples.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
	const uniform = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const params = new Float32Array(4);
	const shader = device.createShaderModule({ code: `
struct Params { columns: f32, overlay: f32, height: f32, padding: f32 };
@group(0) @binding(0) var<storage, read> ranges: array<vec2f>;
@group(0) @binding(1) var<uniform> p: Params;
struct Vertex { @builtin(position) position: vec4f, @location(0) color: vec4f };
@vertex fn vs(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> Vertex {
	let count = u32(p.columns);
	let side = instance / count;
	let column = instance % count;
	let corners = array(vec2f(0, 0), vec2f(1, 0), vec2f(0, 1), vec2f(0, 1), vec2f(1, 0), vec2f(1, 1));
	let corner = corners[vertex];
	let range = ranges[side * 2048u + column];
	let lanes = select(2.0, 1.0, p.overlay > 0.0);
	let lane = select(f32(side), 0.0, p.overlay > 0.0);
	let center = (lane + 0.5) / lanes;
	let halfPixel = 0.5 / max(1.0, p.height);
	let top = center - clamp(range.y, -1.0, 1.0) * 0.45 / lanes - halfPixel;
	let bottom = center - clamp(range.x, -1.0, 1.0) * 0.45 / lanes + halfPixel;
	let x = (f32(column) + corner.x) / p.columns;
	let y = mix(top, bottom, corner.y);
	let alpha = select(1.0, 0.5, p.overlay > 0.0);
	let color = select(vec3f(1, 0.51765, 0), vec3f(0.76078, 0.99608, 0.04706), side == 1u);
	return Vertex(vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0, 1), vec4f(color, alpha));
}
@fragment fn fs(input: Vertex) -> @location(0) vec4f { return input.color; }
` });
	const pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module: shader },
		fragment: { module: shader, targets: [{ format: navigator.gpu.getPreferredCanvasFormat(), blend: {
			color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
			alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
		} }] }, primitive: { topology: 'triangle-list' } });
	const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
		{ binding: 0, resource: { buffer } }, { binding: 1, resource: { buffer: uniform } },
	] });
	return {
		render(history: AudioHistory | null, settings: MonitorSettings, pass: GPURenderPassEncoder, width: number, height: number) {
			const count = Math.max(2, Math.min(columns, Math.floor(width)));
			const frames = Math.max(2, Math.min(32768, Math.round((history?.sampleRate ?? 48000) * settings.waveformSeconds)));
			const start = (history?.endFrame ?? 0) - frames;
			for (let side = 0; side < 2; side++) {
				for (let x = 0; x < count; x++) {
					const from = Math.floor(x * frames / count);
					const to = Math.min(frames, Math.max(from + 1, Math.floor((x + 1) * frames / count)));
					let min = Infinity;
					let max = -Infinity;
					for (let i = from; i < to; i++) {
						const value = history?.sample(start + i, side === 0 ? 'left' : 'right') ?? 0;
						min = Math.min(min, value);
						max = Math.max(max, value);
					}
					samples[(side * columns + x) * 2] = min;
					samples[(side * columns + x) * 2 + 1] = max;
				}
			}
			device.queue.writeBuffer(buffer, 0, samples);
			params.set([count, Number(settings.overlay), height, 0]);
			device.queue.writeBuffer(uniform, 0, params);
			pass.setPipeline(pipeline);
			pass.setBindGroup(0, group);
			pass.draw(6, count * 2);
		},
		dispose() { buffer.destroy(); uniform.destroy(); },
	};
}
