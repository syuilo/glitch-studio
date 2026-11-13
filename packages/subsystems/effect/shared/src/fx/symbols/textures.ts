import { createTextureFromSources, loadImageBitmap } from 'webgpu-utils';
import symbolsDotUrl from './assets/symbols/dot.png';
import symbolsDotsUrl from './assets/symbols/dots.png';
import symbolsDots3Url from './assets/symbols/dots3.png';
import symbolsO1Url from './assets/symbols/o1.png';
import symbolsO2Url from './assets/symbols/o2.png';
import symbolsO3Url from './assets/symbols/o3.png';
import symbolsO4Url from './assets/symbols/o4.png';
import symbolsX1Url from './assets/symbols/x1.png';
import symbolsX2Url from './assets/symbols/x2.png';
import symbolsCross1Url from './assets/symbols/cross1.png';
import symbolsCross2Url from './assets/symbols/cross2.png';
import symbolsSlash1Url from './assets/symbols/slash1.png';
import symbolsSlash2Url from './assets/symbols/slash2.png';
import symbolsCornerUrl from './assets/symbols/corner.png';
import symbolsCircleSlashUrl from './assets/symbols/circle-slash.png';
import symbolsSquareSlashUrl from './assets/symbols/square-slash.png';
import chars0Url from './assets/chars/0.png';
import chars1Url from './assets/chars/1.png';
import chars2Url from './assets/chars/2.png';
import chars3Url from './assets/chars/3.png';
import chars4Url from './assets/chars/4.png';
import chars5Url from './assets/chars/5.png';
import chars6Url from './assets/chars/6.png';
import chars7Url from './assets/chars/7.png';
import chars8Url from './assets/chars/8.png';
import chars9Url from './assets/chars/9.png';
import symbolsBlockUrl from './assets/symbols/block.png';
import emojisCandy3dUrl from './assets/emojis/candy_3d.png';
import emojisChocolateBar3dUrl from './assets/emojis/chocolate_bar_3d.png';
import emojisCookie3dUrl from './assets/emojis/cookie_3d.png';
import emojisDango3dUrl from './assets/emojis/dango_3d.png';
import emojisDoughnut3dUrl from './assets/emojis/doughnut_3d.png';
import emojisIceCream3dUrl from './assets/emojis/ice_cream_3d.png';
import emojisLollipop3dUrl from './assets/emojis/lollipop_3d.png';
import emojisPancakes3dUrl from './assets/emojis/pancakes_3d.png';
import emojisShortcake3dUrl from './assets/emojis/shortcake_3d.png';
import emojisSoftIceCream3dUrl from './assets/emojis/soft_ice_cream_3d.png';

// エフェクト自身が画像を所有し、通常のビルドではURL、ポータブル書き出しではData URLとして解決する。
export function getSymbolTextureUrls(type: string) {
	return type === 'symbols_numbers' ? [
		symbolsDotUrl,
		symbolsDotUrl,
		symbolsDotUrl,
		symbolsDotsUrl,
		symbolsDots3Url,

		symbolsO1Url,
		symbolsO2Url,
		symbolsO3Url,
		symbolsO4Url,
		symbolsX1Url,
		symbolsX2Url,
		symbolsCross1Url,
		symbolsCross2Url,
		symbolsSlash1Url,
		symbolsSlash2Url,
		symbolsCornerUrl,
		symbolsCircleSlashUrl,
		symbolsSquareSlashUrl,

		chars0Url,
		chars1Url,
		chars2Url,
		chars3Url,
		chars4Url,
		chars5Url,
		chars6Url,
		chars7Url,
		chars8Url,
		chars9Url,

		symbolsBlockUrl,
	] : type === 'symbols' ? [
		symbolsDotUrl,
		symbolsDotUrl,
		symbolsDotUrl,
		symbolsDotsUrl,
		symbolsDots3Url,

		symbolsO1Url,
		symbolsO2Url,
		symbolsO3Url,
		symbolsO4Url,
		symbolsX1Url,
		symbolsX2Url,
		symbolsCross1Url,
		symbolsCross2Url,
		symbolsSlash1Url,
		symbolsSlash2Url,
		symbolsCornerUrl,
		symbolsCircleSlashUrl,
		symbolsSquareSlashUrl,

		symbolsBlockUrl,
	] : type === 'numbers' ? [
		chars0Url,
		chars1Url,
		chars2Url,
		chars3Url,
		chars4Url,
		chars5Url,
		chars6Url,
		chars7Url,
		chars8Url,
		chars9Url,
	] : type === 'sweets' ? [
		emojisCandy3dUrl,
		emojisChocolateBar3dUrl,
		emojisCookie3dUrl,
		emojisDango3dUrl,
		emojisDoughnut3dUrl,
		emojisIceCream3dUrl,
		emojisLollipop3dUrl,
		emojisPancakes3dUrl,
		emojisShortcake3dUrl,
		emojisSoftIceCream3dUrl,
	] : [];
}

export async function createSymbolTexture(device: GPUDevice, urls: string[]): Promise<GPUTexture> {
	const inlinePngPrefix = 'data:image/png;base64,';
	const results = await Promise.allSettled(urls.map(url => {
		// 同梱PNGはfetchせず直接デコードする。埋め込み先のconnect-srcにdata:を要求せず、
		// アプリの配信元も参照しないため、Blob Workerでも単独で読み込める。
		if (url.startsWith(inlinePngPrefix)) {
			const bytes = Uint8Array.fromBase64(url.slice(inlinePngPrefix.length));
			return createImageBitmap(new Blob([bytes], { type: 'image/png' }));
		}
		return loadImageBitmap(url);
	}));
	try {
		const images = results.map(result => {
			if (result.status === 'rejected') throw result.reason;
			return result.value;
		});
		return createTextureFromSources(device, images, { mips: true });
	} finally {
		// 一部のデコードに失敗した場合も、残りの完了を待って全Bitmapを解放する。
		// 転送後はGPUTextureだけを所有し、アイコンセット切替時にCPU側の画像を残さない。
		for (const result of results) {
			if (result.status === 'fulfilled') result.value.close();
		}
	}
}
