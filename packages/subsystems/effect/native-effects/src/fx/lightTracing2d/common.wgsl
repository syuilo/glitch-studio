struct Uniforms {
	sceneSize: vec2f,
	lightingSize: vec2f,
	emissionStrength: f32,
	absorption: f32,
	alphaThreshold: f32,
	rayCount: u32,
	maxSteps: u32,
	seed: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct FragmentIn {
	@location(0) position: vec2f,
	@builtin(position) pixelPosition: vec4f,
};

fn occupied(color: vec4f) -> bool {
	return color.a > 0.0 && color.a >= uniforms.alphaThreshold;
}

// seedは連続値ではなく画素の識別子。16bit floatでも2048を超える画素座標を
// 丸めずに保持できるよう、各軸を1024進数の下位・上位に分ける。
fn encodeSeed(pixel: vec2i) -> vec4f {
	return vec4f(vec2f(pixel % vec2i(1024)), vec2f(pixel / vec2i(1024)));
}

fn decodeSeed(seed: vec4f) -> vec2f {
	return seed.xy + seed.zw * 1024.0 + 0.5;
}

fn outsideScene(position: vec2f) -> bool {
	return any(position < vec2f(0.0)) || any(position >= uniforms.sceneSize);
}

// 物体の近くでは距離場のepsilonで衝突を推測せず、隣の画素へ進んで実際のαを確認する。
// directionが0の軸は交差しない。境界の直後まで進め、同じ画素で停止するのを防ぐ。
fn nextPixelDistance(position: vec2f, direction: vec2f) -> f32 {
	let boundary = floor(position) + select(vec2f(0.0), vec2f(1.0), direction > vec2f(0.0));
	let distances = select(vec2f(1e20), (boundary - position) / select(vec2f(1.0), direction, abs(direction) > vec2f(1e-8)), abs(direction) > vec2f(1e-8));
	return max(0.0, min(distances.x, distances.y)) + 0.001;
}
