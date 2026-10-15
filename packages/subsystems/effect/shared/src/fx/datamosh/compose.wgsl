@group(0) @binding(1) var historySampler: sampler;
@group(0) @binding(2) var history: texture_2d<f32>;
@group(0) @binding(3) var flow: texture_2d<f32>;
@group(0) @binding(4) var flowSampler: sampler;

struct FragmentOutput {
	@location(0) color: vec4f,
	@location(1) history: vec4f,
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

fn block_random(cell: vec2u) -> f32 {
	let key = (cell.x * 0x9e3779b9u) ^ (cell.y * 0x85ebca6bu) ^ uniforms.seed ^ hash32(uniforms.frameIndex);
	return f32(hash32(key) >> 8u) / 16777216.0;
}

fn sample_history(uv: vec2f) -> vec4f {
	var color = textureSampleLevel(history, historySampler, uv, 0.0);
	if (uniforms.historyTransparent != 0u) {
		// 透明な範囲外との線形補間をRGBA全体へ適用し、輪郭でpremultiplied alphaを保つ。
		let coverage = clamp(min(uv, 1.0 - uv) * vec2f(textureDimensions(history)) + 0.5, vec2f(0.0), vec2f(1.0));
		color *= coverage.x * coverage.y;
	}
	return color;
}

@fragment
fn compose(@location(0) position: vec2f) -> FragmentOutput {
	let current = read_input(position);
	var color = current;
	if (uniforms.reset == 0u) {
		let uv = texture_position(position);
		let gridPosition = grid_position(uv);
		let cell = vec2u(floor(gridPosition));
		var velocity = vec2f(0.0);
		if (uniforms.blockyMotion != 0u) {
			// ブロック境界を保つモードでは、動きベクトルを隣のブロックと混ぜない。
			let point = clamp(vec2i(cell), vec2i(0), vec2i(textureDimensions(flow)) - 1);
			velocity = textureLoad(flow, point, 0).rg;
		} else {
			// 端のブロックは画面外にはみ出すため、配置原点と実際のブロック寸法を反映する。
			let flowPosition = gridPosition / vec2f(textureDimensions(flow));
			velocity = textureSampleLevel(flow, flowSampler, flowPosition, 0.0).rg;
		}
		let warped = sample_history(uv + velocity * uniforms.seconds * uniforms.motionStrength);
		let mask = clamp(read_recoveryMask(position), 0.0, 1.0);
		// 連続した復帰とブロック単位の置き換えを分ける。確率を秒数から求め、
		// フレームレートを変えても、単位時間に更新される量が大きく変わらないようにする。
		var recovery = 1.0 - exp(-uniforms.recoveryRate * mask * uniforms.seconds);
		let refreshProbability = 1.0 - exp(-uniforms.blockRefreshRate * mask * uniforms.seconds);
		if (block_random(cell) < refreshProbability) { recovery = 1.0; }
		// 入力と履歴はどちらもpremultiplied RGBA。alphaも含めて補間し、再乗算はしない。
		color = mix(warped, current, recovery);
	}
	if (color.a <= 0.0) { color = vec4f(0.0); }
	// 表示と浮動小数点の履歴へ同時に出力し、画像形式の量子化誤差を履歴へ繰り返し蓄積しない。
	return FragmentOutput(color, color);
}
