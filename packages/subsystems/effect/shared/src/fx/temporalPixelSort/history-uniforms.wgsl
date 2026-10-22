struct Uniforms {
	historyCount: u32,
	sortKey: u32,
	descending: u32,
	interpolateRanks: u32,
	ignoreTransparent: u32,
	// uniform配列の16byte境界に合わせ、1要素に4枚の保存先を格納する。
	// 新しい時刻から順に並べる。現在の入力と同じ時刻の保存画像は含めない。
	historyLayers: array<vec4u, 16>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
