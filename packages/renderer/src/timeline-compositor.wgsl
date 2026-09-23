struct Uniforms {
	translation: vec2f,
	scale: vec2f,
	rotation: f32,
	opacity: f32,
	aspectRatio: f32,
	blendMode: u32,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;

fn readTransformedSource(position: vec2f) -> vec4f {
	if (any(abs(uniforms.scale) < vec2f(0.000001))) { return vec4f(0.0); }
	// Transformノードと同じ単位（位置の1は半画面、角度の1は時計回り180度）。
	// 拡縮→回転→移動を逆順に戻し、回転時の距離だけアスペクト比で揃える。
	let extent = vec2f(uniforms.aspectRatio, 1.0);
	let translated = (position - uniforms.translation) * extent;
	let angle = -uniforms.rotation * 3.141592653589793;
	let c = cos(angle);
	let s = sin(angle);
	let rotated = vec2f(c * translated.x + s * translated.y, -s * translated.x + c * translated.y);
	let sourcePosition = rotated / (uniforms.scale * extent);
	// uniform出力もモジュールの画面範囲を持つ素材として変形する。
	// texture入力の端の補間はtransparent wrapが担当する。
	if (any(abs(sourcePosition) > vec2f(1.0))) { return vec4f(0.0); }
	return read_source(sourcePosition);
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let background = read_background(position);
	let source = readTransformedSource(position);
	// Replaceは透明部分も含めたRGBAの置き換え。opacity=0なら背景を維持する。
	if (uniforms.blendMode == 19u) { return mix(background, source, uniforms.opacity); }
	if (uniforms.blendMode == 10u) { return background; }

	// 既にpremultiply済み。opacityはRGBとalphaの両方に一度だけ掛ける。
	let foreground = source * uniforms.opacity;
	var a = vec3f(0.0);
	var b = vec3f(0.0);
	if (background.a > 0.0) { a = background.rgb / background.a; }
	if (foreground.a > 0.0) { b = foreground.rgb / foreground.a; }
	let blended = clamp(blendRgb(uniforms.blendMode, a, b), vec3f(0.0), vec3f(1.0));
	let rgb = (1.0 - foreground.a) * background.rgb + (1.0 - background.a) * foreground.rgb
		+ background.a * foreground.a * blended;
	return vec4f(rgb, foreground.a + background.a * (1.0 - foreground.a));
}
