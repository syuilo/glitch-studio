// モード番号はcolor-blend.wgslと共通。
export const colorBlendModes = {
	normal: 0, add: 1, subtract: 2, multiply: 3, darken: 4, lighten: 5,
	screen: 6, overlay: 7, difference: 8, exclusion: 9, none: 10,
	colorBurn: 11, colorDodge: 12, softLight: 13, hardLight: 14,
	hue: 15, saturation: 16, color: 17, luminosity: 18, replace: 19, emission: 20,
} as const;

export type BlendMode = keyof typeof colorBlendModes;

export function isBlendMode(value: unknown): value is BlendMode {
	return typeof value === 'string' && Object.hasOwn(colorBlendModes, value);
}
