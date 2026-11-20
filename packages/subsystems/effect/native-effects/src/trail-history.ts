import type { Resolution } from '@gs/shared/resolution.ts';

/** 使用ポートごとに2枚を交替し、独立したベクトル・強度の履歴をコピーせず公開する。 */
export function createTrailHistory(device: GPUDevice, resolution: Resolution, outputs: ReadonlyMap<string, GPUTexture>,
	publish: ReadonlyMap<string, (texture: GPUTexture) => void>, pipeline: GPURenderPipeline, uniformBuffer: GPUBuffer) {
	const ports = ['output', 'scalar'].map(id => {
		const output = outputs.get(id);
		if (output == null) return null;
		const alternate = device.createTexture({ size: resolution, format: output.format, usage: output.usage });
		return { textures: [output, alternate], views: [output.createView(), alternate.createView()], publish: publish.get(id)! };
	});
	const frames = [0, 1].map(index => {
		const previous = ports.map(port => port?.views[1 - index]);
		// 未使用側の読み取り口には使用側のviewを借用し、ダミーの履歴を確保しない。
		const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
			{ binding: 1, resource: { buffer: uniformBuffer } },
			{ binding: 2, resource: previous[0] ?? previous[1]! },
			{ binding: 3, resource: previous[1] ?? previous[0]! },
		] });
		const pass: GPURenderPassDescriptor = { colorAttachments: ports.map(port => port == null ? null : {
			view: port.views[index], loadOp: 'clear', storeOp: 'store',
		}) };
		return { group, pass };
	});
	let next = 0;
	let clearPrevious = false;
	return {
		draw(encoder: GPUCommandEncoder) {
			if (clearPrevious) encoder.beginRenderPass(frames[1 - next].pass).end();
			clearPrevious = false;
			const frame = frames[next];
			const pass = encoder.beginRenderPass(frame.pass);
			pass.setPipeline(pipeline);
			pass.setBindGroup(0, frame.group);
			pass.draw(3);
			pass.end();
			for (const port of ports) port?.publish(port.textures[next]);
			next = 1 - next;
		},
		reset() { clearPrevious = true; },
		dispose() { for (const port of ports) port?.textures[1].destroy(); },
	};
}
