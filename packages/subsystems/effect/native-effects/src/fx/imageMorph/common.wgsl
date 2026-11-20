struct Uniforms {
	canvasExtent: vec2f,
	analysisSize: vec2f,
	sourceSize: vec2f,
	flowSize: vec2f,
	progress: f32,
	warpStrength: f32,
	blend: f32,
	searchRange: f32,
	smoothness: f32,
	stepScale: f32,
	confidenceGuard: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var linearSampler: sampler;

fn spatialPosition(uv: vec2f) -> vec2f {
	return (uv - 0.5) * uniforms.canvasExtent * vec2f(1.0, -1.0);
}

fn imageUv(point: vec2f) -> vec2f {
	return point / uniforms.canvasExtent * vec2f(1.0, -1.0) + 0.5;
}

fn insideCanvas(point: vec2f) -> bool {
	return all(abs(point) <= uniforms.canvasExtent * 0.5);
}

fn readAnalysis(image: texture_2d<f32>, uv: vec2f, virtualSize: vec2f) -> vec4f {
	// 切り上げたtexture寸法を座標系にせず、同じ縦横比なら解析・出力解像度を
	// 変えても同じ位置を読む。余りのtexelは境界値の延長として扱う。
	return textureSampleLevel(image, linearSampler, uv * virtualSize / vec2f(textureDimensions(image)), 0.0);
}

fn appearanceError(first: vec4f, second: vec4f) -> f32 {
	var firstRgb = vec3f(0.0);
	var secondRgb = vec3f(0.0);
	if (first.a > 0.0) { firstRgb = first.rgb / first.a; }
	if (second.a > 0.0) { secondRgb = second.rgb / second.a; }
	let difference = firstRgb - secondRgb;
	let visibility = clamp(min(first.a, second.a), 0.0, 1.0);
	let alphaDifference = first.a - second.a;
	// 色は可視部分だけで比較し、透明な図形の輪郭もalpha差で追跡する。
	return visibility * dot(difference, difference) / 3.0 + alphaDifference * alphaDifference;
}
