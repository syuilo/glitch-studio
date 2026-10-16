fn rgbToHsl(color: vec3f) -> vec3f {
	let maximum = max(max(color.r, color.g), color.b);
	let minimum = min(min(color.r, color.g), color.b);
	let lightness = (maximum + minimum) * 0.5;
	var saturation = 0.0;
	var hue = 0.0;
	if (maximum != minimum) {
		let difference = maximum - minimum;
		if (lightness > 0.5) {
			saturation = difference / (2.0 - maximum - minimum);
		} else {
			saturation = difference / (maximum + minimum);
		}
		if (maximum == color.r) {
			hue = (color.g - color.b) / difference + select(0.0, 6.0, color.g < color.b);
		} else if (maximum == color.g) {
			hue = (color.b - color.r) / difference + 2.0;
		} else {
			hue = (color.r - color.g) / difference + 4.0;
		}
		hue /= 6.0;
	}
	return vec3f(hue, saturation, lightness);
}

fn hueToRgb(p: f32, q: f32, hue: f32) -> f32 {
	var t = hue;
	if (t < 0.0) { t += 1.0; }
	if (t > 1.0) { t -= 1.0; }
	if (t < 1.0 / 6.0) { return p + (q - p) * 6.0 * t; }
	if (t < 1.0 / 2.0) { return q; }
	if (t < 2.0 / 3.0) { return p + (q - p) * (2.0 / 3.0 - t) * 6.0; }
	return p;
}

fn hslToRgb(hsl: vec3f) -> vec3f {
	let hue = hsl.x;
	let saturation = hsl.y;
	let lightness = hsl.z;
	if (saturation == 0.0) { return vec3f(lightness); }
	var q = lightness + saturation - lightness * saturation;
	if (lightness < 0.5) { q = lightness * (1.0 + saturation); }
	let p = 2.0 * lightness - q;
	return vec3f(hueToRgb(p, q, hue + 1.0 / 3.0), hueToRgb(p, q, hue), hueToRgb(p, q, hue - 1.0 / 3.0));
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let input = read_input(position);
	let brightness = read_brightness(position);
	let lightness = read_lightness(position);
	let contrast = read_contrast(position);
	// Angleの1は180度。HSLの色相は1周が1なので、移植元と同じく半分にする。
	let hue = read_hue(position) * 0.5;
	let saturation = read_saturation(position);
	// 色調整は未乗算RGBで行う。透明画素は除算せず、明度の加算で色が漏れることも防ぐ。
	if (input.a <= 0.0) { return vec4f(0.0); }
	var color = input.rgb / input.a;
	color *= brightness;
	color += vec3f(lightness);
	color = (color - vec3f(0.5)) * contrast + vec3f(0.5);
	var hsl = rgbToHsl(color);
	// fractはGLSLのmod(x, 1)と同様に、負の色相も0〜1へ折り返す。
	hsl.x = fract(hsl.x + hue);
	hsl.y = clamp(hsl.y * saturation, 0.0, 1.0);
	color = hslToRgb(hsl);
	return vec4f(color * input.a, input.a);
}
