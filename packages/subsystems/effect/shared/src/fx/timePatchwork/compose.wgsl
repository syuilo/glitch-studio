@group(0) @binding(1) var historyFrames: texture_2d_array<f32>;
@group(0) @binding(2) var historySampler: sampler;
@group(0) @binding(3) var blocks: texture_2d<f32>;
@group(0) @binding(4) var previousPatchwork: texture_2d<f32>;

struct FragmentIn {
	@location(0) position: vec2f,
	@builtin(position) screenPosition: vec4f,
};

struct FragmentOutput {
	@location(0) color: vec4f,
	@location(1) patchwork: vec4f,
};

fn sample_history(uv: vec2f, layer: u32) -> vec4f {
	return textureSampleLevel(historyFrames, historySampler, uv, i32(layer), 0.0);
}

fn delayed_color(uv: vec2f, delay: f32, current: vec4f) -> vec4f {
	if (delay <= 0.0 || uniforms.frameCount == 0u) { return current; }
	// 現在の入力も経過時間0の候補に含める。描画FPSではなく実際の保存時刻で選び、
	// 履歴の保存間隔より短い遅延にも現在の入力との補間・近傍選択で対応する。
	var newerLayer = uniforms.layerCount;
	var newerAge = 0.0;
	for (var i = 0u; i < uniforms.frameCount; i++) {
		let layer = (uniforms.newestLayer + uniforms.layerCount - i) % uniforms.layerCount;
		let age = uniforms.historyAges[layer / 4u][layer % 4u];
		if (age >= delay) {
			var newer = current;
			if (newerLayer != uniforms.layerCount) { newer = sample_history(uv, newerLayer); }
			if (uniforms.interpolate == 0u) {
				if (delay - newerAge < age - delay) { return newer; }
				return sample_history(uv, layer);
			}
			let weight = clamp((delay - newerAge) / max(0.000001, age - newerAge), 0.0, 1.0);
			return mix(newer, sample_history(uv, layer), weight);
		}
		newerLayer = layer;
		newerAge = age;
	}
	// 履歴がまだ十分に溜まっていない場合は、保存済みの最古の画像へ制限する。
	return sample_history(uv, newerLayer);
}

@fragment
fn compose(fragment: FragmentIn) -> FragmentOutput {
	let uv = image_position(fragment.position);
	let cell = vec2i(floor((uv - uniforms.gridOrigin) / uniforms.blockSize));
	// 停止状態はブロックごとの離散データなので、隣接ブロックを混ぜない。
	let block = textureLoad(blocks, clamp(cell, vec2i(0), vec2i(textureDimensions(blocks)) - 1), 0);
	let current = read_input(fragment.position);
	var patchwork = current;
	if (block.w > 0.5) {
		// リングの保存先が一周しても停止中の絵が変わらないよう、前回表示した画像を使う。
		// 同じ解像度の同一画素を厳密に読むことで、保持するたびに補間でぼけることも避ける。
		patchwork = textureLoad(previousPatchwork, vec2i(fragment.screenPosition.xy), 0);
	} else {
		patchwork = delayed_color(uv, block.x, current);
	}
	if (patchwork.a <= 0.0) { patchwork = vec4f(0.0); }
	// Amountは表示への合成だけに適用し、停止画像のキャッシュへ入力を混ぜ続けない。
	// どちらもpremultiplied RGBAなので、全チャンネルをまとめて補間して返す。
	return FragmentOutput(mix(current, patchwork, uniforms.amount), patchwork);
}
