import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** パス・ソースコード・ビルド設定は受け取らず、同梱カタログ内の機能だけを選ぶ。 */
export function validatePortableVisualModuleRuntimeRequirements(requirements, effectIds) {
	if (requirements == null || !Array.isArray(requirements.effectIds)
		|| requirements.effectIds.some(id => typeof id !== 'string' || !effectIds.includes(id))
		|| ['requiresExpressions', 'requiresParameterDefaultExpressions', 'requiresCustomShaderEffects'].some(key => typeof requirements[key] !== 'boolean')) {
		throw new Error('Invalid portable Visual Module runtime requirements');
	}
	return { effectIds: [...new Set(requirements.effectIds)].sort(), requiresExpressions: requirements.requiresExpressions,
		requiresParameterDefaultExpressions: requirements.requiresParameterDefaultExpressions, requiresCustomShaderEffects: requirements.requiresCustomShaderEffects };
}

/** 開発用workspaceやViteを参照せず、配布されたES Modulesだけから成果物を作る。 */
export async function buildPortableVisualModuleRuntime(catalogDirectory, requestedRequirements, onBundle = () => {}) {
	const manifest = JSON.parse(await readFile(path.join(catalogDirectory, 'manifest.json'), 'utf8'));
	const requirements = validatePortableVisualModuleRuntimeRequirements(requestedRequirements, manifest.effectIds);
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
	const expressionImport = required => required ? 'import { ExpressionEvaluator } from "./expression.js";' : '';
	const expressionInstance = required => required ? 'new ExpressionEvaluator()' : 'null';
	const elementSource = await bundle(`
		import { registerVisualModuleElement as register } from './element.js';
		${expressionImport(requirements.requiresParameterDefaultExpressions)}
		export function registerVisualModuleElement(tagName, artwork, workerSource) {
			register(tagName, artwork, workerSource, ${expressionInstance(requirements.requiresParameterDefaultExpressions)});
		}
	`, 'GlitchStudioVisualModuleEmbed');
	const imports = requirements.effectIds.map((id, index) => `
		import definition${index} from ${JSON.stringify(`./effects/${id}/definition.js`)};
		import implementation${index} from ${JSON.stringify(`./effects/${id}/implementation.js`)};
	`).join('\n');
	const registry = prefix => `{ ${requirements.effectIds.map((id, index) => `${JSON.stringify(id)}: ${prefix}${index}`).join(',')} }`;
	const workerSource = await bundle(`
		import { startPortableVisualModuleWorker } from './worker.js';
		${imports}
		${expressionImport(requirements.requiresExpressions)}
		${requirements.requiresCustomShaderEffects ? 'import { createProjectEffects } from "./custom-shader-effects.js";' : ''}
		const definitions = ${registry('definition')};
		const implementations = ${registry('implementation')};
		startPortableVisualModuleWorker({
			expressionEvaluator: ${expressionInstance(requirements.requiresExpressions)},
			createEffects: ${requirements.requiresCustomShaderEffects ? 'artwork => createProjectEffects(artwork.customShaderEffects, definitions, implementations)' : '() => ({ definitions, implementations })'},
		});
	`, 'GlitchStudioVisualModuleWorker');
	return { elementSource, workerSource };
}
