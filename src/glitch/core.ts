export type Pixel = [number, number, number];

export type FX = (
	width: number, height: number,
	get: (x: number, y: number) => Pixel,
	set: (x: number, y: number, color: Pixel) => void,
	params: Record<string, any>
) => void;

export function fx(name: string, fx: FX) {
	return (input) => {
		const output = input.clone();

		function get(x: number, y: number) {
			const idx = (input.bitmap.width * y + x) << 2;
			return [input.bitmap.data[idx + 0], input.bitmap.data[idx + 1], input.bitmap.data[idx + 2]] as Pixel;
		}

		function set(x: number, y: number, rgb: Pixel) {
			const idx = (input.bitmap.width * y + x) << 2;
			output.bitmap.data[idx + 0] = rgb[0];
			output.bitmap.data[idx + 1] = rgb[1];
			output.bitmap.data[idx + 2] = rgb[2];
		}

		const label = `FX: ${name}`;
		console.time(label);
		fx(input.bitmap.width, input.bitmap.height, get, set, {});
		console.timeEnd(label);

		return output;
	}
}
