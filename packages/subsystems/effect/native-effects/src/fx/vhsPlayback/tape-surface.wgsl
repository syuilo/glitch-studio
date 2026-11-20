fn tapeMapPosition(point: vec2f, mapping: vec4f) -> vec2f {
	return vec2f(mapping.x + point.x * mapping.y, point.y * mapping.z);
}

fn displacementAt(point: vec2f) -> vec2f {
	// 公開ベクトルはテープ領域の長辺全体=1の等方単位。X/Yへ同じ倍率を掛けて
	// メートルへ戻し、細長いテープ領域でも変位の方向や長さを歪ませない。
	return read_tapeDisplacement(tapeMapPosition(point, uniforms.tapeDisplacementMapping)) * uniforms.displacementScaleMeters;
}

fn damageEnvelope(linePosition: f32) -> f32 {
	let cell = i32(floor(linePosition));
	var envelope = 1.0;
	for (var previous = 0; previous <= 1; previous++) {
		let cellId = uniforms.tapeCell + bitcast<u32>(cell - previous);
		let eventSeed = hash(cellId ^ uniforms.seed);
		if (random(eventSeed, 11u) < uniforms.dropoutProbability) {
			let start = f32(cell - previous) + random(eventSeed, 23u);
			let distance = (linePosition - start) * f32(RF_SAMPLES);
			let duration = uniforms.dropoutSamples * (0.5 + random(eventSeed, 37u));
			let edge = min(2.0, duration * 0.2);
			let covered = smoothstep(0.0, edge, distance) * (1.0 - smoothstep(duration - edge, duration, distance));
			envelope *= 1.0 - uniforms.dropoutDepth * covered;
		}
	}
	return envelope;
}

@compute @workgroup_size(64)
fn resolveTapeSurface(@builtin(global_invocation_id) id: vec3u) {
	if (id.x >= RF_SAMPLES || id.y >= LINE_COUNT) { return; }
	let fraction = (f32(id.x) + 0.5) / f32(RF_SAMPLES);
	let line = lines[id.y];
	let head = mix(line.tapeSurface.xy, line.tapeSurface.zw, fraction);
	var material = head;
	var displacement = displacementAt(material);
	if (any(displacement != vec2f(0.0))) {
		// 前方変形 F(q)=q+u(q) の逆写像を、小変形に対する固定点反復で求める。
		// uをヘッド位置で1度引くだけでは、伸縮した媒体の読取時刻が誤ってしまう。
		// |grad u|<1の滑らかな変形を対象とし、前フレームの推定値は使わない。
		for (var iteration = 0u; iteration < 10u; iteration++) {
			material = head - displacement;
			let nextDisplacement = displacementAt(material);
			let change = nextDisplacement - displacement;
			displacement = nextDisplacement;
			if (dot(change, change) < 1e-16) { break; }
		}
	}
	let residual = material + displacement - head;
	let solved = all(abs(material) < vec2f(1000.0)) && dot(residual, residual) <= 4e-16;
	// 反転・重なり・急峻な場は初期モデルの範囲外。逆写像できない区間は読取信号を
	// 失ったものとして扱い、NaNの座標を後段へ送らない。
	material = select(head, material, solved);
	let shift = material - head;
	let baseCoordinate = f32(id.y * RF_SAMPLES + id.x) + mix(line.transport.x, line.transport.y, fraction);
	let coordinate = baseCoordinate + dot(shift, TRACK_TANGENT) * RF_SAMPLES_PER_METER;
	var gain = mix(line.transport.z, line.transport.w, fraction);
	if (any(shift != vec2f(0.0))) {
		// 軌跡に沿う変位は時刻、軌跡に直交する変位はトラックとの重なりを変える。
		// 接触率を分離して保持しているため、元は外れていたトラックへ戻る場合も扱える。
		let tracking = mix(line.contactTracking.z, line.contactTracking.w, fraction) + dot(shift, TRACK_NORMAL) / TRACK_PITCH;
		gain = mix(line.contactTracking.x, line.contactTracking.y, fraction) * max(0.0, 1.0 - abs(tracking));
	}
	let damage = clamp(read_tapeDamage(tapeMapPosition(material, uniforms.tapeDamageMapping)), 0.0, 1.0);
	let separation = clamp(read_headSeparation(tapeMapPosition(material, uniforms.headSeparationMapping)), 0.0, 1.0);
	let valid = solved && coordinate >= 0.0 && coordinate <= f32(RF_SAMPLES * LINE_COUNT - 1u);
	var envelope = gain * (1.0 - damage) * damageEnvelope(uniforms.tapeFraction + (coordinate + 0.5) / f32(RF_SAMPLES));
	if (!valid) { envelope = 0.0; }
	surfaceSamples[id.y * RF_SAMPLES + id.x] = vec4f(coordinate, envelope, separation, select(0.0, 1.0, valid));
}
