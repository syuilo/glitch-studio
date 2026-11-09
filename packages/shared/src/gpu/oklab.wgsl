// CPUのcolor-space.tsと同じ、Björn Ottossonのlinear sRGB変換を使う。
// https://bottosson.github.io/posts/oklab/
// 入力は未乗算のlinear sRGB。作業色空間ですでにlinear化されているため、
// sRGBの伝達関数を再適用すると解析する色と明度が変わってしまう。
fn linearSrgbToOklab(linear: vec3f) -> vec3f {
	let lms = vec3f(dot(vec3f(0.4122214708, 0.5363325363, 0.0514459929), linear),
		dot(vec3f(0.2119034982, 0.6806995451, 0.1073969566), linear),
		dot(vec3f(0.0883024619, 0.2817188376, 0.6299787005), linear));
	// 負値を持つlinear sRGBも符号付きの立方根で扱い、HDRや色域外の値をclampしない。
	let root = sign(lms) * pow(abs(lms), vec3f(1.0 / 3.0));
	return vec3f(dot(vec3f(0.2104542553, 0.7936177850, -0.0040720468), root),
		dot(vec3f(1.9779984951, -2.4285922050, 0.4505937099), root),
		dot(vec3f(0.0259040371, 0.7827717662, -0.8086757660), root));
}

fn oklabToLinearSrgb(color: vec3f) -> vec3f {
	let root = vec3f(color.x + 0.3963377774 * color.y + 0.2158037573 * color.z,
		color.x - 0.1055613458 * color.y - 0.0638541728 * color.z,
		color.x - 0.0894841775 * color.y - 1.2914855480 * color.z);
	let lms = root * root * root;
	return vec3f(dot(vec3f(4.0767416621, -3.3077115913, 0.2309699292), lms),
		dot(vec3f(-1.2684380046, 2.6097574011, -0.3413193965), lms),
		dot(vec3f(-0.0041960863, -0.7034186147, 1.7076147010), lms));
}
