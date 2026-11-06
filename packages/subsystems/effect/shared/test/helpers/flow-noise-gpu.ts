import flowNoiseCode from '../../src/fx/fractalNoise/flow-noise.wgsl?raw';

export async function verifyFlowNoiseKernel(device: GPUDevice) {
	// 【PSRDの解析勾配はXYZの有限差分と一致する】
	// 段間のワープは値の見た目だけでは誤りを発見しにくいため、負の座標・
	// 四面体の境界・回転中の位相を含めて、評価関数の勾配を独立に確認する。
	const sampleCount = 6;
	const output = device.createBuffer({ size: sampleCount * 2 * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
	const readback = device.createBuffer({ size: output.size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
	try {
		const pipeline = device.createComputePipeline({
			layout: 'auto',
			compute: { module: device.createShaderModule({ code: flowNoiseCode + `
@group(0) @binding(0) var<storage, read_write> samples: array<vec4f>;
@compute @workgroup_size(1)
fn verify(@builtin(global_invocation_id) invocation: vec3u) {
	const positions = array(vec4f(0, 0, 0, 0), vec4f(0, 0, 0, 0.25),
		vec4f(0.31, 0.57, -0.49, 0.13), vec4f(-1.2, 2.7, 0.42, 0.37),
		vec4f(0.5, 0.5, 0.5, 0.61), vec4f(-0.001, 0.999, 1.001, 0.91));
	let position = positions[invocation.x].xyz;
	let phase = positions[invocation.x].w * 6.283185307179586;
	let rotation = vec2f(cos(phase), sin(phase));
	let evaluated = flowNoise(position, rotation);
	let stepX = vec3f(0.001, 0, 0);
	let stepY = vec3f(0, 0.001, 0);
	let stepZ = vec3f(0, 0, 0.001);
	let difference = vec3f(
		flowNoise(position + stepX, rotation).value - flowNoise(position - stepX, rotation).value,
		flowNoise(position + stepY, rotation).value - flowNoise(position - stepY, rotation).value,
		flowNoise(position + stepZ, rotation).value - flowNoise(position - stepZ, rotation).value) / 0.002;
	samples[invocation.x * 2u] = vec4f(evaluated.value, evaluated.gradient);
	samples[invocation.x * 2u + 1u] = vec4f(0, difference);
}` }), entryPoint: 'verify' },
		});
		const encoder = device.createCommandEncoder();
		const pass = encoder.beginComputePass();
		pass.setPipeline(pipeline);
		pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: output } }] }));
		pass.dispatchWorkgroups(sampleCount);
		pass.end();
		encoder.copyBufferToBuffer(output, 0, readback, 0, output.size);
		device.queue.submit([encoder.finish()]);
		await readback.mapAsync(GPUMapMode.READ);
		const actual = new Float32Array(readback.getMappedRange().slice(0));
		readback.unmap();
		const near = (value: number, expected: number, label: string) => {
			if (!Number.isFinite(value) || Math.abs(value - expected) > 0.004) throw new Error(`Flow Noise ${label}: ${value} != ${expected}`);
		};
		for (let index = 0; index < sampleCount; index++) {
			for (let axis = 1; axis <= 3; axis++) near(actual[index * 8 + axis], actual[index * 8 + 4 + axis], `analytic gradient ${index}/${axis}`);
		}
		// 【原点での値と勾配はPSRDの既知の格子点に一致する】
		// 有限差分との比較だけでは、値と勾配の両方を同じ倍率で誤った場合を検出できない。
		// 原点のhashは0で、四面体の他の頂点の寄与は0になるため、基準値を直接比較できる。
		near(actual[0], 0, 'origin value');
		near(actual[1], 4.9375 * Math.sqrt(1 - 0.996539792 ** 2), 'origin gradient X');
		near(actual[2], 0, 'origin gradient Y');
		near(actual[3], 4.9375 * 0.996539792, 'origin gradient Z');
		near(actual[8], 0, 'quarter turn origin value');
		near(actual[9], 0, 'quarter turn gradient X');
		near(actual[10], 4.9375, 'quarter turn gradient Y');
		near(actual[11], 0, 'quarter turn gradient Z');
		return ['Flow Noise analytic XYZ gradients', 'Flow Noise PSRD reference lattice'];
	} finally {
		output.destroy();
		readback.destroy();
	}
}
