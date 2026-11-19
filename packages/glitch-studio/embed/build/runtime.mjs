import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** パス・ソースコード・ビルド設定は受け取らず、同梱カタログ内の機能だけを選ぶ。 */
export function validatePortableCustomNodeGraphEffectRuntimeRequirements(requirements, effectIds) {
	if (requirements == null || !Array.isArray(requirements.effectIds)
		|| requirements.effectIds.some(id => typeof id !== 'string' || !effectIds.includes(id))
		|| typeof requirements.requiresExpressions !== 'boolean' || typeof requirements.requiresCustomShaderEffects !== 'boolean') {
		throw new Error('Invalid portable Custom Node Graph Effect runtime requirements');
	}
	return { effectIds: [...new Set(requirements.effectIds)].sort(), requiresExpressions: requirements.requiresExpressions,
		requiresCustomShaderEffects: requirements.requiresCustomShaderEffects };
}

/** 開発用workspaceやViteを参照せず、配布されたES Modulesだけから成果物を作る。 */
export async function buildPortableCustomNodeGraphEffectRuntime(catalogDirectory, requestedRequirements, onBundle = () => {}) {
	const manifest = JSON.parse(await readFile(path.join(catalogDirectory, 'manifest.json'), 'utf8'));
	const requirements = validatePortableCustomNodeGraphEffectRuntimeRequirements(requestedRequirements, manifest.effectIds);
	const bundle = async (contents, globalName) => {
		const result = await build({
			stdin: { contents, resolveDir: catalogDirectory, sourcefile: `${globalName}.js` },
			bundle: true, write: false, target: 'esnext', platform: 'browser', format: 'iife', globalName,
			minify: true, charset: 'ascii', legalComments: 'inline', metafile: true,
			// IIFEにはimport.metaの実体がない。警告だけで壊れた成果物を保存せず、
			// Vite専用環境変数などが紛れた時点で書き出しエラーにする。
			logOverride: { 'empty-import-meta': 'error' },
		});
		onBundle(globalName, result.metafile);
		if (result.outputFiles.length !== 1) throw new Error('Portable runtime must be a self-contained JavaScript bundle');
		return result.outputFiles[0].text;
	};
	const elementSource = await bundle("export { registerCustomNodeGraphEffectElement } from './element.js';", 'GlitchStudioCustomNodeGraphEffectEmbed');
	const imports = requirements.effectIds.map((id, index) => `
		import definition${index} from ${JSON.stringify(`./effects/${id}/definition.js`)};
		import implementation${index} from ${JSON.stringify(`./effects/${id}/implementation.js`)};
	`).join('\n');
	const registry = prefix => `{ ${requirements.effectIds.map((id, index) => `${JSON.stringify(id)}: ${prefix}${index}`).join(',')} }`;
	const workerSource = await bundle(`
		import { startPortableCustomNodeGraphEffectWorker } from './worker.js';
		${imports}
		${requirements.requiresExpressions ? 'import { ExpressionEvaluator } from "./expression.js";' : ''}
		${requirements.requiresCustomShaderEffects ? 'import { createProjectEffects } from "./custom-shader-effects.js";' : ''}
		const definitions = ${registry('definition')};
		const implementations = ${registry('implementation')};
		startPortableCustomNodeGraphEffectWorker({
			expressionEvaluator: ${requirements.requiresExpressions ? 'new ExpressionEvaluator()' : 'null'},
			createEffects: ${requirements.requiresCustomShaderEffects ? 'artwork => createProjectEffects(artwork.customShaderEffects, definitions, implementations)' : '() => ({ definitions, implementations })'},
		});
	`, 'GlitchStudioCustomNodeGraphEffectWorker');
	return { elementSource, workerSource };
}
