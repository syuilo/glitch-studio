struct Uniforms {
	center: vec2f,
	logZoom: f32,
	overlap: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let progress = clamp(read_progress(position), 0.0, 1.0);
	if (progress <= 0.0) { return read_inputA(position); }
	if (progress >= 1.0) { return read_inputB(position); }

	// InではAの倍率が1→Zoom、Bが1/Zoom→1。両画像が同方向へ動き、
	// Aが見える開始点とBが見える終点では必ず等倍に戻る。
	// 逆参照なので、見た目の拡大率の逆数を掛ける。
	let relative = position - uniforms.center;
	let sourceA = uniforms.center + relative * exp2(-uniforms.logZoom * progress);
	let sourceB = uniforms.center + relative * exp2(uniforms.logZoom * (1.0 - progress));
	var weight = step(0.5, progress);
	if (uniforms.overlap > 0.0) {
		weight = smoothstep(0.5 - uniforms.overlap * 0.5, 0.5 + uniforms.overlap * 0.5, progress);
	}
	// 縮小時の画面外参照にも接続のFit / Wrap / Filterを適用する。
	// このエフェクトで画像枠や端延長を追加すると、他の変形入力との合成が変わる。
	if (weight <= 0.0) { return read_inputA(sourceA); }
	if (weight >= 1.0) { return read_inputB(sourceB); }
	// premultiplied RGBA全体を補間し、半透明・HDR・負値を保持する。
	return mix(read_inputA(sourceA), read_inputB(sourceB), weight);
}

