@group(0) @binding(1) var<storage, read_write> reconstructed: array<ReconstructedSample>;

var<workgroup> baseSamples: array<vec3f, 64>;
var<workgroup> donorSamples: array<vec3f, 64>;
var<workgroup> baseHorizontal: array<vec3f, 64>;
var<workgroup> donorHorizontal: array<vec3f, 64>;
var<workgroup> basis: array<f32, 64>;

fn capture_color(pixel: vec2u, grid: vec2u, donor: bool) -> vec4f {
	var color = vec4f(0.0);
	for (var y = 0u; y < grid.y; y++) {
		for (var x = 0u; x < grid.x; x++) {
			let offset = (vec2f(f32(x), f32(y)) + 0.5) / vec2f(grid);
			// DCTの端の不足サンプルは画像の端を延長する。入力自体のfit/wrap/filterは生成参照関数に任せる。
			let imagePosition = clamp((vec2f(pixel) + offset) / uniforms.virtualSize, vec2f(0.0), vec2f(1.0));
			let position = imagePosition * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0);
			if (donor) {
				color += read_donor(position + uniforms.donorOffset);
			} else {
				color += read_input(position);
			}
		}
	}
	// premultiplied RGBAを平均した後で除算し、透明画素の黒が周囲の色へ混ざることを避ける。
	var rgb = vec3f(0.0);
	if (color.a > 0.0) { rgb = color.rgb / color.a; }
	let coverage = clamp(color.a / f32(grid.x * grid.y), 0.0, 1.0);
	return vec4f(rgb, coverage);
}

@compute @workgroup_size(8, 8)
fn transplant(@builtin(workgroup_id) group: vec3u, @builtin(local_invocation_id) local: vec3u) {
	let index = local.y * 8u + local.x;
	let block = group.y * uniforms.blockColumns + group.x;
	let outputIndex = block * 64u + index;
	let pixel = group.xy * 8u + local.xy;
	let baseColor = capture_color(pixel, uniforms.inputSamplingGrid, false);
	let donorColor = capture_color(pixel, uniforms.donorSamplingGrid, true);
	let base = rgb_to_components(baseColor.rgb);
	// Donorの透明部分は移植しない。未接続の透明な定数入力でも元の係数を保ち、
	// Donor gainを変えても透明部分だけが暗くなったり、細部が消えたりしないようにする。
	baseSamples[index] = base;
	donorSamples[index] = mix(base, rgb_to_components(donorColor.rgb) * uniforms.donorGain, donorColor.a);
	basis[index] = dct_basis(local.x, local.y);
	reconstructed[outputIndex].base = vec4f(base, 0.0);
	workgroupBarrier();

	var baseValue = vec3f(0.0);
	var donorValue = vec3f(0.0);
	for (var x = 0u; x < 8u; x++) {
		let weight = basis[x * 8u + local.x];
		baseValue += baseSamples[local.y * 8u + x] * weight;
		donorValue += donorSamples[local.y * 8u + x] * weight;
	}
	baseHorizontal[index] = baseValue;
	donorHorizontal[index] = donorValue;
	workgroupBarrier();

	baseValue = vec3f(0.0);
	donorValue = vec3f(0.0);
	for (var y = 0u; y < 8u; y++) {
		let weight = basis[y * 8u + local.y];
		baseValue += baseHorizontal[y * 8u + local.x] * weight;
		donorValue += donorHorizontal[y * 8u + local.x] * weight;
	}
	// 選択帯域で係数を置き換えた結果と元画像の差分だけを逆変換する。
	// これにより細部保持時の元画像をぼかさず、係数・差分も画像の値域へ飽和させずに扱える。
	baseSamples[index] = (donorValue - baseValue) * frequency_weight(local.xy);
	workgroupBarrier();

	var difference = vec3f(0.0);
	for (var x = 0u; x < 8u; x++) { difference += baseSamples[local.y * 8u + x] * basis[local.x * 8u + x]; }
	baseHorizontal[index] = difference;
	workgroupBarrier();
	difference = vec3f(0.0);
	for (var y = 0u; y < 8u; y++) { difference += baseHorizontal[y * 8u + local.x] * basis[local.y * 8u + y]; }
	reconstructed[outputIndex].difference = vec4f(difference, 0.0);
}
