@group(0) @binding(0) var<uniform> uniforms: TextPatternUniforms;
@group(0) @binding(1) var<storage, read> glyphs: array<TextPatternGlyph>;
@group(0) @binding(2) var<storage, read_write> instances: array<TextPatternInstance>;

@compute @workgroup_size(64)
fn prepareCharacters(@builtin(global_invocation_id) invocation: vec3u) {
	let index = invocation.x;
	if (index >= uniforms.characterCount) { return; }
	let glyph = glyphs[index];
	let anchor = glyph.anchor.xy;
	// 全属性を変形前の配置枠の中心で一度だけ読む。描画先の画素座標や前フレームの
	// 位置で読み直すと、字形が歪んだりシーク・書き出しの結果が履歴に依存したりする。
	let translation = read_translation(anchor);
	let opacity = clamp(read_opacity(anchor), 0.0, 1.0);
	let scale = read_scale(anchor);
	let rotation = -read_rotation(anchor) * 3.141592653589793;
	instances[index] = TextPatternInstance(
		vec4f(anchor + translation, scale, rotation),
		read_color(anchor) * opacity,
		glyph.localBounds,
		glyph.atlasBounds,
	);
}
