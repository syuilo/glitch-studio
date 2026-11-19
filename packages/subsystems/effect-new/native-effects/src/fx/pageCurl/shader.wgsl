struct Uniforms {
	halfExtent: vec2f,
	axis: vec2f,
	pixelSize: f32,
	curlRadius: f32,
	backMode: u32,
	shadowOpacity: f32,
	shadowSoftness: f32,
	shading: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
const PI: f32 = 3.141592653589793;

fn materialPosition(spatialPosition: vec2f, coordinate: f32, materialCoordinate: f32) -> vec2f {
	let position = (spatialPosition + uniforms.axis * (materialCoordinate - coordinate)) / uniforms.halfExtent;
	// 紙は有限の矩形。AAや曲面の逆参照が端へ近づいても反対側の画素を巻き込まない。
	// この矩形内でのFit / Wrap / Filterは、引き続き接続のサンプリング規約に従う。
	let limit = vec2f(1.0) - vec2f(uniforms.pixelSize * 0.5) / uniforms.halfExtent;
	return clamp(position, -limit, limit);
}

fn backColor(position: vec2f) -> vec4f {
	if (uniforms.backMode == 1u) { return read_backColor(position); }
	if (uniforms.backMode == 2u) { return read_backInput(position); }
	let front = read_inputA(position);
	let paper = read_backColor(position);
	// 紙色へ70%寄せて印刷が薄く透ける裏面を作る。紙色のalphaは染色の強さであり、
	// A自体のalphaは変えない。未乗算化せず計算し、透明画素のRGBを増やさない。
	return vec4f(front.rgb * (1.0 - 0.7 * paper.a) + paper.rgb * (0.7 * front.a), front.a);
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let progress = clamp(read_progress(position), 0.0, 1.0);
	if (progress <= 0.0) { return read_inputA(position); }
	if (progress >= 1.0) { return read_inputB(position); }
	let spatialPosition = position * uniforms.halfExtent;
	let pageLength = 2.0 * dot(abs(uniforms.axis), uniforms.halfExtent);
	let coordinate = dot(spatialPosition, uniforms.axis) + pageLength * 0.5;
	let radius = uniforms.curlRadius;
	let crease = mix(pageLength, -radius, progress);

	// 紙の材料座標uに対し、折り目cまでは平面、その先は半円筒、さらに先は裏返った平面。
	// 円筒は x=c+r*sin(theta), z=r*(1-cos(theta)), theta=(u-c)/r。
	// 視点を正面に固定すると逆参照を解析的に解け、メッシュや履歴を持たずに済む。
	let frontAngles = clamp(vec2f(-crease, pageLength - crease) / radius, vec2f(0.0), vec2f(PI * 0.5));
	let backAngles = clamp(vec2f(-crease, pageLength - crease) / radius, vec2f(PI * 0.5), vec2f(PI));
	let frontCurve = vec2f(crease) + radius * sin(frontAngles);
	let backCurve = vec2f(crease) + radius * max(sin(backAngles.yx), vec2f(0.0));
	let backPlane = vec2f(2.0 * crease + PI * radius) - vec2f(pageLength, clamp(crease + PI * radius, 0.0, pageLength));
	var backStart = pageLength + radius;
	if (backAngles.y > backAngles.x) { backStart = backCurve.x; }
	if (backPlane.y > backPlane.x) { backStart = min(backStart, backPlane.x); }

	// 裏面の方が必ず高い。先に見える区間を切り出し、表裏の被覆を二重に足さない。
	// 特に円筒の外縁で、前面0.5＋背面0.5を順に重ねて0.75にするAAは誤りになる。
	let visibleFrontPlane = vec2f(0.0, max(0.0, min(min(crease, pageLength), backStart)));
	let visibleFrontCurve = vec2f(frontCurve.x, max(frontCurve.x, min(frontCurve.y, backStart)));
	let patches = array<vec2f, 4>(visibleFrontPlane, visibleFrontCurve, backCurve, backPlane);
	let pixelStart = coordinate - uniforms.pixelSize * 0.5;
	let pixelEnd = coordinate + uniforms.pixelSize * 0.5;
	var pageColor = vec4f(0.0);
	var pageCoverage = 0.0;
	var pageEnd = 0.0;
	for (var index = 0u; index < 4u; index++) {
		let interval = patches[index];
		if (interval.y <= interval.x) { continue; }
		pageEnd = max(pageEnd, interval.y);
		let start = max(pixelStart, interval.x);
		let end = min(pixelEnd, interval.y);
		if (end <= start) { continue; }
		let coverage = clamp((interval.y - coordinate) / uniforms.pixelSize + 0.5, 0.0, 1.0)
			- clamp((interval.x - coordinate) / uniforms.pixelSize + 0.5, 0.0, 1.0);
		// 画素と可視区間の交差面積でAAし、その重心を逆参照する。
		// サブサンプルの段階的な切替がないため、細い裏面も滑らかに現れる。
		let sampleCoordinate = select((start + end) * 0.5, coordinate, coverage >= 1.0);
		var materialCoordinate = sampleCoordinate;
		var angle = 0.0;
		if (index == 1u || index == 2u) {
			angle = asin(clamp((sampleCoordinate - crease) / radius, 0.0, 1.0));
			if (index == 2u) { angle = PI - angle; }
			materialCoordinate = crease + radius * angle;
		} else if (index == 3u) {
			materialCoordinate = 2.0 * crease + PI * radius - sampleCoordinate;
			angle = PI;
		}
		let sourcePosition = materialPosition(spatialPosition, coordinate, clamp(materialCoordinate, 0.0, pageLength));
		var color: vec4f;
		if (index >= 2u) { color = backColor(sourcePosition); } else { color = read_inputA(sourcePosition); }
		// 正面光＋環境光の固定照明。平らな面は明るさを保ち、曲面の法線だけを陰影へ使う。
		let lighting = 1.0 - uniforms.shading * 0.45 * (1.0 - abs(cos(angle)));
		pageColor += vec4f(color.rgb * lighting, color.a) * coverage;
		pageCoverage += coverage;
	}

	var background = read_inputB(position);
	if (pageCoverage < 1.0 && uniforms.shadowOpacity > 0.0 && pageEnd > 0.0) {
		// 紙の外縁からB側へ落とす近似影。浮き上がりが小さいときと、紙が画面を
		// 離れるときに減衰させ、Shadow Softnessを変えてもめくりの軌道を変えない。
		let tipAngle = clamp((pageLength - crease) / radius, 0.0, PI * 0.5);
		let height = radius * (1.0 - cos(tipAngle));
		let reach = max(height * 0.6 + uniforms.shadowSoftness, 0.0000001);
		let fade = smoothstep(0.0, radius, pageEnd) * height / (radius + uniforms.shadowSoftness);
		let casterPosition = materialPosition(spatialPosition, coordinate, clamp(crease + radius * tipAngle, 0.0, pageLength));
		let casterAlpha = clamp(read_inputA(casterPosition).a, 0.0, 1.0);
		let shadow = uniforms.shadowOpacity * fade * casterAlpha * (1.0 - smoothstep(pageEnd, pageEnd + reach, coordinate));
		background = vec4f(background.rgb * (1.0 - shadow), background.a);
	}
	// alphaによるsource-overではなく紙の面積で置換する。透明な紙の下にBを透かさず、
	// 元のA/B端点と整合させる。微小な丸めによる被覆率の1超えだけを正規化する。
	return (pageColor + background * max(0.0, 1.0 - pageCoverage)) / max(1.0, pageCoverage);
}
