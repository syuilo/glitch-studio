import code from '../../src/fx/mandelbrot/extended-precision.wgsl?raw';
import { packMandelbrotFixedPoint, packMandelbrotNumber, writeMandelbrotReal } from '../../src/fx/mandelbrot/extended-precision.ts';
import type { MandelbrotReal } from '../../src/fx/mandelbrot/extended-precision.ts';

// 【48bit演算のcarry・相殺・指数合わせ・偶数丸めを、BigIntの厳密な演算と比較する】
// フラクタル画像だけでは見つからない1ulpの誤りを、符号と指数差を固定した再現可能な入力で検出する。
export async function verifyMandelbrotArithmetic(device: GPUDevice): Promise<string> {
	const cases: [MandelbrotReal, MandelbrotReal][] = [];
	const constants = [0, 1, -1, 0.5, -0.5, 1e-300, -1e-300, 1e300, 1 + 2 ** -47, 1 - 2 ** -48].map(packMandelbrotNumber);
	for (const first of constants) for (const second of constants) cases.push([first, second]);
	let randomState = 0x6d616e64;
	const random = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState; };
	for (const difference of [0, 1, 7, 8, 9, 16, 24, 47, 48, 49, 56, 64, 80, 1024]) {
		for (let index = 0; index < 32; index++) {
			const first: MandelbrotReal = { significand: [random(), 0x8000 | (random() & 0x7fff)], exponent: Number(random() % 2000) - 1000, negative: random() & 1 };
			const second: MandelbrotReal = { significand: [random(), 0x8000 | (random() & 0x7fff)], exponent: first.exponent - difference, negative: random() & 1 };
			cases.push([first, second]);
			cases.push([first, { ...first, negative: first.negative ^ 1 }]);
		}
	}
	const data = new Uint32Array(cases.length * 8);
	const expected = new Uint32Array(data.length);
	const signedSignificand = (value: MandelbrotReal) => ((BigInt(value.significand[1]) << 32n) + BigInt(value.significand[0])) * (value.negative === 0 ? 1n : -1n);
	cases.forEach(([first, second], index) => {
		writeMandelbrotReal(data, index * 8, first); writeMandelbrotReal(data, index * 8 + 4, second);
		const exponent = Math.min(first.exponent, second.exponent);
		const exactSum = (signedSignificand(first) << BigInt(first.exponent - exponent)) + (signedSignificand(second) << BigInt(second.exponent - exponent));
		writeMandelbrotReal(expected, index * 8, packMandelbrotFixedPoint(exactSum, 48 - exponent));
		writeMandelbrotReal(expected, index * 8 + 4, packMandelbrotFixedPoint(signedSignificand(first) * signedSignificand(second), 96 - first.exponent - second.exponent));
	});
	const input = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
	const output = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
	const readback = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
	try {
		device.pushErrorScope('validation');
		device.queue.writeBuffer(input, 0, data);
		const module = device.createShaderModule({ code: code + `
@group(0) @binding(0) var<storage, read> inputs: array<MandelbrotReal>;
@group(0) @binding(1) var<storage, read_write> outputs: array<MandelbrotReal>;
@compute @workgroup_size(64) fn cs(@builtin(global_invocation_id) index: vec3u) {
  let offset = index.x * 2u;
  if (offset >= arrayLength(&inputs)) { return; }
  outputs[offset] = addReal(inputs[offset], inputs[offset + 1u]);
  outputs[offset + 1u] = multiplyReal(inputs[offset], inputs[offset + 1u]);
}` });
		const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module } });
		const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: input } }, { binding: 1, resource: { buffer: output } }] });
		const encoder = device.createCommandEncoder();
		const pass = encoder.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(Math.ceil(cases.length / 64)); pass.end();
		encoder.copyBufferToBuffer(output, 0, readback, 0, data.byteLength); device.queue.submit([encoder.finish()]);
		await readback.mapAsync(GPUMapMode.READ);
		const actual = new Uint32Array(readback.getMappedRange().slice(0)); readback.unmap();
		const error = await device.popErrorScope();
		if (error != null) throw new Error(error.message);
		for (let index = 0; index < actual.length; index++) {
			if (actual[index] !== expected[index]) throw new Error(`48-bit ${index % 8 < 4 ? 'addition' : 'multiplication'} case ${Math.floor(index / 8)} word ${index % 4}: ${actual[index]} != ${expected[index]}; ${JSON.stringify(cases[Math.floor(index / 8)])}`);
		}
		return `${cases.length * 2} exact 48-bit arithmetic cases`;
	} finally { input.destroy(); output.destroy(); readback.destroy(); }
}
