struct Uniforms {
	halfExtent: vec2f,
	heightScale: f32,
	lightWrap: f32,
	lightDirection: vec3f,
	lightIntensity: f32,
	lightColor: vec4f,
	ambientFrontColor: vec4f,
	ambientBackColor: vec4f,
	ambientIntensity: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let baseColor = read_input(position);
	// 補間・fit・wrapを適用した高さ場の偏微分を、各軸[-1,+1]から
	// 長辺全体=1の共通単位へ換算する。画素幅で直接差を取らないため、
	// 同じ傾斜なら解像度・縦横比にかかわらず同じ法線になる。
	let slope = readGradient_height(position, true).yz / uniforms.halfExtent * uniforms.heightScale;
	// z=h(x,y)の接平面に垂直で、手前を向く法線は(-dh/dx,-dh/dy,1)。
	// 大きな傾斜でも長さの二乗がoverflowしないよう、正規化の前に縮める。
	let normalScale = max(1.0, max(abs(slope.x), abs(slope.y)));
	let normal = normalize(vec3f(-slope / normalScale, 1.0 / normalScale));
	let diffuse = clamp((dot(normal, uniforms.lightDirection) + uniforms.lightWrap) / (1.0 + uniforms.lightWrap), 0.0, 1.0);
	let directional = uniforms.lightColor.rgb * uniforms.lightColor.a * uniforms.lightIntensity * diffuse;
	// 半球環境光の軸は画面手前。前後を同色にすると方向によらない環境光にできる。
	// 高さ面は手前側だけを表すので、背面色は主に急な斜面の陰影へ寄与する。
	let ambientFront = uniforms.ambientFrontColor.rgb * uniforms.ambientFrontColor.a;
	let ambientBack = uniforms.ambientBackColor.rgb * uniforms.ambientBackColor.a;
	let ambient = mix(ambientBack, ambientFront, normal.z * 0.5 + 0.5) * uniforms.ambientIntensity;
	// 乗算済みRGBへ照度を掛けるだけなら、alphaの除算・再乗算は不要。
	// 不透明度を保ち、完全な透明色から発光や不透明な面を生成しない。
	return vec4f(baseColor.rgb * (ambient + directional), baseColor.a);
}
