@group(0) @binding(1) var<storage, read_write> decoded: array<f32>;
@group(0) @binding(2) var<storage, read_write> referenceSamples: array<f32>;

var<workgroup> samples: array<f32, 64>;
var<workgroup> horizontal: array<f32, 64>;
var<workgroup> basis: array<f32, 64>;
var<workgroup> blockQuality: f32;

fn capture_component(origin: vec2u, samplePosition: vec2u, stride: u32, component: u32) -> f32 {
	// 仮想サンプルの面積を分割して入力を平均する。色差ではstride=2として
	// 2×2の縮小も同時に行う。極端な縮小時の計算量は各軸16分割で制限する。
	let grid = min(uniforms.samplingGrid * stride, vec2u(16u));
	var color = vec4f(0.0);
	for (var y = 0u; y < grid.y; y++) {
		for (var x = 0u; x < grid.x; x++) {
			let localPosition = (vec2f(f32(x), f32(y)) + 0.5) / vec2f(grid);
			let pixel = vec2f(origin) + (vec2f(samplePosition) + localPosition) * f32(stride);
			// MCUに足りない領域は画像の端で埋め、接続自体のfit/wrapは参照関数へ任せる。
			let imagePosition = clamp(grid_to_image(pixel), vec2f(0.0), vec2f(1.0));
			color += read_input(imagePosition * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0));
		}
	}
	// premultiplied RGBAを平均してから除算し、透明画素の黒が色に混ざることを防ぐ。
	var rgb = vec3f(0.0);
	if (color.a > 0.0) { rgb = clamp(color.rgb / color.a, vec3f(0.0), vec3f(1.0)); }
	if (component == 0u) { return dot(rgb, vec3f(0.299, 0.587, 0.114)) * 255.0 - 128.0; }
	if (component == 1u) { return dot(rgb, vec3f(-0.168736, -0.331264, 0.5)) * 255.0; }
	return dot(rgb, vec3f(0.5, -0.418688, -0.081312)) * 255.0;
}

@compute @workgroup_size(8, 8)
fn compress(@builtin(workgroup_id) group: vec3u, @builtin(local_invocation_id) local: vec3u) {
	let slot = group.z;
	let component = block_component(slot);
	let index = local.y * 8u + local.x;
	var origin = group.xy * mcu_size();
	var stride = 1u;
	if (uniforms.subsample != 0u) {
		if (component == 0u) {
			origin += vec2u(slot % 2u, slot / 2u) * 8u;
		} else {
			stride = 2u;
		}
	}
	let block = (group.y * uniforms.mcuColumns + group.x) * uniforms.blocksPerMcu + slot;
	let captured = capture_component(origin, local.xy, stride, component);
	let levelShift = select(0.0, 128.0, component == 0u);
	if (uniforms.preserveDetails != 0u) {
		// DCT→IDCTだけなら入力サンプルへ戻るため、未圧縮の比較画像は変換前に保存できる。
		// 量子化前の整数化による誤差も圧縮差分に残すため、丸める前の値を使う。
		referenceSamples[block * 64u + index] = (captured + levelShift) / 255.0;
	}
	samples[index] = clamp(round(captured), -128.0, 127.0);
	basis[index] = dct_basis(local.x, local.y);
	if (index == 0u) {
		// 画像位置ごとのQualityをブロック中心で1回だけ評価し、全64係数で共有する。
		// 色差ブロックは覆う範囲が2倍になるため、その範囲の中心で評価する。
		let center = clamp(grid_to_image(vec2f(origin) + vec2f(4.0 * f32(stride))), vec2f(0.0), vec2f(1.0));
		let quality = clamp(read_quality(center * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0)), 0.0, 1.0);
		// ノード入力も固定値も0〜1で受け取り、量子化表の計算に使う整数1〜100へ変換する。
		// 0を1へ対応させるため除算は0にならず、既定の0.6は従来と同じQuality=60になる。
		blockQuality = round(1.0 + quality * 99.0);
	}
	workgroupBarrier();

	// 横・縦の順にDCTを分離し、各段階の結果を64 invocationで共有する。
	var value = 0.0;
	for (var x = 0u; x < 8u; x++) { value += samples[local.y * 8u + x] * basis[x * 8u + local.x]; }
	horizontal[index] = value;
	workgroupBarrier();
	value = 0.0;
	for (var y = 0u; y < 8u; y++) { value += horizontal[y * 8u + local.x] * basis[y * 8u + local.y]; }
	// 配置ずれや係数加工は行わないため、同じ場所で量子化・逆量子化を完結できる。
	// Qualityを読み直さず同じ幅を使い、空間入力でも符号化と復元を一致させる。
	let step = quantization_step(index, component, blockQuality);
	samples[index] = round(value / step) * step;
	workgroupBarrier();

	// 基底を転置してIDCTを行う。係数と中間結果はworkgroup内だけで保持する。
	value = 0.0;
	for (var x = 0u; x < 8u; x++) { value += samples[local.y * 8u + x] * basis[local.x * 8u + x]; }
	horizontal[index] = value;
	workgroupBarrier();
	value = 0.0;
	for (var y = 0u; y < 8u; y++) { value += horizontal[y * 8u + local.x] * basis[local.y * 8u + y]; }
	let minimum = select(-128.0, 0.0, component == 0u);
	let maximum = select(127.0, 255.0, component == 0u);
	decoded[block * 64u + index] = clamp(round(value + levelShift), minimum, maximum) / 255.0;
}
