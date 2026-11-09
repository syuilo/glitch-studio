import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import { compileScript, parse } from 'vue/compiler-sfc';

const componentPath = new URL('../src/components/GsImageAnalysisScale.vue', import.meta.url);
const descriptor = parse(await readFile(componentPath, 'utf8'), { filename: fileURLToPath(componentPath) }).descriptor;
const script = compileScript(descriptor, { id: 'image-analysis-scale' }).content;
const bundled = await build({
	stdin: { contents: script, loader: 'ts' },
	bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'],
	plugins: [{ name: 'image-analysis-scale-context', setup(build) {
		build.onResolve({ filter: /^@\/(app|ui)\.ts$/ }, args => ({ path: args.path, namespace: 'context' }));
		build.onLoad({ filter: /.*/, namespace: 'context' }, args => ({ contents: args.path.endsWith('app.ts')
			? "import { ref } from 'vue'; export const appContext = { analysisValueScale: ref('srgb') };"
			: 'export const popupMenu = items => { dependencies.menu = items; };' }));
	} }],
});

// 【解析軸のメニューと選択後の表示ラベルは、正の端点の符号と範囲の区切りを統一する】
// 負号と範囲の区切りが似た記号だと符号付き範囲を読み違えるため、指定した表記を全モードで維持する。
// 実際のメニュー生成と選択処理を通し、ラベルの並び・選択値・選択状態が対応することも確認する。
test('uses explicit positive signs and spaced tildes in every analysis scale label', () => {
	const dependencies = { menu: null };
	const module = { exports: {} };
	new Function('require', 'module', 'exports', 'dependencies', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports, dependencies);
	const component = module.exports.default.setup({}, { expose() {} });
	component.showAnalysisValueScaleMenu({ currentTarget: {} });
	const expected = [
		['srgb', 'sRGB · 0 ~ +1'],
		['linearZeroToOne', 'Linear · 0 ~ +1'],
		['linearMinusOneToOne', 'Linear · −1 ~ +1'],
		['linear', 'Linear · −1 ~ +4'],
		['ev', 'EV · −10 ~ +10 · 0 EV = 0.18'],
	];
	assert.deepEqual(dependencies.menu.map(item => item.text), expected.map(([, label]) => label));
	for (const [index, [valueScale, label]] of expected.entries()) {
		dependencies.menu[index].action();
		assert.equal(component.analysisValueScale.value, valueScale);
		assert.equal(component.analysisValueScaleLabels[valueScale], label);
		assert.deepEqual(dependencies.menu.map(item => item.active.value), expected.map((_, itemIndex) => itemIndex === index));
	}
});
