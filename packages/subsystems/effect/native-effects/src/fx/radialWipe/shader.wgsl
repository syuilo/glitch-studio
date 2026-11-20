struct Uniforms {
	halfExtent: vec2f,
	center: vec2f,
	pixelSize: f32,
	feather: f32,
	startAngle: f32,
	direction: u32,
	angularFeather: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

fn transitionMask(position: vec2f) -> f32 {
	let progress = clamp(read_progress(position), 0.0, 1.0);
	if (progress <= 0.0) { return 0.0; }
	if (progress >= 1.0) { return 1.0; }
	let relative = position * uniforms.halfExtent - uniforms.center;
	let radius = length(relative);
	// 中心には向きがない。周囲の角度平均（扇形の割合）を使い、atan2(0,0)を避ける。
	if (radius <= 0.0000001) { return progress; }
	let tau = 6.283185307179586;
	var angle = atan2(relative.x, relative.y) / tau - uniforms.startAngle;
	if (uniforms.direction == 1u) { angle = -angle; }
	// Bothは開始角の両側へ半分ずつ開く。進捗0.5では合計半周になる。
	if (uniforms.direction == 2u) { angle += progress * 0.5; }
	angle = fract(angle);

	// 距離モードは同心円上の弧長をturnへ換算する。角度モードでは外側ほど幅が広がる。
	let featherTurns = select(uniforms.feather / (tau * radius), uniforms.feather, uniforms.angularFeather != 0u);
	let antialiasTurns = uniforms.pixelSize * (abs(relative.x) + abs(relative.y)) / (tau * radius * radius);
	let width = min(1.0, max(featherTurns, max(antialiasTurns, 0.0000001)));
	if (width >= 1.0) { return progress; }

	// 扇形の被覆率を角度方向の区間平均で求める。始端と終端を個別にぼかして
	// 乗算すると、狭い扇形・ほぼ一周した扇形で端点へ不連続になる。
	// 周期をまたぐ区間も積分することで、開始線の両側を同じ幅でぼかし、
	// progress→0/1で連続的に完全なA/Bへ到達する。
	var coverage = 0.0;
	for (var period = -1; period <= 1; period++) {
		let sectorStart = f32(period);
		let sectorEnd = sectorStart + progress;
		// 先に窓内の比率へ変換する。狭い窓の両端を減算してから幅で割ると、
		// 高解像度の完全なB領域にも桁落ちで僅かなAが混ざってしまう。
		coverage += clamp((sectorEnd - angle) / width + 0.5, 0.0, 1.0)
			- clamp((sectorStart - angle) / width + 0.5, 0.0, 1.0);
	}
	return clamp(coverage, 0.0, 1.0);
}

@fragment
fn fsMask(@location(0) position: vec2f) -> @location(0) f32 {
	return transitionMask(position);
}
