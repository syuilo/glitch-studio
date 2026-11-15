struct Uniforms {
	displacementScale: vec2f,
	strength: f32,
	mixWidth: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let progress = clamp(read_progress(position), 0.0, 1.0);
	if (progress <= 0.0) { return read_inputA(position); }
	if (progress >= 1.0) { return read_inputB(position); }

	// 両端で値だけでなく傾きも0の包絡。終端だけ元画像を返す補正に頼らず、
	// 直前のフレームでも歪みが自然に解け、スクラブや逆再生でも同じ結果になる。
	let envelopeBase = 4.0 * progress * (1.0 - progress);
	let envelope = envelopeBase * envelopeBase;
	// 進捗と変位場は出力位置で一度読む。画像と一緒に変位場を動かしたり、
	// RGを色として解釈して0.5を引くような変換は行わない。
	let offset = read_displacement(position) * uniforms.displacementScale * (uniforms.strength * envelope);
	var weight = step(0.5, progress);
	if (uniforms.mixWidth > 0.0) {
		weight = smoothstep(0.5 - uniforms.mixWidth * 0.5, 0.5 + uniforms.mixWidth * 0.5, progress);
	}
	// 逆参照ではAから変位を引き、Bには加える。同じ場から対向する動きを作る。
	// 範囲外も接続のFit / Wrap / Filterに任せ、premultiplied RGBAを保つ。
	if (weight <= 0.0) { return read_inputA(position - offset); }
	if (weight >= 1.0) { return read_inputB(position + offset); }
	return mix(read_inputA(position - offset), read_inputB(position + offset), weight);
}

