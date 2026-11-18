struct Uniforms {
	halfExtent: vec2f,
	drawFrom: vec4f,
	drawTo: vec4f,
	injection: vec2f,
	dissipation: vec3f,
	minimumChange: f32,
	advectionSeconds: f32,
	advectionStrength: f32,
	noiseStrength: f32,
	noiseSize: f32,
	smoothing: f32,
	seedOffset: vec2f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var stateTexture: texture_2d<f32>;
@group(0) @binding(2) var lowTexture: texture_2d<f32>;
@group(0) @binding(3) var stateSampler: sampler;

// 1920pxの基準画面→480pxの状態格子、25px/frameを長辺単位/秒へ換算。
// 公開ベクトルの単位を描画寸法やAdvectionの設定で変えない。
const VELOCITY_TO_WORLD: f32 = 25.0 * 60.0 / 480.0;

fn sampleState(position: vec2f) -> vec4f {
	let uv = position / uniforms.halfExtent * vec2f(0.5, -0.5) + 0.5;
	return textureSampleLevel(stateTexture, stateSampler, uv, 0.0);
}

fn gradientHash(point: vec2f) -> vec2f {
	var value = fract(point.xyx * vec3f(0.1031, 0.1030, 0.0973));
	value += dot(value, value.yzx + 33.33);
	return fract((value.xx + value.yz) * value.zy) * 2.0 - 1.0;
}

fn gradientNoise(point: vec2f) -> vec3f {
	let cell = floor(point);
	let local = fract(point);
	let weight = local * local * local * (local * (local * 6.0 - 15.0) + 10.0);
	let derivative = 30.0 * local * local * (local * (local - 2.0) + 1.0);
	let a = gradientHash(cell);
	let b = gradientHash(cell + vec2f(1.0, 0.0));
	let c = gradientHash(cell + vec2f(0.0, 1.0));
	let d = gradientHash(cell + vec2f(1.0, 1.0));
	let va = dot(a, local);
	let vb = dot(b, local - vec2f(1.0, 0.0));
	let vc = dot(c, local - vec2f(0.0, 1.0));
	let vd = dot(d, local - vec2f(1.0, 1.0));
	return vec3f(va + weight.x * (vb - va) + weight.y * (vc - va)
		+ weight.x * weight.y * (va - vb - vc + vd),
		a + weight.x * (b - a) + weight.y * (c - a)
		+ weight.x * weight.y * (a - b - c + d)
		+ derivative * (weight.yx * (va - vb - vc + vd) + vec2f(vb, vc) - va));
}

@fragment
fn advance(@location(0) coordinate: vec2f) -> @location(0) vec4f {
	let position = coordinate * uniforms.halfExtent;
	let uv = coordinate * vec2f(0.5, -0.5) + 0.5;
	let low = textureSampleLevel(lowTexture, stateSampler, uv, 0.0);
	var velocity = (low.xy - 0.5) * VELOCITY_TO_WORLD * uniforms.advectionStrength;
	if (uniforms.noiseStrength > 0.0) {
		// 場に依存する二段ノイズ。静的curlへ置き換えると軌跡の崩れ方が変わる。
		let noisePosition = (position + uniforms.halfExtent) / uniforms.noiseSize + uniforms.seedOffset;
		let first = gradientNoise(noisePosition * (1.0 - low.xy));
		let noise = gradientNoise(noisePosition * (2.0 - low.xy * (0.5 + first.x) + first.yz * 0.1)).yz;
		velocity -= noise * (low.z + low.w) * uniforms.noiseStrength;
	}
	var previous = sampleState(position - velocity * uniforms.advectionSeconds);
	previous = vec4f(previous.xy - 0.5, previous.zw);
	let movement = uniforms.drawTo.xy - uniforms.drawFrom.xy;
	let squaredDistance = dot(movement, movement);
	var brush = 0.0;
	var strength = 0.0;
	if (squaredDistance > 0.0) {
		let along = clamp(dot(position - uniforms.drawFrom.xy, movement) / squaredDistance, 0.0, 1.0);
		let distance = length(position - mix(uniforms.drawFrom.xy, uniforms.drawTo.xy, along));
		let radiusStrength = mix(uniforms.drawFrom.zw, uniforms.drawTo.zw, along);
		if (radiusStrength.x > 0.0) {
			brush = 1.0 - smoothstep(-0.01 / 480.0, radiusStrength.x, distance);
			strength = radiusStrength.y;
		}
	}
	var change = (uniforms.dissipation.xxyz - 1.0) * previous
		+ vec4f(uniforms.injection * brush, vec2f(strength * brush));
	// UNORM8への丸めで弱い軌跡が永久に残らないよう、元の最小変化量も保つ。
	change = vec4f(change.xy, sign(change.zw) * max(vec2f(uniforms.minimumChange), abs(change.zw)));
	let next = previous + change;
	return clamp(vec4f(next.xy + 0.5, next.zw), vec4f(0.0), vec4f(1.0));
}

@fragment
fn downsample(@location(0) coordinate: vec2f) -> @location(0) vec4f {
	return sampleState(coordinate * uniforms.halfExtent);
}

fn blur(position: vec2f, direction: vec2f) -> vec4f {
	let step = direction * uniforms.smoothing / 4.0;
	return sampleState(position) * 0.1633
		+ (sampleState(position - step) + sampleState(position + step)) * 0.1531
		+ (sampleState(position - step * 2.0) + sampleState(position + step * 2.0)) * 0.12245
		+ (sampleState(position - step * 3.0) + sampleState(position + step * 3.0)) * 0.0918
		+ (sampleState(position - step * 4.0) + sampleState(position + step * 4.0)) * 0.051;
}

@fragment
fn blurHorizontal(@location(0) coordinate: vec2f) -> @location(0) vec4f {
	return blur(coordinate * uniforms.halfExtent, vec2f(1.0, 0.0));
}

@fragment
fn blurVertical(@location(0) coordinate: vec2f) -> @location(0) vec4f {
	return blur(coordinate * uniforms.halfExtent, vec2f(0.0, 1.0));
}

struct Outputs {
	@location(0) vector: vec2f,
	@location(1) scalar: f32,
};

@fragment
fn output(@location(0) coordinate: vec2f) -> Outputs {
	let state = sampleState(coordinate * uniforms.halfExtent);
	return Outputs((state.xy - 0.5) * VELOCITY_TO_WORLD, (state.z + state.w) * 0.5);
}
