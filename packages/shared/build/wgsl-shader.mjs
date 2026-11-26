import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';

// 解析器がentry pointのメタデータを作る際に参照するWebGPU定数。
// このファイルはNode専用で、GPUの取得・シェーダーのGPUコンパイルは行わない。
globalThis.GPUShaderStage ??= Object.freeze({ VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 });

function describeView(view) {
	if (ArrayBuffer.isView(view)) {
		const type = view.constructor.name;
		if (!['Float32Array', 'Int32Array', 'Uint32Array', 'Uint16Array', 'Float16Array'].includes(type)) throw new Error(`Unsupported shader buffer view: ${type}`);
		return { kind: 'typedArray', type, offset: view.byteOffset, length: view.length };
	}
	if (Array.isArray(view)) return { kind: 'array', elements: view.map(describeView) };
	return { kind: 'struct', fields: Object.fromEntries(Object.entries(view).map(([name, field]) => [name, describeView(field)])) };
}

/** 配置の計算は既存の解析器を唯一の情報源にし、実行側に型規則の再実装を持たない。 */
export function createShaderBufferLayouts(code) {
	const definitions = makeShaderDataDefinitions(code);
	const convert = entries => Object.fromEntries(Object.entries(entries).map(([name, definition]) => {
		const buffer = makeStructuredView(definition);
		return [name, { byteLength: buffer.arrayBuffer.byteLength, view: describeView(buffer.views) }];
	}));
	return { uniforms: convert(definitions.uniforms), storages: convert(definitions.storages), structs: convert(definitions.structs) };
}

/** WGSLのトークンを編集せず、コメントと空白の連続を一つの区切りにまとめる。 */
export function compactWgsl(code) {
	// WGSL §3.2–3.3の空白と改行に従う。JSの\sとは改行・空白の集合が異なる。
	const trivia = /(?:\p{Pattern_White_Space}+|\/\/[^\n\v\f\r\u0085\u2028\u2029]*)+|\/\*/gu;
	const blockDelimiters = /\/\*|\*\//g;
	const preservedComment = /\/\/!|\/\*!|@(?:license|preserve|author)\b|\b(?:copyright|license|notice|spdx-license-identifier)\b|https?:\/\//i;
	let compacted = '';
	let sourceOffset = 0;
	let needsSeparator = false;
	for (let match = trivia.exec(code); match != null; match = trivia.exec(code)) {
		if (match.index > sourceOffset) {
			if (needsSeparator) compacted += ' ';
			compacted += code.slice(sourceOffset, match.index);
			needsSeparator = false;
		}
		if (match[0] === '/*') {
			blockDelimiters.lastIndex = trivia.lastIndex;
			let depth = 1;
			while (depth > 0) {
				const delimiter = blockDelimiters.exec(code);
				if (delimiter == null) throw new Error('Unterminated WGSL block comment');
				depth += delimiter[0] === '/*' ? 1 : -1;
			}
			trivia.lastIndex = blockDelimiters.lastIndex;
		}
		const separator = code.slice(match.index, trivia.lastIndex);
		if (preservedComment.test(separator)) {
			// 連続する行コメントはまとめて残し、出典と一緒に書かれた著者名や改行も保持する。
			if (needsSeparator) compacted += ' ';
			compacted += separator;
			needsSeparator = false;
		} else {
			needsSeparator = true;
		}
		sourceOffset = trivia.lastIndex;
	}
	// ?rawは別のWGSLへの連結にも使うので、先頭・末尾の区切りも残す。
	return compacted + (needsSeparator ? ' ' : '') + code.slice(sourceOffset);
}

/** .shader.tsは開発者が管理する純粋なWGSL組み立て処理。作品のコードは実行しない。 */
export async function loadWgslShader(filename, { compact = false } = {}) {
	let code;
	let watchFiles;
	if (filename.endsWith('.wgsl')) {
		code = await readFile(filename, 'utf8');
		watchFiles = [filename];
	} else if (filename.endsWith('.shader.ts')) {
		const result = await build({
			entryPoints: [filename], absWorkingDir: path.dirname(filename), bundle: true, write: false,
			platform: 'node', format: 'esm', target: 'esnext', metafile: true, loader: { '.wgsl': 'text' },
		});
		// 内容をURLに含めるので、依存先WGSL・定数の編集時にもNodeのimportキャッシュが古い値を返さない。
		const source = result.outputFiles[0].text;
		code = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).default;
		watchFiles = Object.keys(result.metafile.inputs).map(file => path.resolve(path.dirname(filename), file.replace(/\?raw$/, '')));
	} else {
		throw new Error(`Expected .wgsl or .shader.ts: ${filename}`);
	}
	if (typeof code !== 'string') throw new Error(`Shader source must export a WGSL string: ${filename}`);
	try {
		const layouts = createShaderBufferLayouts(code);
		if (compact) code = compactWgsl(code);
		// 名前付きexportを分け、uniformしか使わないエフェクトへstorageや未使用structの配置を残さない。
		const contents = `export default ${JSON.stringify(code)};\n` + Object.entries(layouts)
			.map(([name, values]) => `export const ${name} = ${JSON.stringify(values)};\n`).join('');
		return { code, layouts, watchFiles, contents };
	} catch (cause) {
		throw new Error(`Could not analyze WGSL: ${filename}`, { cause });
	}
}

export function wgslShaderEsbuildPlugin({ compact = false } = {}) {
	return {
		name: 'wgsl-shader-layouts',
		setup(builder) {
			builder.onResolve({ filter: /\?shader$/ }, async args => {
				const resolved = await builder.resolve(args.path.slice(0, -7), { resolveDir: args.resolveDir, kind: args.kind });
				return { path: resolved.path, namespace: 'wgsl-shader-layouts', errors: resolved.errors };
			});
			builder.onLoad({ filter: /.*/, namespace: 'wgsl-shader-layouts' }, async args => {
				const result = await loadWgslShader(args.path, { compact });
				return { contents: result.contents, loader: 'js', watchFiles: result.watchFiles };
			});
		},
	};
}

export function wgslShaderVitePlugin() {
	const dependencies = new Map();
	return {
		name: 'wgsl-shader-layouts', enforce: 'pre',
		async resolveId(source, importer) {
			if (!source.endsWith('?shader')) return null;
			const resolved = await this.resolve(source.slice(0, -7), importer, { skipSelf: true });
			if (resolved == null) throw new Error(`Could not resolve shader: ${source}`);
			return `${resolved.id}?shader`;
		},
		async load(id) {
			if (!id.endsWith('?shader')) return null;
			const result = await loadWgslShader(id.slice(0, -7));
			dependencies.set(id, new Set(result.watchFiles.map(file => path.normalize(file))));
			for (const filename of result.watchFiles) this.addWatchFile(filename);
			return result.contents;
		},
		// .shader.tsの外にある定数やWGSLの更新も、この仮想モジュールの更新として伝える。
		handleHotUpdate(context) {
			const affected = new Set(context.modules);
			for (const [id, files] of dependencies) {
				if (!files.has(path.normalize(context.file))) continue;
				const imported = context.server.moduleGraph.getModuleById(id);
				if (imported != null) affected.add(imported);
			}
			return [...affected];
		},
	};
}
