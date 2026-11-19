import type { NativeEffectDefinition } from '@gs/subsystems_effect-new_shared/effect-definition.ts';
import { analyzePortableCustomNodeGraphEffectRuntime } from './runtime-requirements.ts';
import { readFileSource } from '@gs/shared/file-source.ts';
import { collectCustomNodeGraphEffectResources, type CustomNodeGraphEffectResources } from '@gs/glitch-studio_shared/custom-node-graph-effect-resources.ts';
import { validatePortableCustomNodeGraphEffectSettings } from '@gs/glitch-studio_shared/portable-custom-node-graph-effect.ts';
import { getPortableParameterDefinitions, getPortableParameterDefaults, validatePortableParameters } from './parameters.ts';
import type { PortableCustomNodeGraphEffect, PortableCustomNodeGraphEffectSettings } from '@gs/glitch-studio_shared/portable-custom-node-graph-effect.ts';

export type PortableCustomNodeGraphEffectExportInput = CustomNodeGraphEffectResources & {
	name: string;
	gsVersion: string;
	aspectRatio: number;
	settings: PortableCustomNodeGraphEffectSettings;
	initialParameters: Record<string, unknown>;
};

export function preparePortableCustomNodeGraphEffect(input: PortableCustomNodeGraphEffectExportInput, nativeDefinitions: Readonly<Record<string, NativeEffectDefinition>>) {
	const resources = collectCustomNodeGraphEffectResources(input, nativeDefinitions);
	const { customNodeGraphEffect } = resources;
	const port = customNodeGraphEffect.primaryOutput;
	if (port == null || customNodeGraphEffect.outputDefs[port].dataType.kind !== 'color') throw new Error('Web export requires a primary color output. Convert scalar or vector fields to color before exporting.');
	validatePortableCustomNodeGraphEffectSettings(input.settings);
	if (!Number.isFinite(input.aspectRatio) || input.aspectRatio <= 0) throw new Error('Aspect ratio must be positive and finite');
	const parameters = getPortableParameterDefinitions(customNodeGraphEffect);
	getPortableParameterDefaults(parameters);
	const { runtimeRequirements, resolutionNodes } = analyzePortableCustomNodeGraphEffectRuntime(resources, nativeDefinitions);
	return {
		name: input.name, gsVersion: input.gsVersion, customNodeGraphEffect,
		assets: resources.assets,
		customShaderEffects: resources.customShaderEffects,
		customNodeGraphEffects: resources.customNodeGraphEffects.map(({ id, name, definition }) => ({ id, name, definition })),
		aspectRatio: input.aspectRatio, settings: { ...input.settings },
		initialParameters: validatePortableParameters(parameters, input.initialParameters),
		runtimeRequirements,
		diagnostics: { players: resources.players.map(player => player.name), resolutionNodes },
	};
}

export async function encodePortableCustomNodeGraphEffect(prepared: ReturnType<typeof preparePortableCustomNodeGraphEffect>, signal?: AbortSignal): Promise<PortableCustomNodeGraphEffect> {
	const { diagnostics: _diagnostics, runtimeRequirements: _runtimeRequirements, assets, ...data } = prepared;
	const embedded: PortableCustomNodeGraphEffect['assets'] = [];
	// 原本を順に読む。大きな動画・フォントを同時に二重保持しない。
	for (const { fileData, ...asset } of assets) {
		signal?.throwIfAborted();
		try {
			const bytes = new Uint8Array(await (await readFileSource(fileData)).arrayBuffer());
			embedded.push({ ...asset, fileDataBase64: bytes.toBase64() });
		} catch (cause) { throw new Error(`Could not read Asset ${JSON.stringify(asset.name)}`, { cause }); }
	}
	signal?.throwIfAborted();
	return { ...data, assets: embedded };
}

export type PortableCustomNodeGraphEffectRuntime = { elementSource: string; workerSource: string };

