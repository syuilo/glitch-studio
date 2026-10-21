struct Uniforms {
	inverseX: vec4f,
	inverseY: vec4f,
	clipX: vec4f,
	clipY: vec4f,
	sourceBounds: vec4f,
	backgroundBounds: vec4f,
	outputBounds: vec4f,
	layerMaskBounds: vec4f,
	opacity: f32,
	blendMode: u32,
	sourceVisible: u32,
	clipToFrame: u32,
	maskChannel: u32,
	maskInverted: u32,
	transformTarget: u32,
	layerMaskChannel: u32,
	layerMaskInverted: u32,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
fn mapBounds(point: vec2f, bounds: vec4f) -> vec2f {
	return (point - bounds.xy) / bounds.zw;
}
fn maskValue(color: vec4f, channel: u32, inverted: u32) -> f32 {
	// RGBは既にalpha乗算済みなので、輝度にも透明度が含まれている。
	// alphaを再乗算すると、半透明の白マスクの効きが二重に弱まる。
	let value = clamp(select(dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722)), color.a, channel == 1u), 0.0, 1.0);
	return select(value, 1.0 - value, inverted != 0u);
}
fn readTransformedSource(position: vec2f) -> vec4f {
	if (uniforms.sourceVisible == 0u) { return vec4f(0.0); }
	let homogeneous = vec3f(position, 1.0);
	if (uniforms.clipToFrame != 0u) {
		let clipPosition = vec2f(dot(uniforms.clipX.xyz, homogeneous), dot(uniforms.clipY.xyz, homogeneous));
		if (any(abs(clipPosition) > vec2f(1.0))) { return vec4f(0.0); }
	}
	let local = vec2f(dot(uniforms.inverseX.xyz, homogeneous), dot(uniforms.inverseY.xyz, homogeneous));
	let sourcePosition = mapBounds(local, uniforms.sourceBounds);
	if (any(abs(sourcePosition) > vec2f(1.0))) { return vec4f(0.0); }
	return read_source(sourcePosition);
}
@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let outputPosition = uniforms.outputBounds.xy + position * uniforms.outputBounds.zw;
	let backgroundPosition = mapBounds(outputPosition, uniforms.backgroundBounds);
	// 定数出力にも有限の範囲がある。グループの合成範囲を広げたときに、
	// 下層の一様色が新しくできた余白まで無限に塗り広がらないようにする。
	var background = vec4f(0.0);
	if (all(abs(backgroundPosition) <= vec2f(1.0))) { background = read_background(backgroundPosition); }
	var coverage = 1.0;
	var source = vec4f(0.0);
	if (uniforms.transformTarget == 1u) {
		let homogeneous = vec3f(outputPosition, 1.0);
		let local = vec2f(dot(uniforms.inverseX.xyz, homogeneous), dot(uniforms.inverseY.xyz, homogeneous));
		// 範囲の被覆率は出力alphaから独立させる。透明な結果もReplaceでは置換対象となる。
		// 変形後の1画素幅で端を補間し、回転・拡縮でも矩形の輪郭がギザギザにならないようにする。
		let edge = clamp((vec2f(1.0) - abs(local)) / max(fwidth(local), vec2f(0.000001)) + vec2f(0.5), vec2f(0.0), vec2f(1.0));
		coverage = edge.x * edge.y * f32(uniforms.sourceVisible);
		// 枠だけを逆変換し、処理済み画像は元の合成先座標で読む。
		let sourcePosition = mapBounds(outputPosition, uniforms.sourceBounds);
		if (all(abs(sourcePosition) <= vec2f(1.0))) { source = read_source(sourcePosition); }
		else { coverage = 0.0; }
	} else {
		source = readTransformedSource(outputPosition);
	}
	if (uniforms.layerMaskChannel != 0u) {
		// 参照先は同じ合成空間へ配置済み。対象の逆変換やFitを適用すると、
		// 対象を動かすたびにマスクまで一緒に動いて画面上の重なりが失われる。
		let maskPosition = mapBounds(outputPosition, uniforms.layerMaskBounds);
		var maskColor = vec4f(0.0);
		if (all(abs(maskPosition) <= vec2f(1.0))) { maskColor = read_layerMask(maskPosition); }
		// 被覆率として合成へ渡すことで、Replaceの透明画素や下層切り抜きマスクも
		// 参照マスクの外側では背景を保持する。RGBだけを減衰させては実現できない。
		coverage *= maskValue(maskColor, uniforms.layerMaskChannel, uniforms.layerMaskInverted);
	}
	if (uniforms.maskChannel != 0u) {
		let mask = maskValue(source, uniforms.maskChannel, uniforms.maskInverted);
		// opacityは適用の強さ。0では下層を保ち、1では透明部分も切り抜く。
		// premultiplied RGBAのRGBとalphaを同じ割合で減衰させる。
		return background * mix(1.0, mask, uniforms.opacity * coverage);
	}
	// Replaceは透明な画素も置き換える。範囲の最適化で背景を残してはいけない。
	if (uniforms.blendMode == 19u) { return mix(background, source, uniforms.opacity * coverage); }
	return mix(background, blendColor(uniforms.blendMode, background, source * uniforms.opacity), coverage);
}
