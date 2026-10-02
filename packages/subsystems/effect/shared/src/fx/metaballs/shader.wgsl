// Metaballs by Paper Design, Apache-2.0 (see LICENSE and NOTICE).
// https://github.com/paper-design/shaders/blob/main/packages/shaders/src/shaders/metaballs.ts
// Modified: GLSL -> WGSL, procedural noise instead of a noise image, ShaderInput colors/background,
// explicit time, Glitch Studio sizing, alpha-safe foreground dithering.

struct Uniforms {
	coordinateScale: vec2f,
	offset: vec2f,
	scale: f32,
	angle: f32,
	time: f32,
	count: f32,
	size: f32,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;

fn rotate(position: vec2f, angle: f32) -> vec2f {
	return mat2x2f(cos(angle), sin(angle), -sin(angle), cos(angle)) * position;
}

// 外部の乱数画像やフレームごとの乱数に依存させず、同じtimeで同じ軌道を再現する。
// 負の格子座標もビット列としてハッシュし、時間を逆再生したときも連続に補間する。
fn randomValue(cell: f32) -> f32 {
	var bits = bitcast<u32>(i32(cell));
	bits = (bits ^ (bits >> 16u)) * 0x7feb352du;
	bits = (bits ^ (bits >> 15u)) * 0x846ca68bu;
	bits ^= bits >> 16u;
	return f32(bits >> 8u) / 16777216.0;
}

fn noise(position: f32) -> f32 {
	let cell = floor(position);
	let fraction = fract(position);
	let weight = fraction * fraction * (3.0 - 2.0 * fraction);
	return mix(randomValue(cell), randomValue(cell + 1.0), weight);
}

fn ballShape(position: vec2f, center: vec2f, exponent: f32) -> f32 {
	let distance = 0.5 * length(position - center);
	return pow(1.0 - clamp(distance, 0.0, 1.0), exponent);
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let background = read_background(position);
	// 空配列では剰余の0除算を避け、Size=0では背景をそのまま返す。
	if (count_colors == 0u || uniforms.size == 0.0) { return background; }

	// offsetは画面の半幅・半高さを1とする。回転前に縦横の単位を揃えて歪みを防ぐ。
	// 正のAngleで模様を時計回りに回すため、参照座標を反時計回りに回転する。
	let shapeUV = rotate((position - uniforms.offset) * uniforms.coordinateScale * 0.5, uniforms.angle) / uniforms.scale + vec2f(0.5);
	let time = 0.2 * (uniforms.time + 2503.4);
	var totalColor = vec4f(0.0);
	var totalShape = 0.0;
	for (var i = 0u; i < u32(ceil(uniforms.count)); i++) {
		// 分母は現在の個数ではなく元の上限20。個数変更で既存のボールの軌道を変えない。
		let indexFraction = f32(i) / 20.0;
		let angle = 6.283185307179586 * indexFraction;
		let speed = 1.0 - 0.2 * indexFraction;
		let noiseX = noise(angle * 10.0 + f32(i) + time * speed);
		let noiseY = noise(angle * 20.0 + f32(i) - time * speed);
		let center = vec2f(0.5001) + 0.9 * (vec2f(noiseX, noiseY) - vec2f(0.5));

		// 色は配列順に循環させる。ShaderInputは乗算済みなのでalphaを再乗算しない。
		let color = read_colors(i % max(count_colors, 1u), position);
		var sizeFraction = 1.0;
		if (f32(i) > floor(uniforms.count - 1.0)) {
			sizeFraction = fract(uniforms.count);
		}
		var shape = ballShape(shapeUV, center, 45.0 - 30.0 * uniforms.size * sizeFraction);
		shape *= pow(uniforms.size, 0.2);
		shape = smoothstep(0.0, 1.0, shape);
		totalColor += color * shape;
		totalShape += shape;
	}

	// 乗算済みRGBAを同じ重みで平均し、融合した場の等高線で輪郭を切り出す。
	// 平坦な領域ではfwidthが0になるため、smoothstepの両端が一致しないようにする。
	let edgeWidth = max(fwidth(totalShape), 0.000001);
	let finalShape = smoothstep(0.4, 0.4 + edgeWidth, totalShape);
	var foreground = totalColor / max(totalShape, 0.0001) * finalShape;

	// 階調のバンディングを抑えるノイズは前景だけに加える。alphaで強度を調整し、
	// 透明部分にRGBを残したり、接続した背景へノイズを加えたりしない。
	// 正規化座標を使うことで解像度を変更してもノイズの分布を維持する。
	let dither = (fract(sin(dot(shapeUV * 1000.0, vec2f(12.9898, 78.233))) * 43758.5453123) - 0.5) / 256.0;
	foreground = vec4f(foreground.rgb + vec3f(dither * foreground.a), foreground.a);
	return foreground + background * (1.0 - foreground.a);
}
