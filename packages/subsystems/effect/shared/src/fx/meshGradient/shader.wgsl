// Mesh Gradient by Paper Design, Apache-2.0 (see LICENSE and NOTICE).
// https://github.com/paper-design/shaders/blob/main/packages/shaders/src/shaders/mesh-gradient.ts
// Modified: GLSL -> WGSL, ShaderInput color array, explicit time, Glitch Studio coordinates and sizing.

struct Uniforms {
	coordinateScale: vec2f,
	offset: vec2f,
	scale: f32,
	angle: f32,
	time: f32,
	distortion: f32,
	swirl: f32,
	grainMixer: f32,
	grainOverlay: f32,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;

fn rotate(position: vec2f, angle: f32) -> vec2f {
	return mat2x2f(cos(angle), sin(angle), -sin(angle), cos(angle)) * position;
}

fn hash21(position: vec2f) -> f32 {
	var p = fract(position * vec2f(0.3183099, 0.3678794)) + vec2f(0.1);
	p += vec2f(dot(p, p + vec2f(19.19)));
	return fract(p.x * p.y);
}

fn valueNoise(position: vec2f) -> f32 {
	let cell = floor(position);
	let fraction = fract(position);
	let weight = fraction * fraction * (vec2f(3.0) - 2.0 * fraction);
	return mix(
		mix(hash21(cell), hash21(cell + vec2f(1.0, 0.0)), weight.x),
		mix(hash21(cell + vec2f(0.0, 1.0)), hash21(cell + vec2f(1.0, 1.0)), weight.x),
		weight.y,
	);
}

fn spotPosition(index: u32, time: f32) -> vec2f {
	let i = f32(index);
	let phase = i * 0.37;
	let frequencyX = 0.6 + fract(i / 3.0) * 0.9;
	let frequencyY = 0.8 + fract((i + 1.0) / 4.0);
	return vec2f(0.5) + 0.5 * vec2f(sin(time * frequencyX + phase), cos(time * frequencyY + phase * 1.5));
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	// 色がないときはグレインだけの画像を生成せず、透明を返す。
	if (count_colors == 0u) { return vec4f(0.0); }

	// offsetは画面の半幅・半高さを1とする。回転前に縦横の単位を揃え、
	// Angle=1で模様が時計回りに180度回転するよう、参照座標を逆変換する。
	var uv = rotate((position - uniforms.offset) * uniforms.coordinateScale * 0.5, uniforms.angle) / uniforms.scale + vec2f(0.5);
	// ピクセル座標ではなく模様の座標で粒を作り、解像度によらず粒の大きさを保つ。
	let grainUV = uv * 1000.0;
	let mixerGrain = 0.4 * uniforms.grainMixer * (valueNoise(grainUV) - 0.5);
	let time = 0.5 * (uniforms.time + 41.5);
	let radius = smoothstep(0.0, 1.0, length(uv - vec2f(0.5)));
	let center = 1.0 - radius;
	for (var i = 1u; i <= 2u; i++) {
		let iteration = f32(i);
		uv.x += uniforms.distortion * center / iteration
			* sin(time + iteration * 0.4 * smoothstep(0.0, 1.0, uv.y))
			* cos(0.2 * time + iteration * 2.4 * smoothstep(0.0, 1.0, uv.y));
		uv.y += uniforms.distortion * center / iteration
			* cos(time + iteration * 2.0 * smoothstep(0.0, 1.0, uv.x));
	}
	uv = rotate(uv - vec2f(0.5), -3.0 * uniforms.swirl * radius) + vec2f(0.5);

	var result = vec4f(0.0);
	var totalWeight = 0.0;
	// 固定長の上限や色数パラメータは持たず、配列の全要素を使用する。
	for (var i = 0u; i < count_colors; i++) {
		let distance = length(uv - spotPosition(i, time) - vec2f(mixerGrain));
		let weight = 1.0 / (pow(distance, 3.5) + 0.001);
		// ShaderInputは既に乗算済み。元GLSLのrgb * alphaを繰り返さずRGBAを一緒に平均する。
		result += read_colors(i, position) * weight;
		totalWeight += weight;
	}
	result /= max(0.0001, totalWeight);

	if (uniforms.grainOverlay > 0.0) {
		var grain = valueNoise(rotate(grainUV, 1.0) + vec2f(3.0));
		grain = mix(grain, valueNoise(rotate(grainUV, 2.0) - vec2f(1.0)), 0.5);
		let signedGrain = pow(grain, 1.3) * 2.0 - 1.0;
		let grainColor = vec3f(step(0.0, signedGrain));
		let strength = pow(uniforms.grainOverlay * abs(signedGrain), 0.8);
		// 元のグレインは色だけでなく不透明度も増やす処理。乗算済みRGBへの
		// 加算量(最大0.35*strength)以上のalphaを加えるので、最後の再乗算は不要。
		result = vec4f(mix(result.rgb, grainColor, 0.35 * strength), clamp(result.a + 0.5 * strength, 0.0, 1.0));
	}
	return result;
}
