import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateIconFont, tablerCssPath } from './icon-font.mjs';

export function iconFontPlugin({ additionalIconNames = [] } = {}) {
	const uiDirectory = fileURLToPath(new URL('../', import.meta.url));
	const sourceDirectory = path.join(uiDirectory, 'src');
	const generatedDirectory = path.join(uiDirectory, 'node_modules/.cache/icon-font');
	let isBuild = false;
	return {
		name: 'glitch-studio-icon-font',
		config(_config, { command }) {
			isBuild = command === 'build';
			return {
				resolve: {
					alias: {
						'@glitch-studio-icons': isBuild ? path.join(generatedDirectory, 'tabler-icons.css') : tablerCssPath,
					},
				},
			};
		},
		async buildStart() {
			if (!isBuild) return;
			const { css, font, iconNames, sourcePaths } = await generateIconFont(sourceDirectory, additionalIconNames);
			await mkdir(generatedDirectory, { recursive: true });
			// CSSとフォントをViteの通常のアセット処理へ渡し、Web/Electronのbaseとハッシュ付与を任せる。
			// watch時は内容が変わった場合だけ書き換え、生成ファイル自身による再ビルドの連鎖を避ける。
			for (const [name, content] of [['tabler-icons.css', css], ['tabler-icons-subset.woff2', font]]) {
				const destination = path.join(generatedDirectory, name);
				const previous = await readFile(destination).catch(error => {
					if (error.code === 'ENOENT') return null;
					throw error;
				});
				const next = Buffer.from(content);
				if (previous == null || !previous.equals(next)) await writeFile(destination, next);
			}
			this.addWatchFile(sourceDirectory);
			for (const sourcePath of sourcePaths) this.addWatchFile(sourcePath);
			this.addWatchFile(tablerCssPath);
			this.emitFile({
				type: 'asset',
				fileName: 'licenses/tabler-icons.txt',
				source: await readFile(new URL(import.meta.resolve('@tabler/icons-webfont/LICENSE'))),
			});
			this.info(`${iconNames.length} icons, ${font.length} bytes (WOFF2)`);
		},
	};
}
