fn blendOverlay(base: f32, blend: f32) -> f32 {
	if (base < 0.5) {
		return 2.0 * base * blend;
	}
	return 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
}

fn doBlend(mode: u32, base: f32, blend: f32) -> f32 {
	switch mode {
		case 1u: { return min(base + blend, 1.0); }
		case 2u: { return max(base + blend - 1.0, 0.0); }
		case 3u: { return base * blend; }
		case 6u: { return min(base, blend); }
		case 7u: { return max(base, blend); }
		case 8u: { return 1.0 - (1.0 - base) * (1.0 - blend); }
		case 9u: { return blendOverlay(base, blend); }
		default: { return blend; }
	}
}

struct Uniforms {
	blendMode: u32,
	leftSignal: vec3u,
	rightSignal: vec3u,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

// チャンネルごとに乗算済みの色とアルファを返す。未選択のチャンネルに元画像を残さない。
fn shiftChannel(left: vec2f, right: vec2f, useLeft: bool, useRight: bool) -> vec2f {
	if (!useLeft && !useRight) { return vec2f(0.0); }
	if (!useLeft) { return right; }
	if (!useRight) { return left; }
	if (left.y <= 0.0) { return right; }
	if (right.y <= 0.0) { return left; }

	// ブレンドは未乗算の色で計算し、重なり以外の部分も残す。
	// 透明なシフト先を黒としてmultiplyなどに混ぜると、もう一方の像が消えてしまう。
	let blended = doBlend(uniforms.blendMode, left.x / left.y, right.x / right.y);
	let color = left.x * (1.0 - right.y) + right.x * (1.0 - left.y) + blended * left.y * right.y;
	let alpha = left.y + right.y * (1.0 - left.y);
	return vec2f(color, alpha);
}

struct FragmentIn {
	@location(0) uv: vec2f,
};

@fragment
fn fs(fragData: FragmentIn) -> @location(0) vec4f {
	let uv = fragData.uv;
	let amount = read_amount(uv);
	let left = read_input(uv + amount);
	let right = read_input(uv - amount);
	let red = shiftChannel(left.ra, right.ra, uniforms.leftSignal.r != 0u, uniforms.rightSignal.r != 0u);
	let green = shiftChannel(left.ga, right.ga, uniforms.leftSignal.g != 0u, uniforms.rightSignal.g != 0u);
	let blue = shiftChannel(left.ba, right.ba, uniforms.leftSignal.b != 0u, uniforms.rightSignal.b != 0u);

	// RGBは既に乗算済み。別チャンネルのアルファによる再乗算を避ける。
	return vec4f(red.x, green.x, blue.x, max(red.y, max(green.y, blue.y)));
}
