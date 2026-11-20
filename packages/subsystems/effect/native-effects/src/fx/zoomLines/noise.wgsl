fn mod289_3(x: vec3f) -> vec3f {
	return x - floor(x * (1.0 / 289.0)) * 289.0;
}

fn mod289_4(x: vec4f) -> vec4f {
	return x - floor(x * (1.0 / 289.0)) * 289.0;
}

fn permute(x: vec4f) -> vec4f {
	return mod289_4(((x * 34.0) + vec4f(10.0)) * x);
}

fn snoise(v: vec3f) -> f32 {
	let c = vec2f(1.0 / 6.0, 1.0 / 3.0);
	let d = vec4f(0.0, 0.5, 1.0, 2.0);
	var i = floor(v + vec3f(dot(v, c.yyy)));
	let x0 = v - i + vec3f(dot(i, c.xxx));
	let g = step(x0.yzx, x0.xyz);
	let l = vec3f(1.0) - g;
	let i1 = min(g.xyz, l.zxy);
	let i2 = max(g.xyz, l.zxy);
	let x1 = x0 - i1 + c.xxx;
	let x2 = x0 - i2 + c.yyy;
	let x3 = x0 - d.yyy;
	i = mod289_3(i);
	let p = permute(permute(permute(
		vec4f(i.z) + vec4f(0.0, i1.z, i2.z, 1.0))
		+ vec4f(i.y) + vec4f(0.0, i1.y, i2.y, 1.0))
		+ vec4f(i.x) + vec4f(0.0, i1.x, i2.x, 1.0));
	let ns = 0.142857142857 * d.wyz - d.xzx;
	let j = p - 49.0 * floor(p * ns.z * ns.z);
	let xIndex = floor(j * ns.z);
	let yIndex = floor(j - 7.0 * xIndex);
	let x = xIndex * ns.x + ns.yyyy;
	let y = yIndex * ns.x + ns.yyyy;
	let h = vec4f(1.0) - abs(x) - abs(y);
	let b0 = vec4f(x.xy, y.xy);
	let b1 = vec4f(x.zw, y.zw);
	let s0 = floor(b0) * 2.0 + vec4f(1.0);
	let s1 = floor(b1) * 2.0 + vec4f(1.0);
	let sh = -step(h, vec4f(0.0));
	let a0 = b0.xzyw + s0.xzyw * sh.xxyy;
	let a1 = b1.xzyw + s1.xzyw * sh.zzww;
	var p0 = vec3f(a0.xy, h.x);
	var p1 = vec3f(a0.zw, h.y);
	var p2 = vec3f(a1.xy, h.z);
	var p3 = vec3f(a1.zw, h.w);
	let norm = vec4f(1.79284291400159) - 0.85373472095314 * vec4f(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3));
	p0 *= norm.x;
	p1 *= norm.y;
	p2 *= norm.z;
	p3 *= norm.w;
	var m = max(vec4f(0.5) - vec4f(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), vec4f(0.0));
	m *= m;
	return 105.0 * dot(m * m, vec4f(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
