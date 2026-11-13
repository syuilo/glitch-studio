import { readFileSource } from '@gs/shared/file-source.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { findDependencyCycle } from '@gs/shared/utility/dependency-cycle.ts';
import { collectVisualModuleResources } from '@gs/glitch-studio_shared/visual-module-resources.ts';
import { getProjectEffectDefinitions } from '@gs/glitch-studio_shared/project/effects.ts';
import { validatePortableVisualModuleSettings } from '@gs/glitch-studio_shared/portable-visual-module.ts';
import { inspectVisualModuleNode, validateVisualModuleInterface } from '@gs/subsystems_visual-module_shared/static-validation.ts';
import { customShaderEffectReference } from '@gs/subsystems_effect_shared/custom-shader-effect.ts';
import { getPortableParameterDefaults, validatePortableParameters } from './parameters.ts';
import type { Asset, Player } from '@gs/shared/types.ts';
import type { VisualModule } from '@gs/subsystems_visual-module_shared/types.ts';
import type { ProjectCustomShaderEffect } from '@gs/glitch-studio_shared/project/types.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { PortableVisualModule, PortableVisualModuleSettings } from '@gs/glitch-studio_shared/portable-visual-module.ts';

export type PortableVisualModuleExportInput = {
	name: string;
	gsVersion: string;
	visualModule: VisualModule;
	assets: Asset[];
	players: Player[];
	customShaderEffects: ProjectCustomShaderEffect[];
	aspectRatio: number;
	settings: PortableVisualModuleSettings;
	initialParameters: Record<string, unknown>;
};

export function preparePortableVisualModule(input: PortableVisualModuleExportInput, builtinDefinitions: Readonly<Record<string, EffectDefinition>>) {
	const definitions = getProjectEffectDefinitions(input.customShaderEffects, builtinDefinitions);
	const resources = collectVisualModuleResources(input, definitions);
	const visualModule = resources.visualModule;
	validateVisualModuleInterface(visualModule);
	const dependencies = new Map<string, string[]>();
	for (const node of visualModule.nodes) {
		const inputs: string[] = [];
		inspectVisualModuleNode(node, visualModule, definitions, id => inputs.push(id));
		dependencies.set(node.id, inputs);
	}
	const cycle = findDependencyCycle(dependencies);
	if (cycle != null) throw new Error(`Visual Module contains a cycle: ${cycle.join(' → ')}`);
	const output = visualModule.outputDefs.find(output => output.id === visualModule.primaryOutputId);
	if (output == null || output.dataType.kind !== 'color') throw new Error('Web export requires a primary color output. Convert scalar or vector fields to color before exporting.');
	validatePortableVisualModuleSettings(input.settings);
	if (!Number.isFinite(input.aspectRatio) || input.aspectRatio <= 0) throw new Error('Aspect ratio must be positive and finite');
	getPortableParameterDefaults(visualModule.paramDefs);
	const usedEffects = new Set(visualModule.nodes.flatMap(node => node.type === 'effect' ? [node.effectId] : []));
	return {
		name: input.name, gsVersion: input.gsVersion, visualModule,
		assets: resources.assets,
		customShaderEffects: deepClone(input.customShaderEffects.filter(effect => usedEffects.has(customShaderEffectReference(effect.id)))),
		aspectRatio: input.aspectRatio, settings: { ...input.settings },
		initialParameters: validatePortableParameters(visualModule.paramDefs, input.initialParameters),
		diagnostics: {
			players: resources.players.map(player => player.name),
			resolutionNodes: visualModule.nodes.filter(node => node.type === 'effect' && node.resolution.mode !== 'context').map(node => node.type === 'effect' ? node.displayName || definitions[node.effectId].displayName : ''),
		},
	};
}

export async function encodePortableVisualModule(prepared: ReturnType<typeof preparePortableVisualModule>): Promise<PortableVisualModule> {
	const { diagnostics: _diagnostics, assets, ...data } = prepared;
	const embedded: PortableVisualModule['assets'] = [];
	// 原本を順に読む。大きな動画・フォントを同時に二重保持しない。
	for (const { fileData, ...asset } of assets) {
		try {
			const bytes = new Uint8Array(await (await readFileSource(fileData)).arrayBuffer());
			embedded.push({ ...asset, fileDataBase64: bytes.toBase64() });
		} catch (cause) { throw new Error(`Could not read Asset ${JSON.stringify(asset.name)}`, { cause }); }
	}
	return { ...data, assets: embedded };
}

export type PortableVisualModuleRuntime = { elementSource: string; workerSource: string };

function htmlText(value: string) {
	return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

export function createPortableVisualModuleFiles(artwork: PortableVisualModule, runtime: PortableVisualModuleRuntime, tagName = `gs-visual-module-${crypto.randomUUID()}`) {
	if (!/^gs-visual-module-[a-z0-9-]+$/.test(tagName)) throw new Error('Invalid Visual Module element name');
	// JSON.parseを通して__proto__等も通常のデータとして復元する。作品の文字列をコードとして挿入しない。
	const scriptString = (value: string) => JSON.stringify(value).replaceAll('<', '\\u003c');
	const data = scriptString(JSON.stringify(artwork));
	const javascript = `(() => {\n${runtime.elementSource}\nGlitchStudioVisualModuleEmbed.registerVisualModuleElement(${JSON.stringify(tagName)}, JSON.parse(${data}), ${scriptString(runtime.workerSource)});\n})();\n`;
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

const visualModuleElement = document.querySelector('#artwork');
await visualModuleElement.ready;
// visualModuleElement.setParameter('public-parameter-name', value);
// visualModuleElement.setParameters({ ...values });
// visualModuleElement.getParameter(name);
// visualModuleElement.resetParameter(name);
visualModuleElement.pause();
visualModuleElement.play();
visualModuleElement.restart();

Public parameters:
${artwork.visualModule.paramDefs.map(definition => '- ' + JSON.stringify(definition.nameForReference) + ': ' + definition.dataType.kind).join('\n')}

API overrides > parameters attribute > exported initial values > public defaults. Colors use straight linear sRGB RGBA; RGB may be outside 0..1. Parameter values are validated atomically. Invalid API values throw; invalid attributes emit error and keep the last valid values.

Attributes: parameters (JSON), resolution-scale, max-pixels, fps-limit (auto or a positive number), paused (presence).
The default FPS setting is automatic: follow requestAnimationFrame without additional frame limiting. fps-limit="auto" overrides an exported numeric limit; removing the attribute restores the exported setting.
Events: ready, render (detail: resolution, time in seconds), error (detail: message, fatal). ready resolves after GPU and image initialization; render signals a completed frame. Video/font/shader preparation may fail afterwards.

CSS determines the size. Rendering follows device pixels subject to scale and pixel limits. Existing node resolutions are preserved; mismatched output ratios use transparent letterboxing. Resize resets effect history, preserving time. Offscreen/hidden/zero-sized elements suspend their clocks. Removing an element releases resources; reconnecting retains parameter values and time but resets history. restart resets time/history and can retry a failed renderer. Pointer input uses the primary pointer and does not prevent touch scrolling.

All Players (including file Players) remain unconnected. Video Frame reads bundled video assets independently. No tile rendering, external image/audio API or timeline playback is included. IS_EXPORT is false; END_TIME is Infinity; PROGRESS is 0.
`;
	return { tagName, javascript, html, standaloneHtml, readme };
}
