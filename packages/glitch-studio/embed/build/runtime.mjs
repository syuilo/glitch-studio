import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { portableParameterDefines } from '../src/parameter-features.ts';

/** パス・ソースコード・ビルド設定は受け取らず、同梱カタログ内の機能だけを選ぶ。 */
export function validatePortableNodesEffectRuntimeRequirements(requirements, effectIds) {
	if (requirements == null || !Array.isArray(requirements.effectIds)
		|| requirements.effectIds.some(id => typeof id !== 'string' || !effectIds.includes(id))
		|| !Array.isArray(requirements.parameterFeatures)
		|| requirements.parameterFeatures.some(feature => typeof feature !== 'string' || !Object.hasOwn(portableParameterDefines, feature))
		|| ['requiresExpressions', 'requiresCustomShaderEffects'].some(key => typeof requirements[key] !== 'boolean')) {
		throw new Error('Invalid portable Nodes Effect runtime requirements');
	}
	return { effectIds: [...new Set(requirements.effectIds)].sort(), requiresExpressions: requirements.requiresExpressions,
		requiresCustomShaderEffects: requirements.requiresCustomShaderEffects, parameterFeatures: new Set(requirements.parameterFeatures) };
}

/** 開発用workspaceやViteを参照せず、配布されたES Modulesだけから成果物を作る。 */
export async function buildPortableNodesEffectRuntime(catalogDirectory, requestedRequirements, onBundle = () => {}) {
	const manifest = JSON.parse(await readFile(path.join(catalogDirectory, 'manifest.json'), 'utf8'));
	const requirements = validatePortableNodesEffectRuntimeRequirements(requestedRequirements, manifest.effectIds);
	const define = Object.fromEntries(Object.entries(portableParameterDefines).map(([feature, flag]) =>
		[flag, requirements.parameterFeatures.has(feature) ? 'true' : 'false']));
	const bundle = async (contents, globalName) => {
		const result = await build({
			stdin: { contents, resolveDir: catalogDirectory, sourcefile: `${globalName}.js` },
			bundle: true, write: false, target: 'esnext', platform: 'browser', format: 'iife', globalName,
			define,
			conditions: [...(requirements.requiresExpressions ? ['portable-expressions'] : []),
				...(requirements.requiresCustomShaderEffects ? ['portable-custom-shaders'] : [])],
			minify: true, charset: 'ascii', legalComments: 'inline', metafile: true,
			// IIFEにはimport.metaの実体がない。警告だけで壊れた成果物を保存せず、
			// Vite専用環境変数などが紛れた時点で書き出しエラーにする。
			logOverride: { 'empty-import-meta': 'error' },
		});
		onBundle(globalName, result.metafile);
		if (result.outputFiles.length !== 1) throw new Error('Portable runtime must be a self-contained JavaScript bundle');
		return result.outputFiles[0].text;
	};
	const elementSource = await bundle("export { registerNodesEffectElement } from './element.js';", 'GlitchStudioNodesEffectEmbed');
	const imports = requirements.effectIds.map((id, index) => `
		import definition${index} from ${JSON.stringify(`./effects/${id}/definition.js`)};
		import implementation${index} from ${JSON.stringify(`./effects/${id}/implementation.js`)};
	`).join('\n');
	const registry = prefix => `{ ${requirements.effectIds.map((id, index) => `[${JSON.stringify(id)}]: ${prefix}${index}`).join(',')} }`;
	const workerSource = await bundle(`
		import { startPortableNodesEffectWorker } from './worker.js';
		${imports}
		startPortableNodesEffectWorker(${registry('definition')}, ${registry('implementation')});
	`, 'GlitchStudioNodesEffectWorker');
	return { elementSource, workerSource };
}
