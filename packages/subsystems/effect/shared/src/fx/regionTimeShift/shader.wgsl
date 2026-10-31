struct Uniforms {
	resolution: vec2f,
	amount: f32,
	maxDelay: f32,
	referenceLength: f32,
	regionLayout: u32,
	newestLayer: u32,
	layerCount: u32,
	frameCount: u32,
	interpolate: u32,
	channelSplit: u32,
	seed: u32,
	phase: u32,
	// uniformの配列は16byte境界へ揃える。1 vec4に4枚分の実際の経過秒数を格納する。
	historyAges: array<vec4f, 16>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var historyFrames: texture_2d_array<f32>;
@group(0) @binding(2) var historySampler: sampler;

struct FragmentIn {
	@location(0) uv: vec2f,
};

fn hash32(value: u32) -> u32 {
	var result = value;
	result ^= result >> 16u;
	result *= 0x7feb352du;
	result ^= result >> 15u;
	result *= 0x846ca68bu;
	result ^= result >> 16u;
	return result;
}

fn random(cell: vec2i, salt: u32) -> f32 {
	let cellHash = (bitcast<u32>(cell.x) * 0x9e3779b9u) ^ (bitcast<u32>(cell.y) * 0x85ebca6bu);
	let value = hash32(cellHash ^ uniforms.seed ^ hash32(uniforms.phase) ^ (salt * 0xc2b2ae35u));
	return f32(value >> 8u) / 16777216.0;
}

fn sample_history(position: vec2f, layer: u32) -> vec4f {
	let uv = position * vec2f(0.5, -0.5) + 0.5;
	// 領域・時刻ごとに異なる分岐から呼ぶため、暗黙の微分に依存しないLOD指定を使う。
	return textureSampleLevel(historyFrames, historySampler, uv, i32(layer), 0.0);
}

fn delayed_color(position: vec2f, delay: f32, current: vec4f) -> vec4f {
	if (delay <= 0.0 || uniforms.frameCount == 0u) { return current; }
	// 現在の入力も時刻0の候補にする。保存間隔より短い遅延で直近の入力を参照できる。
	var newerLayer = uniforms.layerCount;
	var newerAge = 0.0;
	for (var i = 0u; i < uniforms.frameCount; i++) {
		let layer = (uniforms.newestLayer + uniforms.layerCount - i) % uniforms.layerCount;
		let age = uniforms.historyAges[layer / 4u][layer % 4u];
		if (age >= delay) {
			var newer = current;
			if (newerLayer != uniforms.layerCount) { newer = sample_history(position, newerLayer); }
			if (uniforms.interpolate == 0u) {
				// 実際の時刻に最も近いフレームを選び、描画FPSの違いで遅延秒数が変わることを避ける。
				if (delay - newerAge < age - delay) { return newer; }
				return sample_history(position, layer);
			}
			let weight = clamp((delay - newerAge) / max(age - newerAge, 0.000001), 0.0, 1.0);
			// RGBA全体を補間するため、半透明の輪郭でも二重のpremultiplyを生じない。
			return mix(newer, sample_history(position, layer), weight);
		}
		newerLayer = layer;
		newerAge = age;
	}
	// 起動直後や描画が追い付かない場合は、存在しない過去を透明にせず最古の保存画像を使う。
	return sample_history(position, newerLayer);
}

@fragment
fn fs(fragment: FragmentIn) -> @location(0) vec4f {
	let current = read_input(fragment.uv);
	if (uniforms.amount <= 0.0 || uniforms.maxDelay <= 0.0) { return current; }
	let density = max(read_density(fragment.uv), vec2f(1.0));
	let extent = vec2f(uniforms.referenceLength);
	// 領域サイズは画素数に固定せず、画面全体に対する密度とfitで決める。
	let cellSize = 2.0 * (extent / uniforms.resolution) / density;
	var cell = vec2i(round(fragment.uv / cellSize));
	if (uniforms.regionLayout == 1u) { cell.x = 0; }
	if (uniforms.regionLayout == 2u) { cell.y = 0; }
	if (random(cell, 0u) >= uniforms.amount) { return current; }
	let red = delayed_color(fragment.uv, random(cell, 1u) * uniforms.maxDelay, current);
	if (uniforms.channelSplit == 0u) { return red; }
	let green = delayed_color(fragment.uv, random(cell, 2u) * uniforms.maxDelay, current);
	let blue = delayed_color(fragment.uv, random(cell, 3u) * uniforms.maxDelay, current);
	// 各時刻のチャンネルはすでにpremultiplied。最大のalphaを使えば、異なる時刻の
	// 輪郭を隠さず、RGBを再乗算して暗くすることもなく、有効な乗算済みの色を保てる。
	return vec4f(red.r, green.g, blue.b, max(red.a, max(green.a, blue.a)));
}
