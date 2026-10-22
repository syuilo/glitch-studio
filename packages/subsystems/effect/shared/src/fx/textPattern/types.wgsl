struct TextPatternUniforms {
	aspectRatio: f32,
	characterCount: u32,
	rowCount: u32,
	trackingScale: f32,
	alignment: f32,
	preserveTrackingEndpoints: u32,
};

struct TextPatternRow {
	firstCharacter: u32,
	characterCount: u32,
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
