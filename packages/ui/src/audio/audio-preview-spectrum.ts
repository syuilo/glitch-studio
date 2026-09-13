import { AudioSpectrum } from '@glitch/shared/utility/audio-spectrum.ts';
import type { AudioHistory } from '@glitch/shared/audio-history.ts';
import type { MonitorSettings } from './audio-preview-types.ts';

export function createPreviewSpectrum(device: GPUDevice) {
	const columns = 2048;
	const spectrum = new AudioSpectrum(4096, 'blackman');
	// 従来の60Hz・係数0.75に相当する時定数（秒）。実際の描画FPSには依存しない。
	const smoothingSeconds = -1 / (60 * Math.log(0.75));
	const levels = new Float32Array(columns * 2);
	const buffer = device.createBuffer({ size: levels.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
	const uniform = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const params = new Float32Array(4);
	const shader = device.createShaderModule({ code: `
struct Params { columns: f32, overlay: f32, padding: vec2f };
@group(0) @binding(0) var<storage, read> levels: array<f32>;
@group(0) @binding(1) var<uniform> p: Params;
struct Vertex { @builtin(position) position: vec4f, @location(0) color: vec4f };
@vertex fn vs(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> Vertex {
	let count = u32(p.columns);
	let side = instance / (count - 1u);
	let column = instance % (count - 1u);
	let corners = array(vec2u(0, 0), vec2u(1, 0), vec2u(0, 1), vec2u(0, 1), vec2u(1, 0), vec2u(1, 1));
	let corner = corners[vertex];
	let index = column + corner.x;
	let lanes = select(2.0, 1.0, p.overlay > 0.0);
	let lane = select(f32(side), 0.0, p.overlay > 0.0);
	let level = levels[side * 2048u + index] * f32(corner.y);
	let y = (lane + 1.0 - level * 0.97) / lanes;
	let x = f32(index) / (p.columns - 1.0);
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
		render(history: AudioHistory | null, settings: MonitorSettings, pass: GPURenderPassEncoder, width: number) {
			spectrum.update(history, 'stereo', smoothingSeconds);
			const count = Math.max(2, Math.min(columns, Math.floor(width)));
			const rate = history?.sampleRate ?? 48000;
			const maxFrequency = Math.min(20000, rate / 2);
			for (let side = 0; side < 2; side++) {
				const values = side === 0 ? spectrum.left : spectrum.right;
				for (let x = 0; x < count; x++) {
					const from = 20 * (maxFrequency / 20) ** (x / count) * spectrum.size / rate;
					const to = 20 * (maxFrequency / 20) ** ((x + 1) / count) * spectrum.size / rate;
					let amplitude = 0;
					for (let bin = Math.floor(from); bin <= Math.min(values.length - 1, Math.floor(to)); bin++) amplitude = Math.max(amplitude, values[bin]);
					// AnalyserNodeと同じ表示スケールにする（Blackman窓の平均0.42、片側振幅の1/2）。
					const db = 20 * Math.log10(amplitude * 0.21);
					levels[side * columns + x] = Math.min(1, Math.max(0, (db + 90) / 90));
				}
			}
			device.queue.writeBuffer(buffer, 0, levels);
			params.set([count, Number(settings.overlay), 0, 0]);
			device.queue.writeBuffer(uniform, 0, params);
			pass.setPipeline(pipeline);
			pass.setBindGroup(0, group);
			pass.draw(6, (count - 1) * 2);
		},
		dispose() { buffer.destroy(); uniform.destroy(); },
	};
}
