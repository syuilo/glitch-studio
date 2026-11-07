import type { ColorRampStop } from '@gs/shared/color-ramp.ts';

export type ColorRampPreset = {
	readonly id: string;
	readonly stops: readonly {
		readonly position: ColorRampStop['position'];
		readonly color: Readonly<ColorRampStop['color']>;
	}[];
};

// プリセットは配色だけを所有し、補間方法・補間色空間・色相経路は適用先の設定を使う。
// RGBAはColorRampStopと同じ未乗算sRGB。透明なstopにも色を残して色相経路を保つ。
// 定義を編集値と共有しないよう、適用時に色配列までコピーしてstop IDを新規発行する。
export const COLOR_RAMP_PRESETS: readonly ColorRampPreset[] = [
	// 無彩色
	{
		id: 'black-white',
		stops: [
			{ position: 0, color: [0, 0, 0, 1] },
			{ position: 1, color: [1, 1, 1, 1] },
		],
	},
	{
		id: 'white-black',
		stops: [
			{ position: 0, color: [1, 1, 1, 1] },
			{ position: 1, color: [0, 0, 0, 1] },
		],
	},
	{
		id: 'black-white-black',
		stops: [
			{ position: 0, color: [0, 0, 0, 1] },
			{ position: 0.5, color: [1, 1, 1, 1] },
			{ position: 1, color: [0, 0, 0, 1] },
		],
	},
	{
		id: 'white-black-white',
		stops: [
			{ position: 0, color: [1, 1, 1, 1] },
			{ position: 0.5, color: [0, 0, 0, 1] },
			{ position: 1, color: [1, 1, 1, 1] },
		],
	},

	// 透明度
	{
		id: 'transparent-white',
		stops: [
			{ position: 0, color: [1, 1, 1, 0] },
			{ position: 1, color: [1, 1, 1, 1] },
		],
	},
	{
		id: 'white-transparent',
		stops: [
			{ position: 0, color: [1, 1, 1, 1] },
			{ position: 1, color: [1, 1, 1, 0] },
		],
	},
	{
		id: 'transparent-black',
		stops: [
			{ position: 0, color: [0, 0, 0, 0] },
			{ position: 1, color: [0, 0, 0, 1] },
		],
	},
	{
		id: 'white-alpha-pulse',
		stops: [
			{ position: 0, color: [1, 1, 1, 0] },
			{ position: 0.35, color: [1, 1, 1, 1] },
			{ position: 0.65, color: [1, 1, 1, 1] },
			{ position: 1, color: [1, 1, 1, 0] },
		],
	},

	// ヒートマップ向けの連続配色。元の256色LUTをsRGBで線形補間し、17点でサンプリングした近似。
	// 補間設定は適用先が所有するため、設定によって元のカラーマップとは見え方が異なる。
	// 出典: https://github.com/BIDS/colormap/blob/master/colormaps.py (CC0)
	// Nathaniel J. Smith, Stefan van der Walt, Eric Firing (Viridis)。
	// https://creativecommons.org/publicdomain/zero/1.0/
	{
		id: 'viridis',
		stops: [
			{ position: 0, color: [0.267004, 0.004874, 0.329415, 1] },
			{ position: 0.0625, color: [0.282302, 0.094624, 0.417024, 1] },
			{ position: 0.125, color: [0.278919, 0.174879, 0.482972, 1] },
			{ position: 0.1875, color: [0.259266, 0.250672, 0.524378, 1] },
			{ position: 0.25, color: [0.230223, 0.321297, 0.545488, 1] },
			{ position: 0.3125, color: [0.199995, 0.386377, 0.554533, 1] },
			{ position: 0.375, color: [0.173302, 0.447386, 0.55785, 1] },
			{ position: 0.4375, color: [0.149668, 0.50644, 0.557329, 1] },
			{ position: 0.5, color: [0.128148, 0.565107, 0.550893, 1] },
			{ position: 0.5625, color: [0.120325, 0.623765, 0.534308, 1] },
			{ position: 0.625, color: [0.155378, 0.681539, 0.50324, 1] },
			{ position: 0.6875, color: [0.241467, 0.736626, 0.454543, 1] },
			{ position: 0.75, color: [0.362859, 0.786695, 0.386589, 1] },
			{ position: 0.8125, color: [0.508094, 0.829231, 0.299221, 1] },
			{ position: 0.875, color: [0.669358, 0.862217, 0.195444, 1] },
			{ position: 0.9375, color: [0.835913, 0.88611, 0.102462, 1] },
			{ position: 1, color: [0.993248, 0.906157, 0.143936, 1] },
		],
	},
	{
		id: 'inferno',
		stops: [
			{ position: 0, color: [0.001462, 0.000466, 0.013866, 1] },
			{ position: 0.0625, color: [0.041966, 0.028, 0.140584, 1] },
			{ position: 0.125, color: [0.128488, 0.047323, 0.289642, 1] },
			{ position: 0.1875, color: [0.23701, 0.036581, 0.395612, 1] },
			{ position: 0.25, color: [0.339929, 0.061759, 0.4292, 1] },
			{ position: 0.3125, color: [0.439263, 0.098629, 0.431733, 1] },
			{ position: 0.375, color: [0.538581, 0.133906, 0.415702, 1] },
			{ position: 0.4375, color: [0.63745, 0.170368, 0.38222, 1] },
			{ position: 0.5, color: [0.732796, 0.214332, 0.332053, 1] },
			{ position: 0.5625, color: [0.819548, 0.27281, 0.268507, 1] },
			{ position: 0.625, color: [0.891827, 0.349998, 0.196523, 1] },
			{ position: 0.6875, color: [0.945122, 0.444778, 0.118766, 1] },
			{ position: 0.75, color: [0.977424, 0.552622, 0.03802, 1] },
			{ position: 0.8125, color: [0.987932, 0.669158, 0.059628, 1] },
			{ position: 0.875, color: [0.975924, 0.790939, 0.197307, 1] },
			{ position: 0.9375, color: [0.948615, 0.910906, 0.39625, 1] },
			{ position: 1, color: [0.988362, 0.998364, 0.644924, 1] },
		],
	},
	{
		id: 'magma',
		stops: [
			{ position: 0, color: [0.001462, 0.000466, 0.013866, 1] },
			{ position: 0.0625, color: [0.039352, 0.030922, 0.132996, 1] },
			{ position: 0.125, color: [0.112445, 0.065347, 0.275597, 1] },
			{ position: 0.1875, color: [0.210446, 0.062164, 0.41731, 1] },
			{ position: 0.25, color: [0.315086, 0.071193, 0.484831, 1] },
			{ position: 0.3125, color: [0.412809, 0.109649, 0.504471, 1] },
			{ position: 0.375, color: [0.510505, 0.147346, 0.507707, 1] },
			{ position: 0.4375, color: [0.610826, 0.180922, 0.498954, 1] },
			{ position: 0.5, color: [0.713175, 0.21389, 0.476245, 1] },
			{ position: 0.5625, color: [0.813506, 0.254188, 0.438061, 1] },
			{ position: 0.625, color: [0.901325, 0.316489, 0.38995, 1] },
			{ position: 0.6875, color: [0.959241, 0.413511, 0.359894, 1] },
			{ position: 0.75, color: [0.985945, 0.530006, 0.380081, 1] },
			{ position: 0.8125, color: [0.995864, 0.647716, 0.442271, 1] },
			{ position: 0.875, color: [0.997004, 0.763297, 0.52958, 1] },
			{ position: 0.9375, color: [0.992807, 0.877616, 0.633546, 1] },
			{ position: 1, color: [0.987053, 0.991438, 0.749504, 1] },
		],
	},
	{
		id: 'plasma',
		stops: [
			{ position: 0, color: [0.050383, 0.029803, 0.527975, 1] },
			{ position: 0.0625, color: [0.192926, 0.018382, 0.590136, 1] },
			{ position: 0.125, color: [0.299058, 0.009643, 0.631357, 1] },
			{ position: 0.1875, color: [0.398266, 0.000907, 0.655958, 1] },
			{ position: 0.25, color: [0.493422, 0.011524, 0.658032, 1] },
			{ position: 0.3125, color: [0.582715, 0.067241, 0.633535, 1] },
			{ position: 0.375, color: [0.663346, 0.136908, 0.586853, 1] },
			{ position: 0.4375, color: [0.7342, 0.207503, 0.529524, 1] },
			{ position: 0.5, color: [0.796382, 0.277983, 0.471328, 1] },
			{ position: 0.5625, color: [0.851489, 0.349019, 0.415657, 1] },
			{ position: 0.625, color: [0.900043, 0.422153, 0.361787, 1] },
			{ position: 0.6875, color: [0.941027, 0.499204, 0.30814, 1] },
			{ position: 0.75, color: [0.97223, 0.581727, 0.254083, 1] },
			{ position: 0.8125, color: [0.990809, 0.670645, 0.201044, 1] },
			{ position: 0.875, color: [0.993426, 0.766277, 0.156631, 1] },
			{ position: 0.9375, color: [0.976151, 0.868429, 0.143395, 1] },
			{ position: 1, color: [0.940015, 0.975158, 0.131326, 1] },
		],
	},

	// 淡色から濃色へ変化するヒートマップ。白い背景でも低い値を目立たせずに表示できる。
	{
		id: 'heatmap-blues',
		stops: [
			{ position: 0, color: [0.96, 0.98, 1, 1] },
			{ position: 0.2, color: [0.78, 0.89, 0.98, 1] },
			{ position: 0.4, color: [0.48, 0.73, 0.91, 1] },
			{ position: 0.6, color: [0.22, 0.52, 0.78, 1] },
			{ position: 0.8, color: [0.08, 0.31, 0.58, 1] },
			{ position: 1, color: [0.025, 0.12, 0.3, 1] },
		],
	},
	{
		id: 'heatmap-greens',
		stops: [
			{ position: 0, color: [0.97, 0.99, 0.94, 1] },
			{ position: 0.2, color: [0.79, 0.91, 0.69, 1] },
			{ position: 0.4, color: [0.48, 0.76, 0.47, 1] },
			{ position: 0.6, color: [0.24, 0.58, 0.32, 1] },
			{ position: 0.8, color: [0.08, 0.37, 0.23, 1] },
			{ position: 1, color: [0.015, 0.16, 0.13, 1] },
		],
	},
	{
		id: 'heatmap-oranges',
		stops: [
			{ position: 0, color: [1, 0.98, 0.92, 1] },
			{ position: 0.2, color: [1, 0.88, 0.65, 1] },
			{ position: 0.4, color: [1, 0.69, 0.36, 1] },
			{ position: 0.6, color: [0.93, 0.44, 0.13, 1] },
			{ position: 0.8, color: [0.71, 0.22, 0.035, 1] },
			{ position: 1, color: [0.37, 0.08, 0.015, 1] },
		],
	},
	{
		id: 'heatmap-purples',
		stops: [
			{ position: 0, color: [0.99, 0.97, 1, 1] },
			{ position: 0.2, color: [0.89, 0.82, 0.95, 1] },
			{ position: 0.4, color: [0.72, 0.59, 0.85, 1] },
			{ position: 0.6, color: [0.53, 0.35, 0.7, 1] },
			{ position: 0.8, color: [0.33, 0.16, 0.51, 1] },
			{ position: 1, color: [0.15, 0.035, 0.28, 1] },
		],
	},
	{
		id: 'heatmap-yellow-red',
		stops: [
			{ position: 0, color: [1, 1, 0.8, 1] },
			{ position: 0.2, color: [1, 0.87, 0.45, 1] },
			{ position: 0.4, color: [1, 0.62, 0.18, 1] },
			{ position: 0.6, color: [0.94, 0.29, 0.08, 1] },
			{ position: 0.8, color: [0.69, 0.075, 0.07, 1] },
			{ position: 1, color: [0.32, 0.005, 0.05, 1] },
		],
	},
	{
		id: 'heatmap-yellow-blue',
		stops: [
			{ position: 0, color: [1, 1, 0.82, 1] },
			{ position: 0.2, color: [0.72, 0.91, 0.72, 1] },
			{ position: 0.4, color: [0.35, 0.78, 0.75, 1] },
			{ position: 0.6, color: [0.12, 0.58, 0.72, 1] },
			{ position: 0.8, color: [0.08, 0.32, 0.6, 1] },
			{ position: 1, color: [0.06, 0.1, 0.32, 1] },
		],
	},

	// 差分・偏差向け。正負の境界は位置0.5に置き、両端ほど中央からの差が大きい配色にする。
	{
		id: 'heatmap-ice-fire',
		stops: [
			{ position: 0, color: [0.035, 0.08, 0.28, 1] },
			{ position: 0.2, color: [0.02, 0.35, 0.62, 1] },
			{ position: 0.4, color: [0.4, 0.8, 0.9, 1] },
			{ position: 0.5, color: [0.97, 0.97, 0.92, 1] },
			{ position: 0.6, color: [1, 0.72, 0.37, 1] },
			{ position: 0.8, color: [0.85, 0.26, 0.08, 1] },
			{ position: 1, color: [0.32, 0.015, 0.025, 1] },
		],
	},
	{
		id: 'heatmap-brown-teal',
		stops: [
			{ position: 0, color: [0.25, 0.1, 0.025, 1] },
			{ position: 0.2, color: [0.6, 0.36, 0.14, 1] },
			{ position: 0.4, color: [0.87, 0.75, 0.5, 1] },
			{ position: 0.5, color: [0.96, 0.95, 0.88, 1] },
			{ position: 0.6, color: [0.55, 0.84, 0.78, 1] },
			{ position: 0.8, color: [0.12, 0.5, 0.49, 1] },
			{ position: 1, color: [0.015, 0.17, 0.2, 1] },
		],
	},
	{
		id: 'heatmap-purple-orange',
		stops: [
			{ position: 0, color: [0.21, 0.06, 0.38, 1] },
			{ position: 0.2, color: [0.52, 0.28, 0.68, 1] },
			{ position: 0.4, color: [0.8, 0.69, 0.86, 1] },
			{ position: 0.5, color: [0.98, 0.97, 0.92, 1] },
			{ position: 0.6, color: [1, 0.79, 0.5, 1] },
			{ position: 0.8, color: [0.86, 0.4, 0.12, 1] },
			{ position: 1, color: [0.42, 0.13, 0.025, 1] },
		],
	},
	{
		id: 'heatmap-blue-gray-red',
		stops: [
			{ position: 0, color: [0.35, 0.68, 1, 1] },
			{ position: 0.25, color: [0.12, 0.32, 0.58, 1] },
			{ position: 0.5, color: [0.08, 0.09, 0.12, 1] },
			{ position: 0.75, color: [0.6, 0.16, 0.12, 1] },
			{ position: 1, color: [1, 0.51, 0.27, 1] },
		],
	},

	// 温度帯の色分け向けの多色型と、黒・赤・黄・白の熱分布。
	{
		id: 'heatmap-spectrum',
		stops: [
			{ position: 0, color: [0.03, 0.02, 0.28, 1] },
			{ position: 0.15, color: [0.02, 0.15, 0.85, 1] },
			{ position: 0.35, color: [0, 0.75, 1, 1] },
			{ position: 0.55, color: [0.2, 0.9, 0.3, 1] },
			{ position: 0.75, color: [1, 0.9, 0.05, 1] },
			{ position: 0.9, color: [1, 0.35, 0.015, 1] },
			{ position: 1, color: [0.65, 0.005, 0.02, 1] },
		],
	},
	{
		id: 'heatmap-hot',
		stops: [
			{ position: 0, color: [0, 0, 0, 1] },
			{ position: 0.375, color: [1, 0, 0, 1] },
			{ position: 0.75, color: [1, 1, 0, 1] },
			{ position: 1, color: [1, 1, 1, 1] },
		],
	},

	// 暖色
	{
		id: 'ember',
		stops: [
			{ position: 0, color: [0.02, 0.005, 0, 1] },
			{ position: 0.4, color: [0.25, 0.015, 0.005, 1] },
			{ position: 0.75, color: [0.8, 0.12, 0.015, 1] },
			{ position: 1, color: [1, 0.55, 0.08, 1] },
		],
	},
	{
		id: 'flame',
		stops: [
			{ position: 0, color: [0, 0, 0, 1] },
			{ position: 0.3, color: [0.65, 0.015, 0.005, 1] },
			{ position: 0.6, color: [1, 0.3, 0.01, 1] },
			{ position: 0.85, color: [1, 0.85, 0.12, 1] },
			{ position: 1, color: [1, 1, 0.95, 1] },
		],
	},
	{
		id: 'lava',
		stops: [
			{ position: 0, color: [0.035, 0.01, 0.08, 1] },
			{ position: 0.35, color: [0.35, 0.015, 0.15, 1] },
			{ position: 0.7, color: [0.9, 0.08, 0.025, 1] },
			{ position: 0.9, color: [1, 0.5, 0.04, 1] },
			{ position: 1, color: [1, 0.9, 0.5, 1] },
		],
	},
	{
		id: 'golden-hour',
		stops: [
			{ position: 0, color: [0.18, 0.07, 0.12, 1] },
			{ position: 0.3, color: [0.55, 0.19, 0.13, 1] },
			{ position: 0.65, color: [0.95, 0.52, 0.18, 1] },
			{ position: 1, color: [1, 0.92, 0.65, 1] },
		],
	},
	{
		id: 'sunset',
		stops: [
			{ position: 0, color: [0.08, 0.04, 0.25, 1] },
			{ position: 0.3, color: [0.45, 0.1, 0.48, 1] },
			{ position: 0.6, color: [0.9, 0.24, 0.38, 1] },
			{ position: 0.82, color: [1, 0.55, 0.3, 1] },
			{ position: 1, color: [1, 0.88, 0.55, 1] },
		],
	},
	{
		id: 'peach',
		stops: [
			{ position: 0, color: [0.42, 0.12, 0.2, 1] },
			{ position: 0.35, color: [0.86, 0.38, 0.38, 1] },
			{ position: 0.7, color: [1, 0.68, 0.5, 1] },
			{ position: 1, color: [1, 0.94, 0.82, 1] },
		],
	},
	{
		id: 'rose',
		stops: [
			{ position: 0, color: [0.16, 0.015, 0.08, 1] },
			{ position: 0.4, color: [0.6, 0.08, 0.28, 1] },
			{ position: 0.75, color: [0.95, 0.42, 0.6, 1] },
			{ position: 1, color: [1, 0.9, 0.93, 1] },
		],
	},
	{
		id: 'plum',
		stops: [
			{ position: 0, color: [0.06, 0.025, 0.1, 1] },
			{ position: 0.35, color: [0.27, 0.08, 0.34, 1] },
			{ position: 0.7, color: [0.65, 0.29, 0.58, 1] },
			{ position: 1, color: [0.95, 0.78, 0.9, 1] },
		],
	},

	// 寒色・自然色
	{
		id: 'midnight',
		stops: [
			{ position: 0, color: [0.005, 0.01, 0.04, 1] },
			{ position: 0.4, color: [0.04, 0.08, 0.28, 1] },
			{ position: 0.75, color: [0.22, 0.3, 0.65, 1] },
			{ position: 1, color: [0.68, 0.75, 0.95, 1] },
		],
	},
	{
		id: 'ocean',
		stops: [
			{ position: 0, color: [0.005, 0.025, 0.12, 1] },
			{ position: 0.35, color: [0.015, 0.2, 0.45, 1] },
			{ position: 0.7, color: [0.02, 0.6, 0.72, 1] },
			{ position: 1, color: [0.68, 0.95, 0.98, 1] },
		],
	},
	{
		id: 'lagoon',
		stops: [
			{ position: 0, color: [0.015, 0.13, 0.18, 1] },
			{ position: 0.35, color: [0.01, 0.42, 0.44, 1] },
			{ position: 0.7, color: [0.16, 0.78, 0.65, 1] },
			{ position: 1, color: [0.85, 1, 0.8, 1] },
		],
	},
	{
		id: 'glacier',
		stops: [
			{ position: 0, color: [0.08, 0.17, 0.35, 1] },
			{ position: 0.4, color: [0.24, 0.52, 0.72, 1] },
			{ position: 0.75, color: [0.64, 0.88, 0.94, 1] },
			{ position: 1, color: [0.97, 1, 1, 1] },
		],
	},
	{
		id: 'mint',
		stops: [
			{ position: 0, color: [0.02, 0.16, 0.12, 1] },
			{ position: 0.35, color: [0.08, 0.48, 0.32, 1] },
			{ position: 0.7, color: [0.46, 0.85, 0.62, 1] },
			{ position: 1, color: [0.9, 1, 0.91, 1] },
		],
	},
	{
		id: 'forest',
		stops: [
			{ position: 0, color: [0.015, 0.04, 0.025, 1] },
			{ position: 0.35, color: [0.04, 0.22, 0.1, 1] },
			{ position: 0.7, color: [0.3, 0.55, 0.14, 1] },
			{ position: 1, color: [0.86, 0.94, 0.55, 1] },
		],
	},
	{
		id: 'moss',
		stops: [
			{ position: 0, color: [0.1, 0.09, 0.035, 1] },
			{ position: 0.35, color: [0.27, 0.32, 0.1, 1] },
			{ position: 0.7, color: [0.6, 0.64, 0.32, 1] },
			{ position: 1, color: [0.94, 0.92, 0.72, 1] },
		],
	},
	{
		id: 'earth',
		stops: [
			{ position: 0, color: [0.08, 0.035, 0.02, 1] },
			{ position: 0.35, color: [0.32, 0.16, 0.08, 1] },
			{ position: 0.7, color: [0.68, 0.46, 0.24, 1] },
			{ position: 1, color: [0.95, 0.88, 0.69, 1] },
		],
	},

	// 中央を境にした二方向の配色
	{
		id: 'blue-white-red',
		stops: [
			{ position: 0, color: [0.08, 0.2, 0.65, 1] },
			{ position: 0.25, color: [0.4, 0.65, 0.9, 1] },
			{ position: 0.5, color: [1, 1, 1, 1] },
			{ position: 0.75, color: [0.95, 0.55, 0.42, 1] },
			{ position: 1, color: [0.7, 0.06, 0.1, 1] },
		],
	},
	{
		id: 'teal-white-orange',
		stops: [
			{ position: 0, color: [0.005, 0.32, 0.38, 1] },
			{ position: 0.25, color: [0.3, 0.72, 0.72, 1] },
			{ position: 0.5, color: [1, 1, 1, 1] },
			{ position: 0.75, color: [1, 0.7, 0.34, 1] },
			{ position: 1, color: [0.8, 0.25, 0.025, 1] },
		],
	},
	{
		id: 'purple-white-green',
		stops: [
			{ position: 0, color: [0.3, 0.08, 0.5, 1] },
			{ position: 0.25, color: [0.7, 0.5, 0.82, 1] },
			{ position: 0.5, color: [1, 1, 1, 1] },
			{ position: 0.75, color: [0.5, 0.82, 0.48, 1] },
			{ position: 1, color: [0.04, 0.4, 0.16, 1] },
		],
	},
	{
		id: 'blue-black-red',
		stops: [
			{ position: 0, color: [0.08, 0.32, 1, 1] },
			{ position: 0.5, color: [0, 0, 0, 1] },
			{ position: 1, color: [1, 0.08, 0.03, 1] },
		],
	},
	{
		id: 'cyan-black-magenta',
		stops: [
			{ position: 0, color: [0, 1, 1, 1] },
			{ position: 0.5, color: [0, 0, 0, 1] },
			{ position: 1, color: [1, 0, 0.8, 1] },
		],
	},
	{
		id: 'purple-black-gold',
		stops: [
			{ position: 0, color: [0.6, 0.15, 0.95, 1] },
			{ position: 0.5, color: [0, 0, 0, 1] },
			{ position: 1, color: [1, 0.75, 0.08, 1] },
		],
	},

	// 多色・循環色
	{
		id: 'rainbow',
		stops: [
			{ position: 0, color: [0.55, 0, 1, 1] },
			{ position: 0.2, color: [0, 0.15, 1, 1] },
			{ position: 0.4, color: [0, 0.85, 1, 1] },
			{ position: 0.6, color: [0.15, 0.9, 0.05, 1] },
			{ position: 0.8, color: [1, 0.9, 0, 1] },
			{ position: 1, color: [1, 0.05, 0, 1] },
		],
	},
	{
		id: 'cyclic-rainbow',
		stops: [
			{ position: 0, color: [1, 0, 0, 1] },
			{ position: 0.166667, color: [1, 1, 0, 1] },
			{ position: 0.333333, color: [0, 1, 0, 1] },
			{ position: 0.5, color: [0, 1, 1, 1] },
			{ position: 0.666667, color: [0, 0, 1, 1] },
			{ position: 0.833333, color: [1, 0, 1, 1] },
			{ position: 1, color: [1, 0, 0, 1] },
		],
	},
	{
		id: 'neon',
		stops: [
			{ position: 0, color: [0.06, 0.005, 0.2, 1] },
			{ position: 0.25, color: [0.55, 0.01, 1, 1] },
			{ position: 0.5, color: [1, 0.02, 0.5, 1] },
			{ position: 0.75, color: [0.02, 0.9, 1, 1] },
			{ position: 1, color: [0.65, 1, 0.08, 1] },
		],
	},
	{
		id: 'aurora',
		stops: [
			{ position: 0, color: [0.015, 0.02, 0.12, 1] },
			{ position: 0.25, color: [0.25, 0.08, 0.5, 1] },
			{ position: 0.5, color: [0.06, 0.55, 0.65, 1] },
			{ position: 0.75, color: [0.2, 0.95, 0.55, 1] },
			{ position: 1, color: [0.85, 1, 0.7, 1] },
		],
	},
	{
		id: 'candy',
		stops: [
			{ position: 0, color: [0.6, 0.2, 0.85, 1] },
			{ position: 0.33, color: [1, 0.45, 0.7, 1] },
			{ position: 0.67, color: [1, 0.85, 0.45, 1] },
			{ position: 1, color: [0.4, 0.9, 0.85, 1] },
		],
	},
	{
		id: 'pastel-rainbow',
		stops: [
			{ position: 0, color: [0.8, 0.65, 0.95, 1] },
			{ position: 0.2, color: [0.6, 0.78, 1, 1] },
			{ position: 0.4, color: [0.6, 0.93, 0.85, 1] },
			{ position: 0.6, color: [0.85, 0.95, 0.6, 1] },
			{ position: 0.8, color: [1, 0.82, 0.6, 1] },
			{ position: 1, color: [1, 0.65, 0.75, 1] },
		],
	},

	// 二色の配色。画像の明暗を少数の色へ割り当てたい場合の出発点にする。
	{
		id: 'duotone-indigo-gold',
		stops: [
			{ position: 0, color: [0.12, 0.045, 0.32, 1] },
			{ position: 1, color: [1, 0.82, 0.22, 1] },
		],
	},
	{
		id: 'duotone-cyan-orange',
		stops: [
			{ position: 0, color: [0.015, 0.38, 0.55, 1] },
			{ position: 1, color: [1, 0.39, 0.12, 1] },
		],
	},
	{
		id: 'duotone-magenta-mint',
		stops: [
			{ position: 0, color: [0.58, 0.02, 0.4, 1] },
			{ position: 1, color: [0.56, 1, 0.75, 1] },
		],
	},
	{
		id: 'duotone-teal-coral',
		stops: [
			{ position: 0, color: [0.015, 0.18, 0.2, 1] },
			{ position: 1, color: [1, 0.49, 0.39, 1] },
		],
	},

	// 淡い自然色と鮮やかな発光色
	{
		id: 'cherry-blossom',
		stops: [
			{ position: 0, color: [0.12, 0.045, 0.13, 1] },
			{ position: 0.25, color: [0.4, 0.14, 0.28, 1] },
			{ position: 0.5, color: [0.82, 0.41, 0.6, 1] },
			{ position: 0.75, color: [1, 0.76, 0.81, 1] },
			{ position: 1, color: [1, 0.96, 0.91, 1] },
		],
	},
	{
		id: 'desert-dusk',
		stops: [
			{ position: 0, color: [0.08, 0.065, 0.2, 1] },
			{ position: 0.25, color: [0.32, 0.17, 0.33, 1] },
			{ position: 0.5, color: [0.7, 0.34, 0.3, 1] },
			{ position: 0.75, color: [0.94, 0.65, 0.39, 1] },
			{ position: 1, color: [1, 0.93, 0.72, 1] },
		],
	},
	{
		id: 'electric-violet',
		stops: [
			{ position: 0, color: [0.008, 0, 0.025, 1] },
			{ position: 0.25, color: [0.14, 0.015, 0.45, 1] },
			{ position: 0.5, color: [0.49, 0.025, 0.95, 1] },
			{ position: 0.75, color: [0.94, 0.2, 0.85, 1] },
			{ position: 1, color: [1, 0.85, 1, 1] },
		],
	},
	{
		id: 'acid-lime',
		stops: [
			{ position: 0, color: [0.01, 0.025, 0, 1] },
			{ position: 0.25, color: [0.035, 0.2, 0.025, 1] },
			{ position: 0.5, color: [0.22, 0.52, 0.01, 1] },
			{ position: 0.75, color: [0.66, 0.89, 0.015, 1] },
			{ position: 1, color: [0.97, 1, 0.56, 1] },
		],
	},

	// 金属・偏光風。明暗の折り返しと狭いハイライトをstopの配置で表現する。
	{
		id: 'copper',
		stops: [
			{ position: 0, color: [0.12, 0.045, 0.025, 1] },
			{ position: 0.3, color: [0.6, 0.26, 0.12, 1] },
			{ position: 0.46, color: [1, 0.82, 0.62, 1] },
			{ position: 0.54, color: [0.35, 0.1, 0.045, 1] },
			{ position: 0.8, color: [0.82, 0.43, 0.23, 1] },
			{ position: 1, color: [1, 0.92, 0.8, 1] },
		],
	},
	{
		id: 'gold',
		stops: [
			{ position: 0, color: [0.16, 0.09, 0.015, 1] },
			{ position: 0.3, color: [0.75, 0.48, 0.06, 1] },
			{ position: 0.46, color: [1, 0.97, 0.7, 1] },
			{ position: 0.54, color: [0.4, 0.22, 0.025, 1] },
			{ position: 0.8, color: [0.95, 0.73, 0.18, 1] },
			{ position: 1, color: [1, 0.98, 0.8, 1] },
		],
	},
	{
		id: 'silver',
		stops: [
			{ position: 0, color: [0.08, 0.1, 0.14, 1] },
			{ position: 0.3, color: [0.5, 0.55, 0.62, 1] },
			{ position: 0.46, color: [0.98, 0.99, 1, 1] },
			{ position: 0.54, color: [0.2, 0.23, 0.29, 1] },
			{ position: 0.8, color: [0.72, 0.76, 0.82, 1] },
			{ position: 1, color: [1, 1, 1, 1] },
		],
	},
	{
		id: 'iridescent',
		stops: [
			{ position: 0, color: [0.12, 0.08, 0.25, 1] },
			{ position: 0.2, color: [0.55, 0.32, 0.75, 1] },
			{ position: 0.38, color: [0.55, 0.92, 0.95, 1] },
			{ position: 0.5, color: [0.95, 1, 0.8, 1] },
			{ position: 0.62, color: [0.95, 0.55, 0.72, 1] },
			{ position: 0.8, color: [0.38, 0.22, 0.6, 1] },
			{ position: 1, color: [0.7, 0.9, 1, 1] },
		],
	},

	// 絵の具・紙の配色。色の占める幅と明暗の折り返しを不均等にし、単調な色相変化を避ける。
	{
		id: 'pigment-study',
		stops: [
			{ position: 0, color: [0.07, 0.1, 0.24, 1] },
			{ position: 0.12, color: [0.15, 0.27, 0.58, 1] },
			{ position: 0.24, color: [0.52, 0.65, 0.72, 1] },
			{ position: 0.31, color: [0.94, 0.88, 0.69, 1] },
			{ position: 0.42, color: [0.76, 0.5, 0.15, 1] },
			{ position: 0.48, color: [0.37, 0.18, 0.16, 1] },
			{ position: 0.61, color: [0.84, 0.32, 0.24, 1] },
			{ position: 0.73, color: [0.97, 0.71, 0.54, 1] },
			{ position: 0.81, color: [0.89, 0.91, 0.76, 1] },
			{ position: 0.9, color: [0.23, 0.48, 0.4, 1] },
			{ position: 1, color: [0.045, 0.16, 0.17, 1] },
		],
	},
	{
		id: 'oil-painting',
		stops: [
			{ position: 0, color: [0.035, 0.045, 0.035, 1] },
			{ position: 0.14, color: [0.15, 0.23, 0.13, 1] },
			{ position: 0.25, color: [0.43, 0.46, 0.24, 1] },
			{ position: 0.34, color: [0.79, 0.69, 0.37, 1] },
			{ position: 0.41, color: [0.91, 0.82, 0.57, 1] },
			{ position: 0.47, color: [0.33, 0.16, 0.12, 1] },
			{ position: 0.59, color: [0.51, 0.12, 0.19, 1] },
			{ position: 0.7, color: [0.24, 0.11, 0.28, 1] },
			{ position: 0.79, color: [0.12, 0.21, 0.33, 1] },
			{ position: 0.9, color: [0.5, 0.57, 0.56, 1] },
			{ position: 1, color: [0.9, 0.87, 0.73, 1] },
		],
	},
	{
		id: 'watercolor-bloom',
		stops: [
			{ position: 0, color: [0.56, 0.72, 0.89, 0] },
			{ position: 0.1, color: [0.56, 0.72, 0.89, 0.4] },
			{ position: 0.23, color: [0.39, 0.63, 0.74, 0.8] },
			{ position: 0.32, color: [0.74, 0.84, 0.77, 0.24] },
			{ position: 0.4, color: [0.97, 0.86, 0.58, 0.58] },
			{ position: 0.51, color: [0.95, 0.58, 0.47, 0.86] },
			{ position: 0.62, color: [0.9, 0.64, 0.75, 0.3] },
			{ position: 0.72, color: [0.67, 0.54, 0.8, 0.75] },
			{ position: 0.84, color: [0.78, 0.78, 0.92, 0.42] },
			{ position: 0.93, color: [0.92, 0.85, 0.92, 0.12] },
			{ position: 1, color: [0.92, 0.85, 0.92, 0] },
		],
	},
	{
		id: 'ink-wash',
		stops: [
			{ position: 0, color: [0.025, 0.035, 0.05, 1] },
			{ position: 0.1, color: [0.11, 0.17, 0.21, 1] },
			{ position: 0.23, color: [0.46, 0.53, 0.53, 1] },
			{ position: 0.39, color: [0.88, 0.87, 0.77, 1] },
			{ position: 0.48, color: [0.96, 0.93, 0.83, 1] },
			{ position: 0.5, color: [0.32, 0.24, 0.19, 1] },
			{ position: 0.55, color: [0.08, 0.07, 0.065, 1] },
			{ position: 0.65, color: [0.51, 0.43, 0.33, 1] },
			{ position: 0.79, color: [0.85, 0.8, 0.65, 1] },
			{ position: 0.91, color: [0.95, 0.92, 0.82, 1] },
			{ position: 1, color: [0.98, 0.96, 0.89, 1] },
		],
	},
	{
		id: 'fresco',
		stops: [
			{ position: 0, color: [0.21, 0.28, 0.29, 1] },
			{ position: 0.14, color: [0.4, 0.6, 0.64, 1] },
			{ position: 0.26, color: [0.76, 0.82, 0.74, 1] },
			{ position: 0.35, color: [0.9, 0.81, 0.61, 1] },
			{ position: 0.46, color: [0.73, 0.44, 0.31, 1] },
			{ position: 0.56, color: [0.47, 0.24, 0.22, 1] },
			{ position: 0.67, color: [0.69, 0.58, 0.39, 1] },
			{ position: 0.77, color: [0.52, 0.61, 0.42, 1] },
			{ position: 0.87, color: [0.79, 0.8, 0.6, 1] },
			{ position: 1, color: [0.95, 0.9, 0.76, 1] },
		],
	},
	// 同位置では後のstopを採用する仕様を使い、補間方法に段差の情報を持たせず色帯を分ける。
	{
		id: 'gouache-collage',
		stops: [
			{ position: 0, color: [0.96, 0.91, 0.75, 1] },
			{ position: 0.18, color: [0.96, 0.91, 0.75, 1] },
			{ position: 0.18, color: [0.91, 0.28, 0.2, 1] },
			{ position: 0.39, color: [0.91, 0.28, 0.2, 1] },
			{ position: 0.39, color: [0.035, 0.32, 0.37, 1] },
			{ position: 0.61, color: [0.035, 0.32, 0.37, 1] },
			{ position: 0.61, color: [0.98, 0.73, 0.16, 1] },
			{ position: 0.78, color: [0.98, 0.73, 0.16, 1] },
			{ position: 0.78, color: [0.64, 0.52, 0.76, 1] },
			{ position: 0.92, color: [0.64, 0.52, 0.76, 1] },
			{ position: 0.92, color: [0.08, 0.09, 0.13, 1] },
			{ position: 1, color: [0.08, 0.09, 0.13, 1] },
		],
	},

	// 鉱物・貝殻の配色。狭い区間の明暗や色の戻りで、層と反射のアクセントを作る。
	{
		id: 'opal-fire',
		stops: [
			{ position: 0, color: [0.18, 0.21, 0.3, 1] },
			{ position: 0.1, color: [0.72, 0.78, 0.89, 1] },
			{ position: 0.22, color: [0.89, 0.72, 0.85, 1] },
			{ position: 0.29, color: [1, 0.88, 0.61, 1] },
			{ position: 0.33, color: [0.96, 0.42, 0.18, 1] },
			{ position: 0.38, color: [0.96, 0.94, 0.82, 1] },
			{ position: 0.49, color: [0.56, 0.85, 0.79, 1] },
			{ position: 0.57, color: [0.11, 0.66, 0.64, 1] },
			{ position: 0.63, color: [0.82, 0.96, 0.87, 1] },
			{ position: 0.72, color: [0.64, 0.68, 0.94, 1] },
			{ position: 0.79, color: [0.89, 0.58, 0.82, 1] },
			{ position: 0.86, color: [1, 0.93, 0.8, 1] },
			{ position: 0.94, color: [0.75, 0.88, 0.91, 1] },
			{ position: 1, color: [0.97, 0.98, 0.94, 1] },
		],
	},
	{
		id: 'labradorite',
		stops: [
			{ position: 0, color: [0.025, 0.04, 0.055, 1] },
			{ position: 0.16, color: [0.12, 0.18, 0.22, 1] },
			{ position: 0.29, color: [0.055, 0.27, 0.42, 1] },
			{ position: 0.36, color: [0.13, 0.65, 0.84, 1] },
			{ position: 0.4, color: [0.7, 0.94, 0.98, 1] },
			{ position: 0.45, color: [0.05, 0.16, 0.25, 1] },
			{ position: 0.56, color: [0.08, 0.11, 0.13, 1] },
			{ position: 0.67, color: [0.25, 0.34, 0.2, 1] },
			{ position: 0.73, color: [0.71, 0.66, 0.26, 1] },
			{ position: 0.77, color: [0.96, 0.84, 0.43, 1] },
			{ position: 0.82, color: [0.21, 0.24, 0.16, 1] },
			{ position: 0.92, color: [0.08, 0.14, 0.19, 1] },
			{ position: 1, color: [0.02, 0.035, 0.05, 1] },
		],
	},
	{
		id: 'malachite-bands',
		stops: [
			{ position: 0, color: [0.015, 0.09, 0.065, 1] },
			{ position: 0.12, color: [0.04, 0.36, 0.23, 1] },
			{ position: 0.2, color: [0.46, 0.8, 0.51, 1] },
			{ position: 0.24, color: [0.77, 0.91, 0.66, 1] },
			{ position: 0.28, color: [0.025, 0.18, 0.12, 1] },
			{ position: 0.39, color: [0.1, 0.53, 0.34, 1] },
			{ position: 0.45, color: [0.57, 0.86, 0.59, 1] },
			{ position: 0.48, color: [0.015, 0.11, 0.085, 1] },
			{ position: 0.61, color: [0.08, 0.42, 0.28, 1] },
			{ position: 0.7, color: [0.67, 0.88, 0.63, 1] },
			{ position: 0.75, color: [0.025, 0.2, 0.15, 1] },
			{ position: 0.86, color: [0.18, 0.61, 0.39, 1] },
			{ position: 0.94, color: [0.82, 0.94, 0.75, 1] },
			{ position: 1, color: [0.035, 0.16, 0.12, 1] },
		],
	},
	{
		id: 'agate-slices',
		stops: [
			{ position: 0, color: [0.07, 0.13, 0.2, 1] },
			{ position: 0.14, color: [0.36, 0.56, 0.67, 1] },
			{ position: 0.23, color: [0.86, 0.9, 0.85, 1] },
			{ position: 0.25, color: [0.98, 0.94, 0.81, 1] },
			{ position: 0.25, color: [0.41, 0.23, 0.15, 1] },
			{ position: 0.36, color: [0.78, 0.49, 0.29, 1] },
			{ position: 0.43, color: [0.96, 0.81, 0.62, 1] },
			{ position: 0.5, color: [0.97, 0.93, 0.82, 1] },
			{ position: 0.5, color: [0.13, 0.32, 0.43, 1] },
			{ position: 0.64, color: [0.41, 0.68, 0.74, 1] },
			{ position: 0.73, color: [0.85, 0.94, 0.89, 1] },
			{ position: 0.78, color: [0.22, 0.28, 0.3, 1] },
			{ position: 0.89, color: [0.65, 0.67, 0.6, 1] },
			{ position: 1, color: [0.98, 0.93, 0.81, 1] },
		],
	},
	{
		id: 'obsidian-gold',
		stops: [
			{ position: 0, color: [0.01, 0.012, 0.02, 1] },
			{ position: 0.17, color: [0.04, 0.045, 0.07, 1] },
			{ position: 0.26, color: [0.26, 0.16, 0.055, 1] },
			{ position: 0.29, color: [0.97, 0.78, 0.33, 1] },
			{ position: 0.31, color: [1, 0.96, 0.72, 1] },
			{ position: 0.34, color: [0.07, 0.04, 0.035, 1] },
			{ position: 0.52, color: [0.025, 0.025, 0.04, 1] },
			{ position: 0.63, color: [0.19, 0.12, 0.065, 1] },
			{ position: 0.68, color: [0.78, 0.48, 0.12, 1] },
			{ position: 0.7, color: [1, 0.91, 0.57, 1] },
			{ position: 0.73, color: [0.16, 0.09, 0.045, 1] },
			{ position: 0.87, color: [0.05, 0.055, 0.08, 1] },
			{ position: 1, color: [0.012, 0.015, 0.025, 1] },
		],
	},
	{
		id: 'mother-of-pearl',
		stops: [
			{ position: 0, color: [0.57, 0.62, 0.67, 1] },
			{ position: 0.1, color: [0.88, 0.91, 0.9, 1] },
			{ position: 0.21, color: [0.98, 0.91, 0.88, 1] },
			{ position: 0.29, color: [0.89, 0.71, 0.82, 1] },
			{ position: 0.37, color: [0.79, 0.77, 0.91, 1] },
			{ position: 0.45, color: [0.92, 0.95, 1, 1] },
			{ position: 0.5, color: [1, 0.99, 0.92, 1] },
			{ position: 0.57, color: [0.78, 0.88, 0.77, 1] },
			{ position: 0.65, color: [0.72, 0.86, 0.86, 1] },
			{ position: 0.74, color: [0.93, 0.94, 0.97, 1] },
			{ position: 0.83, color: [0.97, 0.87, 0.76, 1] },
			{ position: 0.91, color: [0.89, 0.84, 0.88, 1] },
			{ position: 1, color: [0.99, 0.98, 0.94, 1] },
		],
	},

	// 光をイメージした配色。光学現象の計算ではなく、細い明色と暗色の組み合わせで表現する。
	{
		id: 'thin-film',
		stops: [
			{ position: 0, color: [0.03, 0.045, 0.12, 1] },
			{ position: 0.07, color: [0.22, 0.12, 0.42, 1] },
			{ position: 0.16, color: [0.67, 0.26, 0.57, 1] },
			{ position: 0.24, color: [0.97, 0.62, 0.42, 1] },
			{ position: 0.3, color: [1, 0.94, 0.65, 1] },
			{ position: 0.37, color: [0.49, 0.86, 0.62, 1] },
			{ position: 0.45, color: [0.1, 0.59, 0.77, 1] },
			{ position: 0.52, color: [0.18, 0.24, 0.63, 1] },
			{ position: 0.59, color: [0.47, 0.21, 0.65, 1] },
			{ position: 0.67, color: [0.91, 0.43, 0.68, 1] },
			{ position: 0.74, color: [0.98, 0.83, 0.62, 1] },
			{ position: 0.81, color: [0.63, 0.89, 0.76, 1] },
			{ position: 0.88, color: [0.5, 0.68, 0.91, 1] },
			{ position: 0.95, color: [0.86, 0.77, 0.95, 1] },
			{ position: 1, color: [0.99, 0.96, 0.88, 1] },
		],
	},
	{
		id: 'diffraction',
		stops: [
			{ position: 0, color: [0.015, 0.005, 0.04, 1] },
			{ position: 0.09, color: [0.18, 0.04, 0.62, 1] },
			{ position: 0.17, color: [0.04, 0.52, 0.97, 1] },
			{ position: 0.23, color: [0.38, 0.95, 0.71, 1] },
			{ position: 0.28, color: [1, 0.94, 0.62, 1] },
			{ position: 0.34, color: [0.95, 0.19, 0.25, 1] },
			{ position: 0.4, color: [0.11, 0.015, 0.13, 1] },
			{ position: 0.47, color: [0.51, 0.12, 0.77, 1] },
			{ position: 0.53, color: [0.94, 0.97, 1, 1] },
			{ position: 0.6, color: [0.1, 0.71, 0.9, 1] },
			{ position: 0.67, color: [0.27, 0.88, 0.39, 1] },
			{ position: 0.73, color: [1, 0.78, 0.15, 1] },
			{ position: 0.8, color: [0.96, 0.22, 0.46, 1] },
			{ position: 0.9, color: [0.28, 0.035, 0.38, 1] },
			{ position: 1, color: [0.015, 0.005, 0.04, 1] },
		],
	},
	{
		id: 'stained-glass',
		stops: [
			{ position: 0, color: [0.035, 0.045, 0.09, 1] },
			{ position: 0.07, color: [0.035, 0.045, 0.09, 1] },
			{ position: 0.07, color: [0.13, 0.25, 0.7, 1] },
			{ position: 0.24, color: [0.36, 0.69, 0.93, 1] },
			{ position: 0.24, color: [0.07, 0.4, 0.28, 1] },
			{ position: 0.43, color: [0.54, 0.86, 0.38, 1] },
			{ position: 0.43, color: [0.42, 0.035, 0.11, 1] },
			{ position: 0.62, color: [0.94, 0.25, 0.23, 1] },
			{ position: 0.62, color: [0.71, 0.39, 0.04, 1] },
			{ position: 0.8, color: [1, 0.89, 0.39, 1] },
			{ position: 0.8, color: [0.33, 0.08, 0.47, 1] },
			{ position: 0.94, color: [0.78, 0.47, 0.84, 1] },
			{ position: 0.94, color: [0.035, 0.045, 0.09, 1] },
			{ position: 1, color: [0.035, 0.045, 0.09, 1] },
		],
	},
	{
		id: 'prism-echoes',
		stops: [
			{ position: 0, color: [0.23, 0.055, 0.47, 1] },
			{ position: 0.09, color: [0.065, 0.38, 0.83, 1] },
			{ position: 0.18, color: [0.08, 0.79, 0.71, 1] },
			{ position: 0.27, color: [0.89, 0.91, 0.31, 1] },
			{ position: 0.36, color: [0.96, 0.4, 0.19, 1] },
			{ position: 0.44, color: [0.82, 0.16, 0.49, 1] },
			{ position: 0.5, color: [0.18, 0.1, 0.35, 1] },
			{ position: 0.58, color: [0.47, 0.4, 0.75, 1] },
			{ position: 0.66, color: [0.49, 0.76, 0.88, 1] },
			{ position: 0.74, color: [0.69, 0.88, 0.62, 1] },
			{ position: 0.82, color: [0.97, 0.86, 0.56, 1] },
			{ position: 0.91, color: [0.96, 0.65, 0.63, 1] },
			{ position: 1, color: [0.72, 0.55, 0.79, 1] },
		],
	},
	{
		id: 'velvet-neon',
		stops: [
			{ position: 0, color: [0.015, 0.005, 0.04, 1] },
			{ position: 0.16, color: [0.11, 0.025, 0.17, 1] },
			{ position: 0.29, color: [0.24, 0.035, 0.4, 1] },
			{ position: 0.36, color: [0.69, 0.08, 0.84, 1] },
			{ position: 0.4, color: [1, 0.6, 0.94, 1] },
			{ position: 0.45, color: [0.15, 0.025, 0.24, 1] },
			{ position: 0.58, color: [0.035, 0.035, 0.14, 1] },
			{ position: 0.68, color: [0.055, 0.2, 0.51, 1] },
			{ position: 0.74, color: [0.18, 0.69, 0.92, 1] },
			{ position: 0.78, color: [0.7, 0.98, 1, 1] },
			{ position: 0.83, color: [0.04, 0.15, 0.27, 1] },
			{ position: 0.93, color: [0.07, 0.035, 0.17, 1] },
			{ position: 1, color: [0.015, 0.005, 0.04, 1] },
		],
	},
	{
		id: 'aurora-veil',
		stops: [
			{ position: 0, color: [0.16, 0.12, 0.55, 0] },
			{ position: 0.13, color: [0.16, 0.12, 0.55, 0.28] },
			{ position: 0.24, color: [0.42, 0.18, 0.8, 0.72] },
			{ position: 0.34, color: [0.17, 0.44, 0.76, 0.24] },
			{ position: 0.43, color: [0.11, 0.8, 0.66, 0.76] },
			{ position: 0.48, color: [0.7, 1, 0.82, 0.96] },
			{ position: 0.56, color: [0.26, 0.84, 0.47, 0.35] },
			{ position: 0.64, color: [0.7, 0.96, 0.44, 0.8] },
			{ position: 0.73, color: [0.92, 0.71, 0.72, 0.18] },
			{ position: 0.84, color: [0.72, 0.27, 0.68, 0.65] },
			{ position: 0.93, color: [0.44, 0.24, 0.65, 0.2] },
			{ position: 1, color: [0.44, 0.24, 0.65, 0] },
		],
	},

	// デジタル表現。同位置の色切替や短い明色区間を混ぜ、細い線や複数の発光帯を作る。
	{
		id: 'chromatic-glitch',
		stops: [
			{ position: 0, color: [0.015, 0.02, 0.045, 1] },
			{ position: 0.15, color: [0.035, 0.08, 0.17, 1] },
			{ position: 0.15, color: [0.04, 0.97, 0.9, 1] },
			{ position: 0.23, color: [0.8, 1, 0.94, 1] },
			{ position: 0.26, color: [0.025, 0.025, 0.065, 1] },
			{ position: 0.42, color: [0.09, 0.035, 0.18, 1] },
			{ position: 0.42, color: [0.95, 0.025, 0.57, 1] },
			{ position: 0.52, color: [1, 0.76, 0.88, 1] },
			{ position: 0.56, color: [0.025, 0.02, 0.045, 1] },
			{ position: 0.7, color: [0.13, 0.11, 0.055, 1] },
			{ position: 0.7, color: [0.91, 1, 0.025, 1] },
			{ position: 0.8, color: [1, 1, 0.78, 1] },
			{ position: 0.84, color: [0.025, 0.03, 0.055, 1] },
			{ position: 0.95, color: [0.025, 0.03, 0.055, 1] },
			{ position: 0.95, color: [0.97, 0.98, 1, 1] },
			{ position: 1, color: [0.97, 0.98, 1, 1] },
		],
	},
	{
		id: 'analog-scanlines',
		stops: [
			{ position: 0, color: [0.01, 0.025, 0.025, 1] },
			{ position: 0.11, color: [0.03, 0.17, 0.14, 1] },
			{ position: 0.15, color: [0.43, 0.97, 0.64, 1] },
			{ position: 0.18, color: [0.015, 0.055, 0.05, 1] },
			{ position: 0.3, color: [0.025, 0.17, 0.22, 1] },
			{ position: 0.34, color: [0.4, 0.85, 1, 1] },
			{ position: 0.37, color: [0.015, 0.04, 0.075, 1] },
			{ position: 0.49, color: [0.16, 0.07, 0.18, 1] },
			{ position: 0.53, color: [0.97, 0.47, 0.77, 1] },
			{ position: 0.56, color: [0.05, 0.02, 0.055, 1] },
			{ position: 0.68, color: [0.2, 0.14, 0.055, 1] },
			{ position: 0.72, color: [1, 0.85, 0.37, 1] },
			{ position: 0.75, color: [0.05, 0.04, 0.02, 1] },
			{ position: 0.87, color: [0.15, 0.18, 0.17, 1] },
			{ position: 0.91, color: [0.94, 1, 0.88, 1] },
			{ position: 1, color: [0.01, 0.025, 0.025, 1] },
		],
	},
	{
		id: 'holographic-foil',
		stops: [
			{ position: 0, color: [0.11, 0.14, 0.22, 1] },
			{ position: 0.12, color: [0.59, 0.7, 0.9, 1] },
			{ position: 0.2, color: [0.98, 0.99, 1, 1] },
			{ position: 0.24, color: [0.62, 0.36, 0.79, 1] },
			{ position: 0.31, color: [0.98, 0.62, 0.82, 1] },
			{ position: 0.38, color: [1, 0.89, 0.61, 1] },
			{ position: 0.44, color: [0.54, 0.87, 0.64, 1] },
			{ position: 0.5, color: [0.15, 0.4, 0.48, 1] },
			{ position: 0.56, color: [0.87, 0.98, 1, 1] },
			{ position: 0.61, color: [0.98, 0.99, 1, 1] },
			{ position: 0.65, color: [0.36, 0.29, 0.58, 1] },
			{ position: 0.74, color: [0.83, 0.52, 0.83, 1] },
			{ position: 0.82, color: [1, 0.79, 0.65, 1] },
			{ position: 0.9, color: [0.71, 0.91, 0.81, 1] },
			{ position: 1, color: [0.98, 0.99, 1, 1] },
		],
	},
	{
		id: 'cosmic-dust',
		stops: [
			{ position: 0, color: [0.008, 0.012, 0.045, 1] },
			{ position: 0.13, color: [0.09, 0.045, 0.23, 1] },
			{ position: 0.25, color: [0.39, 0.12, 0.44, 1] },
			{ position: 0.34, color: [0.77, 0.28, 0.45, 1] },
			{ position: 0.41, color: [0.98, 0.63, 0.33, 1] },
			{ position: 0.46, color: [1, 0.92, 0.69, 1] },
			{ position: 0.52, color: [0.2, 0.11, 0.29, 1] },
			{ position: 0.63, color: [0.065, 0.15, 0.32, 1] },
			{ position: 0.73, color: [0.16, 0.46, 0.62, 1] },
			{ position: 0.8, color: [0.64, 0.88, 0.91, 1] },
			{ position: 0.86, color: [0.3, 0.22, 0.48, 1] },
			{ position: 0.94, color: [0.12, 0.07, 0.24, 1] },
			{ position: 1, color: [0.008, 0.012, 0.045, 1] },
		],
	},
	{
		id: 'bioluminescence',
		stops: [
			{ position: 0, color: [0.035, 0.3, 0.25, 0] },
			{ position: 0.13, color: [0.035, 0.3, 0.25, 0.12] },
			{ position: 0.24, color: [0.05, 0.64, 0.43, 0.65] },
			{ position: 0.29, color: [0.66, 1, 0.65, 1] },
			{ position: 0.33, color: [0.07, 0.42, 0.3, 0.18] },
			{ position: 0.47, color: [0.03, 0.26, 0.33, 0.06] },
			{ position: 0.58, color: [0.055, 0.66, 0.77, 0.75] },
			{ position: 0.63, color: [0.64, 0.98, 1, 1] },
			{ position: 0.67, color: [0.07, 0.4, 0.51, 0.2] },
			{ position: 0.81, color: [0.14, 0.29, 0.51, 0.12] },
			{ position: 0.9, color: [0.49, 0.69, 1, 0.65] },
			{ position: 1, color: [0.49, 0.69, 1, 0] },
		],
	},
	{
		id: 'plasma-ribbons',
		stops: [
			{ position: 0, color: [0.055, 0.015, 0.13, 1] },
			{ position: 0.1, color: [0.39, 0.04, 0.52, 1] },
			{ position: 0.19, color: [0.86, 0.17, 0.57, 1] },
			{ position: 0.27, color: [1, 0.67, 0.42, 1] },
			{ position: 0.32, color: [1, 0.94, 0.76, 1] },
			{ position: 0.37, color: [0.24, 0.08, 0.35, 1] },
			{ position: 0.48, color: [0.05, 0.35, 0.45, 1] },
			{ position: 0.57, color: [0.12, 0.81, 0.78, 1] },
			{ position: 0.63, color: [0.77, 1, 0.91, 1] },
			{ position: 0.68, color: [0.18, 0.19, 0.44, 1] },
			{ position: 0.79, color: [0.53, 0.13, 0.61, 1] },
			{ position: 0.9, color: [0.98, 0.44, 0.62, 1] },
			{ position: 1, color: [1, 0.89, 0.67, 1] },
		],
	},

	{
		id: 'cyan-gold-glow',
		stops: [
			{ position: 0, color: [0, 0, 0, 0] },
			{ position: 0.2, color: [0.1, 0.25, 0.6, 0.6] },
			{ position: 0.6, color: [0.15, 0.75, 1, 1] },
			{ position: 1, color: [1, 0.9, 0.65, 1] },
		],
	},
	{
		id: 'blue-mint-magenta',
		stops: [
			{ position: 0, color: [0.05, 0.15, 0.6, 1] },
			{ position: 0.5, color: [0.1, 0.9, 0.8, 1] },
			{ position: 1, color: [0.9, 0.1, 0.6, 1] },
		],
	},
	{
		id: 'neon-prism',
		stops: [
			{ position: 0, color: [0.08, 0.15, 0.8, 1] },
			{ position: 0.35, color: [0.05, 0.9, 1, 1] },
			{ position: 0.7, color: [1, 0.1, 0.5, 1] },
			{ position: 1, color: [1, 0.8, 0.25, 1] },
		],
	},
	{
		id: 'sapphire-amber-cycle',
		stops: [
			{ position: 0, color: [0.025, 0.04, 0.14, 1] },
			{ position: 0.25, color: [0.05, 0.3, 0.85, 1] },
			{ position: 0.5, color: [1, 0.95, 0.65, 1] },
			{ position: 0.75, color: [1, 0.3, 0.04, 1] },
			{ position: 1, color: [0.025, 0.04, 0.14, 1] },
		],
	},
];