function htmlText(value: string) {
	return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

export function createPortableCustomNodeGraphEffectFiles(artwork: PortableCustomNodeGraphEffect, runtime: PortableCustomNodeGraphEffectRuntime, tagName = `gs-custom-node-graph-effect-${crypto.randomUUID()}`) {
	if (!/^gs-custom-node-graph-effect-[a-z0-9-]+$/.test(tagName)) throw new Error('Invalid Custom Node Graph Effect element name');
	// JSON.parseを通して__proto__等も通常のデータとして復元する。作品の文字列をコードとして挿入しない。
	const scriptString = (value: string) => JSON.stringify(value).replaceAll('<', '\\u003c');
	const data = scriptString(JSON.stringify(artwork));
	const javascript = `(() => {\n${runtime.elementSource}\nGlitchStudioCustomNodeGraphEffectEmbed.registerCustomNodeGraphEffectElement(${JSON.stringify(tagName)}, JSON.parse(${data}), ${scriptString(runtime.workerSource)});\n})();\n`;
	const document = (script: string) => `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${htmlText(artwork.name)}</title>\n<style>html, body { margin: 0; width: 100%; height: 100%; } ${tagName} { display: block; width: 100%; height: 100%; }</style>\n</head>\n<body>\n<${tagName} id="artwork"></${tagName}>\n${script}\n</body>\n</html>\n`;
	const html = document('<script type="module" src="./artwork.js"></script>');
	// 実行コード自体もASCIIでビルドする。HTML parserがscriptを途中で閉じる文字列を残さない。
	const standaloneHtml = document(`<script type="module">\n${javascript.replace(/<\/script/gi, '<\\/script')}\n</script>`);
	const readme = `# ${artwork.name}

Serve index.html and artwork.js over HTTPS (or localhost) with WebGPU enabled. No CDN or Glitch Studio installation is required. The page CSP must allow the script, a blob: worker and inline component styles. Single HTML also requires inline scripts to be allowed.

Embed:

<script type="module" src="./artwork.js"></script>
<${tagName} id="artwork" style="display:block;width:100%;height:60vh" parameters='{}'></${tagName}>

JavaScript (after customElements.whenDefined('${tagName}')):

const customNodeGraphEffectElement = document.querySelector('#artwork');
await customNodeGraphEffectElement.ready;
// customNodeGraphEffectElement.setParameter('public-parameter-name', value);
// customNodeGraphEffectElement.setParameters({ ...values });
// customNodeGraphEffectElement.getParameter(name);
// customNodeGraphEffectElement.resetParameter(name);
customNodeGraphEffectElement.pause();
customNodeGraphEffectElement.play();
customNodeGraphEffectElement.restart();

Public parameters:
${Array.from(getPortableParameterDefinitions(artwork.customNodeGraphEffect), ([name, definition]) => '- ' + JSON.stringify(name) + ': ' + definition.dataType.kind).join('\n')}

API overrides > parameters attribute > exported initial values > public defaults. Colors use straight linear sRGB RGBA; RGB may be outside 0..1. Parameter values are validated atomically. Invalid API values throw; invalid attributes emit error and keep the last valid values.

Attributes: parameters (JSON), resolution-scale, max-pixels, fps-limit (auto or a positive number), paused (presence).
The default FPS setting is automatic: follow requestAnimationFrame without additional frame limiting. fps-limit="auto" overrides an exported numeric limit; removing the attribute restores the exported setting.
Events: ready, render (detail: resolution, time in seconds), error (detail: message, fatal). ready resolves after GPU and image initialization; render signals a completed frame. Video/font/shader preparation may fail afterwards.

CSS determines the size. Rendering follows device pixels subject to scale and pixel limits. Existing node resolutions are preserved; mismatched output ratios use transparent letterboxing. Resizing or changing the length of a bound public array resets effect history and preserves time. Offscreen/hidden/zero-sized elements suspend their clocks. Removing an element releases resources; reconnecting retains parameter values and time but resets history. restart resets time/history and can retry a failed renderer. Pointer input uses the primary pointer and does not prevent touch scrolling.

All Players (including file Players) remain unconnected. Video Frame reads bundled video assets independently. No tile rendering, external image/audio API or timeline playback is included. IS_EXPORT is false; END_TIME is Infinity; PROGRESS is 0.
`;
	return { tagName, javascript, html, standaloneHtml, readme };
}
