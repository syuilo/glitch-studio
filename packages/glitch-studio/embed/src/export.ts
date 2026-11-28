import type { NativeEffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import { analyzePortableNodesEffectRuntime } from './runtime-requirements.ts';
import { readFileSource } from '@gs/shared/file-source.ts';
import { collectNodesEffectResources, type NodesEffectResources } from '@gs/glitch-studio_shared/nodes-effect-resources.ts';
import { validatePortableNodesEffectSettings } from '@gs/glitch-studio_shared/portable-nodes-effect.ts';
import { getPortableParameterDefinitions } from './parameters.ts';
import type { PortableNodesEffect, PortableNodesEffectSettings } from '@gs/glitch-studio_shared/portable-nodes-effect.ts';
import type { Asset } from '@gs/shared/types.ts';

export type PortableNodesEffectExportInput = Omit<NodesEffectResources, 'assets'> & {
	assets: (Asset & { sourceFileName?: string })[];
	name: string;
	gsVersion: string;
	aspectRatio: number;
	settings: PortableNodesEffectSettings;
	initialParameters: Record<string, unknown>;
};

export function preparePortableNodesEffect(input: PortableNodesEffectExportInput, nativeDefinitions: Readonly<Record<string, NativeEffectDefinition>>) {
	const resources = collectNodesEffectResources(input, nativeDefinitions);
	const { nodesEffect } = resources;
	const port = nodesEffect.primaryOutput;
	if (port == null || nodesEffect.outputDefs[port].dataType.kind !== 'color') throw new Error('Web export requires a primary color output. Convert scalar or vector fields to color before exporting.');
	validatePortableNodesEffectSettings(input.settings);
	if (!Number.isFinite(input.aspectRatio) || input.aspectRatio <= 0) throw new Error('Aspect ratio must be positive and finite');
	const { runtimeRequirements, resolutionNodes } = analyzePortableNodesEffectRuntime(resources, nativeDefinitions);
	const sourceFileNames = new Map(input.assets.map(asset => [asset.id, asset.sourceFileName ?? asset.name]));
	return {
		name: input.name, gsVersion: input.gsVersion, nodesEffect,
		assets: resources.assets.map(asset => ({ ...asset, sourceFileName: sourceFileNames.get(asset.id)! })),
		customShaderEffects: resources.customShaderEffects,
		nodesEffects: resources.nodesEffects.map(({ id, name, definition }) => ({ id, name, definition })),
		aspectRatio: input.aspectRatio, settings: { ...input.settings },
		initialParameters: structuredClone(input.initialParameters),
		runtimeRequirements,
		diagnostics: { resolutionNodes },
	};
}

export type PortableNodesEffectAssetFile = { path: string; contents: Blob };

// 静的配信に適した素材の拡張子に限って、原本の表記（大文字や別名）を残す。
// 表示名は編集できるため、任意の拡張子を通すと配信サーバーがスクリプト等として扱い得る。
const portableAssetExtension = /\.(avif|bmp|exr|gif|heic|heif|ico|jpe?g|jxl|png|tiff?|webp|avi|m4v|mkv|mov|mp4|mpe?g|og[gv]|webm|aac|flac|m4a|mp3|opus|wav|otf|ttc|ttf|woff2?|cube)$/i;

export async function encodePortableNodesEffect(prepared: ReturnType<typeof preparePortableNodesEffect>, format: 'html' | 'zip', signal?: AbortSignal) {
	const { diagnostics: _diagnostics, runtimeRequirements: _runtimeRequirements, assets, ...data } = prepared;
	const encodedAssets: PortableNodesEffect['assets'] = [];
	const assetFiles: PortableNodesEffectAssetFile[] = [];
	for (const { fileData, sourceFileName, ...asset } of assets) {
		signal?.throwIfAborted();
		try {
			const contents = await readFileSource(fileData);
			if (format === 'zip') {
				// 連番で衝突を避け、ファイル名からは拡張子だけを使う。
				const extension = portableAssetExtension.exec(sourceFileName)?.[0] ?? '.bin';
				const path = `assets/${assetFiles.length + 1}${extension}`;
				assetFiles.push({ path, contents });
				encodedAssets.push({ ...asset, fileDataPath: path });
			} else {
				// 原本を順に変換し、大きな動画・フォントの変換用バッファを同時に確保しない。
				const bytes = new Uint8Array(await contents.arrayBuffer());
				encodedAssets.push({ ...asset, fileDataBase64: bytes.toBase64() });
			}
		} catch (cause) { throw new Error(`Could not read Asset ${JSON.stringify(asset.name)}`, { cause }); }
	}
	signal?.throwIfAborted();
	return { format, artwork: { ...data, assets: encodedAssets }, assetFiles };
}

export type PortableNodesEffectRuntime = { elementSource: string; workerSource: string };

function htmlText(value: string) {
	return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

export function createPortableNodesEffectFiles({ format, artwork, assetFiles }: Awaited<ReturnType<typeof encodePortableNodesEffect>>, runtime: PortableNodesEffectRuntime, tagName = `gs-nodes-effect-${crypto.randomUUID()}`) {
	if (!/^gs-nodes-effect-[a-z0-9-]+$/.test(tagName)) throw new Error('Invalid Nodes Effect element name');
	// JSON.parseを通して__proto__等も通常のデータとして復元する。作品の文字列をコードとして挿入しない。
	const scriptString = (value: string) => JSON.stringify(value).replaceAll('<', '\\u003c');
	const data = scriptString(JSON.stringify(artwork));
	// 埋め込み先ページやBlob WorkerのURLではなく、同梱ファイルと同じ場所にあるモジュールのURLを使う。
	const moduleUrlArgument = format === 'zip' ? ', import.meta.url' : '';
	const javascript = `(() => {\n${runtime.elementSource}\nGlitchStudioNodesEffectEmbed.registerNodesEffectElement(${JSON.stringify(tagName)}, JSON.parse(${data}), ${scriptString(runtime.workerSource)}${moduleUrlArgument});\n})();\n`;
	const document = (script: string) => `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${htmlText(artwork.name)}</title>\n<style>html, body { margin: 0; width: 100%; height: 100%; } ${tagName} { display: block; width: 100%; height: 100%; }</style>\n</head>\n<body>\n<${tagName} id="artwork"></${tagName}>\n${script}\n</body>\n</html>\n`;
	if (format === 'html') {
		// 実行コード自体もASCIIでビルドする。HTML parserがscriptを途中で閉じる文字列を残さない。
		return { format, html: document(`<script type="module">\n${javascript.replace(/<\/script/gi, '<\\/script')}\n</script>`) };
	}
	const html = document('<script type="module" src="./artwork.js"></script>');
	const readme = `# ${artwork.name}

Serve index.html and artwork.js over HTTPS (or localhost) with WebGPU enabled. If an assets/ directory is included, deploy it alongside artwork.js. Assets are loaded relative to artwork.js. No CDN or Glitch Studio installation is required. The page CSP must allow the script, a blob: worker, inline component styles and asset fetches (connect-src). If served from a different origin, the script and assets must allow CORS requests from the embedding page.

Embed:

<script type="module" src="./artwork.js"></script>
<${tagName} id="artwork" style="display:block;width:100%;height:60vh" parameters='{}'></${tagName}>

JavaScript

await customElements.whenDefined('${tagName}');
const nodesEffectElement = document.querySelector('#artwork');
// nodesEffectElement.setParameter('public-parameter-name', value);
// nodesEffectElement.setParameters({ ...values });
// nodesEffectElement.getParameter(name);
// nodesEffectElement.resetParameter(name);

Public parameters:
${Array.from(getPortableParameterDefinitions(artwork.nodesEffect), ([name, definition]) => '- ' + JSON.stringify(name) + ': ' + definition.dataType.kind).join('\n')}

API overrides take precedence over exported initial values, followed by public defaults. The caller must use names and values that match their definitions. Colors use straight linear sRGB RGBA. RGB may be outside 0..1.

Rendering scale and FPS are set at export. FPS defaults to automatic, which follows requestAnimationFrame.

CSS determines the size. Rendering follows device pixels subject to the rendering scale, a fixed cap of 8,294,400 pixels, and the GPU texture dimension limit. Node resolution settings determine intermediate sizes. Mismatched output ratios use transparent letterboxing. Resizing or changing the length of a bound public array resets effect history and preserves time.
The artwork clock starts when initialization finishes. Rendering pauses while the element is offscreen or zero-sized, or while its document is hidden. The clock keeps advancing. Rendering resumes at the current time with fresh history. Pointer movement starts a new stroke after rendering resumes.
Removing an element releases resources. Reconnecting the same element retains its parameter values and starts playback at zero after initialization with fresh history. Pointer input uses the primary pointer and does not prevent touch scrolling.

Video Frame reads bundled video assets. No tile rendering, external image/audio API or timeline playback is included. IS_EXPORT is false; END_TIME is Infinity; PROGRESS is 0.
`;
	return { format, javascript, html, readme, assetFiles };
}
