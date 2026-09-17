const PI = 3.14159265359;
const RATIO = 5.264;
const EPSILON = 0.000001;

fn convertTexCoords(uv: vec2f) -> vec2f {
	return vec2f(uv.x, -uv.y) * 0.5 + vec2f(0.5);
}

fn complexInverse(value: vec2f) -> vec2f {
	return vec2f(value.x, -value.y) / max(dot(value, value), EPSILON);
}

fn complexExp(value: vec2f) -> vec2f {
	return exp(value.x) * vec2f(cos(value.y), sin(value.y));
}

fn complexLog(value: vec2f) -> vec2f {
	return vec2f(log(max(length(value), EPSILON)), atan2(value.y, value.x));
}

fn complexMultiply(a: vec2f, b: vec2f) -> vec2f {
	return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

fn complexDivide(a: vec2f, b: vec2f) -> vec2f {
	return complexMultiply(a, complexInverse(b));
}

fn regressionScale(value: f32) -> f32 {
	return pow(RATIO, -floor(log(max(value, EPSILON)) / log(RATIO)));
}

struct Uniforms {
	aspectRatio: f32,
	amount: f32,
	twist: f32,
};

@group(0) @binding(1) var<uniform> uniforms: Uniforms;
@group(0) @binding(2) var sourceSampler: sampler;
@group(0) @binding(3) var sourceTexture: texture_2d<f32>;

struct FragmentIn {
	@location(0) uv: vec2f,
};

@fragment
fn fs(fragData: FragmentIn) -> @location(0) vec4f {
	let uv = convertTexCoords(fragData.uv);
	if (uniforms.amount == 0.0) {
		return textureSampleLevel(sourceTexture, sourceSampler, uv, 0.0);
	}

	let aspectScale = vec2f(uniforms.aspectRatio, 1.0);
	var position = (uv * 2.0 - 1.0) * aspectScale;
	if (length(position) < EPSILON) {
		return textureSampleLevel(sourceTexture, sourceSampler, uv, 0.0);
	}

	let angle = atan(log(RATIO) / (uniforms.twist * PI));
	position = complexExp(complexDivide(
		complexLog(position),
		complexExp(vec2f(0.0, angle)) * cos(angle),
	));
	let absolutePosition = abs(position);
	position *= regressionScale(max(absolutePosition.x, absolutePosition.y) * 2.0);

	// 複素平面でアスペクト比を補正してから、テクスチャ座標へ戻す。
	let transformedUv = position / (RATIO * aspectScale) + 0.5;
	let sourceUv = mix(uv, transformedUv, uniforms.amount);
	// 入力は既にpremultiplied alphaなので、そのまま返す。
	return textureSampleLevel(sourceTexture, sourceSampler, sourceUv, 0.0);
}
