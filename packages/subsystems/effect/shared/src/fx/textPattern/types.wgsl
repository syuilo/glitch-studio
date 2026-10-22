struct TextPatternUniforms {
	aspectRatio: f32,
	characterCount: u32,
	padding: vec2u,
};

struct TextPatternGlyph {
	anchor: vec4f,
	localBounds: vec4f,
	atlasBounds: vec4f,
};

struct TextPatternInstance {
	// xyは出力座標の中心、zは拡縮率、wは時計回りの回転角（ラジアン）。
	transform: vec4f,
	color: vec4f,
	localBounds: vec4f,
	atlasBounds: vec4f,
};
