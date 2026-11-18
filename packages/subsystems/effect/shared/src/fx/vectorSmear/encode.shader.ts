import colorSpace from '@gs/shared/gpu/color-space.wgsl?raw';

export default colorSpace + `
@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let color = read_input(position);
	return colorReplaceRgb(color, colorLinearToSrgb(colorUnpremultiply(color)));
}
`;
