import type { EffectStatus } from '../../effect-status.ts';

const GLYPHS = '0123456789x%';
let nextAtlasFontId = 0;

/** ラベルの値はGPUで組み立てるので、CPUではフォント変更時だけ固定の字形を転送する。 */
export function createGlyphAtlas(device: GPUDevice, reportStatus: (status: EffectStatus) => void) {
	const canvas = new OffscreenCanvas(16 * 64, 96);
	const context = canvas.getContext('2d');
	if (context == null) throw new Error('Could not create the object tracker glyph atlas.');
	const texture = device.createTexture({
		size: { width: canvas.width, height: canvas.height },
		format: 'rgba8unorm',
		usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
	});
	const registeredFamily = `GlitchObjectTrackerFont${++nextAtlasFontId}`;
	// WorkerのFontFaceSetへ直接登録し、DOMやスタイルシートの挿入を必要としない。
	const fontSet = 'fonts' in globalThis ? (globalThis as unknown as { fonts: FontFaceSet }).fonts : null;
	let face: FontFace | null = null;
	let request: AbortController | null = null;
	let key: string | null = null;
	let cacheVersion = 0;
	let disposed = false;

	function draw(family: string, weight: number) {
		context!.clearRect(0, 0, canvas.width, canvas.height);
		context!.fillStyle = '#ffffff';
		context!.font = `${weight} 60px ${family}`;
		context!.textAlign = 'center';
		context!.textBaseline = 'middle';
		for (let index = 0; index < GLYPHS.length; index++) {
			context!.fillText(GLYPHS[index], index * 64 + 32, 49);
		}
		device.queue.copyExternalImageToTexture(
			{ source: canvas }, { texture, premultipliedAlpha: true },
			{ width: canvas.width, height: canvas.height },
		);
		++cacheVersion;
	}

	async function load(family: string, weight: number, controller: AbortController) {
		try {
			// 数字と記号だけを要求すると単一のサブセットとなり、言語別のFontFaceを管理する必要がない。
			const url = new URL('https://fonts.googleapis.com/css2');
			url.searchParams.set('family', `${family}:wght@${weight}`);
			url.searchParams.set('text', GLYPHS);
			url.searchParams.set('display', 'swap');
			let response = await fetch(url, { signal: controller.signal });
			if (!response.ok && weight !== 400) {
				// 公開されていないウェイトは標準の字形を使い、Canvasに太さの合成を任せる。
				url.searchParams.set('family', `${family}:wght@400`);
				response = await fetch(url, { signal: controller.signal });
			}
			if (!response.ok) throw new Error(`Font stylesheet returned ${response.status}.`);
			const css = await response.text();
			const source = /src:\s*url\(['"]?([^)'"\s]+)['"]?\)/.exec(css)?.[1] ?? null;
			if (source == null) throw new Error('Font stylesheet has no font source.');
			const data = await fetch(source, { signal: controller.signal });
			if (!data.ok) throw new Error(`Font file returned ${data.status}.`);
			const loadedFace = await new FontFace(registeredFamily, await data.arrayBuffer(), { weight: String(weight) }).load();
			// 設定変更や破棄より前に始めた読み込みは、現在のアトラスへ反映しない。
			if (disposed || controller.signal.aborted || request !== controller) return;
			if (fontSet != null) {
				fontSet.add(loadedFace);
				face = loadedFace;
				draw(registeredFamily, weight);
			}
			reportStatus({ type: 'ready' });
		} catch {
			if (disposed || controller.signal.aborted || request !== controller) return;
			// 元実装と同様、通信不能や存在しないフォントでも代替字形で描画を続ける。
			reportStatus({ type: 'ready' });
		}
	}

	draw('monospace', 500);
	return {
		texture,
		get cacheVersion() { return cacheVersion; },
		prepare(family: string, weight: number, enabled: boolean) {
			if (disposed) return;
			const normalizedFamily = String(family).trim() || 'Inter';
			const normalizedWeight = Number.isFinite(weight) ? Math.round(Math.min(900, Math.max(100, weight))) : 500;
			const nextKey = JSON.stringify(enabled ? [normalizedFamily, normalizedWeight] : null);
			if (key === nextKey) return;
			key = nextKey;
			request?.abort();
			request = null;
			if (face != null) fontSet?.delete(face);
			face = null;
			draw('monospace', normalizedWeight);
			if (!enabled || fontSet == null) {
				reportStatus({ type: 'ready' });
				return;
			}
			reportStatus({ type: 'loading' });
			request = new AbortController();
			void load(normalizedFamily, normalizedWeight, request);
		},
		dispose() {
			disposed = true;
			request?.abort();
			if (face != null) fontSet?.delete(face);
			face = null;
			texture.destroy();
			canvas.width = 1;
			canvas.height = 1;
		},
	};
}
