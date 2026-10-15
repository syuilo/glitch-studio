@group(0) @binding(1) var<storage, read> coefficients: array<f32>;
@group(0) @binding(2) var<storage, read> scanStates: array<ScanState>;
@group(0) @binding(3) var<storage, read_write> decoded: array<f32>;

var<workgroup> spectrum: array<f32, 64>;
var<workgroup> horizontal: array<f32, 64>;
var<workgroup> basis: array<f32, 64>;

fn corrupt_ac(value: f32, block: u32, sourceBlock: u32, frequency: u32, component: u32) -> f32 {
	if (uniforms.acEnabled == 0u || frequency == 0u || uniforms.acStrength == 0.0) { return value; }
	if (random(block, 20u) >= uniforms.acProbability) { return value; }
	var rank = 1u;
	for (var i = 1u; i < 64u; i++) { if (ZIGZAG[i] == frequency) { rank = i; break; } }
	if (rank < uniforms.acMinFrequency || rank > uniforms.acMaxFrequency) { return value; }
	if (random(block, 100u + rank) >= uniforms.acCoefficientProbability) { return value; }
	var mode = uniforms.acMode;
	if (mode == 0u) { mode = 1u + u32(random(block, 200u + rank) * 4.0); }
	var damaged = value;
	switch mode {
		case 1u: { damaged = 0.0; }
		case 2u: { damaged = -value; }
		case 3u: {
			// 0だった係数にも非ゼロの誤りを作り、平坦な画像でも縞・格子の破損を表現できるようにする。
			let noise = (random(block, 300u + rank) * 2.0 - 1.0) * 128.0 / quantization_step(frequency, component);
			damaged = value * 17.0 + noise;
			if (uniforms.quantization != 0u) { damaged = round(damaged); }
		}
		case 4u: {
			// DCを除く63係数のジグザグ列を循環させる。読み取り元は未加工のバッファなので、
			// 同じworkgroup内の実行順序や他の係数の破損に影響されない。
			let sourceRank = 1u + (rank - 1u + uniforms.acFrequencyShift) % 63u;
			damaged = coefficients[sourceBlock * 64u + ZIGZAG[sourceRank]];
		}
		default: {}
	}
	let result = mix(value, damaged, uniforms.acStrength);
	if (uniforms.quantization != 0u) { return round(result); }
	return result;
}

@compute @workgroup_size(8, 8)
fn decode(@builtin(workgroup_id) group: vec3u, @builtin(local_invocation_id) local: vec3u) {
	let component = block_component(group.z);
	let block = (group.y * uniforms.mcuColumns + group.x) * uniforms.blocksPerMcu + group.z;
	let state = scanStates[block];
	let index = local.y * 8u + local.x;
	let source = coefficients[state.sourceBlock * 64u + index];
	var value = corrupt_ac(source, block, state.sourceBlock, index, component) * quantization_step(index, component);
	if (index == 0u) { value += state.dcError; }
	spectrum[index] = value;
	basis[index] = dct_basis(local.x, local.y);
	workgroupBarrier();

	// 正変換の基底を転置し、横・縦の順に逆変換する。1ブロックの64画素で中間値を共有する。
	value = 0.0;
	for (var x = 0u; x < 8u; x++) { value += spectrum[local.y * 8u + x] * basis[local.x * 8u + x]; }
	horizontal[index] = value;
	workgroupBarrier();
	value = 0.0;
	for (var y = 0u; y < 8u; y++) { value += horizontal[y * 8u + local.x] * basis[local.y * 8u + y]; }
	// JPEG復号の成分値として飽和させる。色差は0を中心に保持し、RGBへの変換は最後に行う。
	let levelShift = select(0.0, 128.0, component == 0u);
	let minimum = select(-128.0, 0.0, component == 0u);
	let maximum = select(127.0, 255.0, component == 0u);
	var componentValue = value + levelShift;
	if (uniforms.quantization != 0u) { componentValue = round(componentValue); }
	decoded[block * 64u + index] = clamp(componentValue, minimum, maximum) / 255.0;
}
