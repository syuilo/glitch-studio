const passed = [];
const fatalErrors = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
function check(condition, name) { if (!condition) throw new Error(name); passed.push(name); }
function lastRequestedFrame(element) {
	return element.ownerDocument.defaultView.portableNodesEffectFrames.get(element)?.lastRequested ?? null;
}
function rendered(element, action = () => {}, matchesFrame = () => true) {
	const previousRequest = lastRequestedFrame(element);
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => { cleanup(); reject(new Error('Render timed out: ' + element.localName + ' ' + JSON.stringify({ bounds: element.getBoundingClientRect(), viewport: [innerWidth, innerHeight], connected: element.isConnected, visibility: document.visibilityState }))); }, 10000);
		const done = ({ detail }) => {
			// 操作の前に送ったフレームは操作の結果を含まないため、その完了は待ち合わせに使わない。
			if (detail === previousRequest || !matchesFrame(detail)) return;
			cleanup();
			resolve(detail);
		};
		const error = event => { if (event.detail.fatal) { cleanup(); reject(new Error(event.detail.message)); } };
		const cleanup = () => { clearTimeout(timer); element.removeEventListener('test-frame-complete', done); element.removeEventListener('error', error); };
		element.addEventListener('test-frame-complete', done);
		element.addEventListener('error', error);
		action();
	});
}
async function mount(name, parameters = null) {
	await import('/' + name + '/artwork.js');
	const element = document.createElement('gs-nodes-effect-' + name);
	element.style.cssText = 'display:block;width:200px;height:100px';
	if (parameters != null) element.setAttribute('parameters', JSON.stringify(parameters));
	element.addEventListener('error', event => { if (event.detail.fatal) fatalErrors.push(event.detail.message); });
	const first = rendered(element, () => document.body.append(element));
	await Promise.all([element.ready, first]);
	return element;
}
async function pixel(element, x = 0.5, y = 0.5) {
	await frame(); await frame();
	const canvas = element.shadowRoot.querySelector('canvas');
	const context = new OffscreenCanvas(canvas.width, canvas.height).getContext('2d');
	context.drawImage(canvas, 0, 0);
	return [...context.getImageData(Math.min(canvas.width - 1, Math.floor(canvas.width * x)), Math.min(canvas.height - 1, Math.floor(canvas.height * y)), 1, 1).data];
}

async function checkRenderingSuspension(element, label, suspend, resume, inputWhileSuspended = () => {}) {
	suspend();
	// ResizeObserverやIntersectionObserverが休止を検出するまでのフレームと、観測期間を分ける。
	for (let index = 0; index < 4; index++) await frame();
	const requestBefore = lastRequestedFrame(element);
	const timeBefore = element.currentTime;
	inputWhileSuspended();
	await delay(80);
	check(lastRequestedFrame(element) === requestBefore && element.currentTime >= timeBefore + 0.06,
		label + ' suspend rendering while the clock advances');
	const resumed = await rendered(element, resume);
	check(resumed.resetHistory && resumed.time >= (timeBefore + 0.06) * 1000 && resumed.pointerElementStrokeSegments.length === 0,
		label + ' resume at the current time with new history and no old strokes');
}

async function bandCenter(canvas) {
	await frame();
	await frame();
	const { width, height } = canvas;
	const context = new OffscreenCanvas(width, height).getContext('2d');
	context.drawImage(canvas, 0, 0);
	const { data } = context.getImageData(0, 0, width, height);
	let left = width, top = height, right = -1, bottom = -1;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (data[(y * width + x) * 4] < 80) continue;
			left = Math.min(left, x);
			top = Math.min(top, y);
			right = Math.max(right, x);
			bottom = Math.max(bottom, y);
		}
	}
	return right < 0 ? null : [(left + right + 1) / (2 * width), (top + bottom + 1) / (2 * height)];
}

async function checkPointerdownBand(element, pointerType) {
	const canvas = element.shadowRoot.querySelector('canvas');
	// 単一HTMLのiframeでも、入力の採取時刻をCanvasのDocumentと同じ時間原点にする。
	const { PointerEvent } = canvas.ownerDocument.defaultView;
	const label = element.localName + ' / ' + pointerType;
	const x = 0.65, y = 0.43;
	const waitForTime = time => rendered(element, undefined, renderedFrame => renderedFrame.time >= time * 1000);
	function dispatchPointer(type, buttons) {
		const rect = canvas.getBoundingClientRect();
		canvas.dispatchEvent(new PointerEvent(type, { isPrimary: true, pointerId: 1, pointerType, button: type === 'pointerdown' ? 0 : -1, buttons,
			clientX: rect.left + rect.width * x, clientY: rect.top + rect.height * y }));
	}

	await rendered(element, () => {
		element.style.cssText = 'display:block;width:200px;height:100px';
		element.restart();
	}, renderedFrame => renderedFrame.resolution.width === Math.round(200 * devicePixelRatio));
	dispatchPointer('pointermove', 0);
	await waitForTime(0.12);
	check(await bandCenter(canvas) === null, 'pointer movement leaves the band empty: ' + label);
	const pressTime = element.currentTime;
	// pointerdownだけを送り、押下位置がこの時点でEffectに届くことを出力画素で確認する。
	dispatchPointer('pointerdown', 1);
	await waitForTime(pressTime + 0.16);
	const center = await bandCenter(canvas);
	check(center != null && Math.abs(center[0] - x) < 0.025 && Math.abs(center[1] - y) < 0.025,
		'pointerdown produces a band at the pressed point through contain fitting: ' + label + ' ' + center);
	await rendered(element, () => element.restart(), renderedFrame => renderedFrame.resetHistory);
	check(await bandCenter(canvas) === null, 'restart clears band presses: ' + label);
}

async function checkCursorRipples(element) {
	const canvas = element.shadowRoot.querySelector('canvas');
	const context = new OffscreenCanvas(canvas.width, canvas.height).getContext('2d');
	async function columns() {
		await frame(); await frame();
		context.drawImage(canvas, 0, 0);
		return [0.25, 0.5, 0.75].map(x => [...context.getImageData(Math.floor(x * canvas.width), 0, 1, canvas.height).data]);
	}
	function dispatch(type, x, pointerType = 'mouse', buttons = 0, coalescedPositions = []) {
		const rect = canvas.getBoundingClientRect();
		const eventAt = x => ({ isPrimary: true, pointerId: pointerType === 'mouse' ? 1 : 2, pointerType, buttons,
			clientX: rect.left + rect.width * x, clientY: rect.top + rect.height * 0.5 });
		const coalescedEvents = coalescedPositions.map(position => new PointerEvent('pointermove', eventAt(position)));
		canvas.dispatchEvent(new PointerEvent(type, { ...eventAt(x), coalescedEvents }));
	}
	async function advance(action) {
		const minimum = (element.currentTime + 0.025) * 1000;
		await rendered(element, action, renderedFrame => renderedFrame.time >= minimum);
	}

	const flat = await columns();
	await advance(() => {
		dispatch('pointerenter', 0.1);
		dispatch('pointermove', 0.9);
	});
	const changed = await columns();
	check(changed.every((column, x) => column.some((value, index) => Math.abs(value - flat[x][index]) > 8)), 'fast pointer movement distorts every sampled column');
	await rendered(element, () => element.restart(), renderedFrame => renderedFrame.resetHistory);
	check((await columns()).every((column, x) => column.every((value, index) => value === flat[x][index])), 'restart restores the undistorted image');
	await advance(() => {
		dispatch('pointerenter', 0.1);
		dispatch('pointermove', 0.1, 'mouse', 0, [0.9, 0.1]);
	});
	check((await columns()).every((column, x) => column.some((value, index) => Math.abs(value - flat[x][index]) > 8)), 'coalesced samples preserve an out-and-back stroke within one pointermove');
	await rendered(element, () => element.restart(), renderedFrame => renderedFrame.resetHistory);
	await advance(() => {
		dispatch('pointerenter', 0.1);
		dispatch('pointerleave', 0.1);
		dispatch('pointerenter', 0.9);
	});
	check((await columns()).every((column, x) => column.every((value, index) => value === flat[x][index])), 'reentering at a distant point leaves the image undistorted');
	await advance(() => {
		dispatch('pointerdown', 0.9, 'touch', 1);
		dispatch('pointermove', 0.1, 'touch', 1);
		dispatch('pointerup', 0.1, 'touch');
	});
	check((await columns()).every((column, x) => column.some((value, index) => Math.abs(value - flat[x][index]) > 8)), 'a touch drag ending in the same frame still distorts the full path');
	// 【画面外に出ると描画履歴と描画待ちの軌跡を区切る】
	// 画面に戻った時刻のフレームで、休止前の波や休止中のポインター移動が描画されないことを確かめる。
	await checkRenderingSuspension(element, 'offscreen elements',
		() => { element.style.translate = '0 200vh'; },
		() => { element.style.translate = ''; },
		() => { dispatch('pointerenter', 0.1); dispatch('pointermove', 0.9); });
	await advance(() => dispatch('pointermove', 0.1));
	check((await columns()).every((column, x) => column.every((value, index) => value === flat[x][index])), 'returning onscreen resets the waves and starts a new stroke');
}

async function checkSymbolTextureRendering(element, name) {
	const canvas = element.shadowRoot.querySelector('canvas');
	const context = new OffscreenCanvas(canvas.width, canvas.height).getContext('2d');
	let visiblePixels = 0;
	// エフェクト固有の画像準備は初回フレームの完了後も続くことがある。
	for (let attempt = 0; attempt < 100 && visiblePixels === 0; attempt++) {
		await delay(20);
		context.drawImage(canvas, 0, 0);
		const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
		for (let index = 0; index < pixels.length; index += 4) {
			if (pixels[index] > 20 || pixels[index + 1] > 20 || pixels[index + 2] > 20) visiblePixels++;
		}
	}
	check(visiblePixels > 100 && visiblePixels < canvas.width * canvas.height * 0.9, 'bundled Symbols textures render without external assets: ' + name);
}

async function measureFrameRate(element, fpsLimit) {
	if (fpsLimit == null) element.removeAttribute('fps-limit');
	else element.setAttribute('fps-limit', String(fpsLimit));
	for (let index = 0; index < 10; index++) await frame();
	let completedFrames = 0;
	const completed = () => { completedFrames++; };
	const start = await frame();
	element.addEventListener('test-frame-complete', completed);
	let end = start;
	for (let index = 0; index < 120; index++) end = await frame();
	element.removeEventListener('test-frame-complete', completed);
	const seconds = (end - start) / 1000;
	return { fpsLimit, completedFrames, fps: Math.round(completedFrames / seconds * 10) / 10, rafFps: Math.round(120 / seconds * 10) / 10 };
}
try {
	const element = await mount('test', { level: 0.5 });
	check(!crossOriginIsolated, 'runs without cross-origin isolation');
	let color = await pixel(element, 0.05, 0.05);
	const initialCanvas = element.shadowRoot.querySelector('canvas');
	check(initialCanvas.width === Math.round(200 * devicePixelRatio) && initialCanvas.height === Math.round(100 * devicePixelRatio), 'renders at device pixel resolution');
	check(Math.abs(color[0] - 188) <= 2 && color[3] === 255, 'public attribute reaches linear color output across the full canvas: ' + color);
	// 【一時停止とフレーム完了の公開APIを削除する】
	// Workerの内部完了通知が生きていても、埋め込み先のページへフレーム完了イベントを発火しないことを確認する。
	let publicRenderEvents = 0;
	element.addEventListener('render', () => { publicRenderEvents++; });
	await rendered(element, () => element.setParameters({ level: 1 }));
	color = await pixel(element);
	check(color[0] === 255, 'API updates while rendering');
	check(publicRenderEvents === 0 && !('pause' in element) && !('play' in element) && !('paused' in element)
		&& !element.constructor.observedAttributes.includes('paused'), 'frame completion and pause are absent from the public API');
	await rendered(element, () => element.setAttribute('parameters', '{"level":0.25}'));
	check(element.getParameter('level') === 1, 'API overrides retain priority over changed attributes');
	await rendered(element, () => element.resetParameter('level'));
	check(element.getParameter('level') === 0.25, 'reset restores the current attribute value');
	let attributeError = false;
	element.addEventListener('error', event => { if (!event.detail.fatal) attributeError = true; });
	element.setAttribute('parameters', '{"level":');
	check(attributeError && element.getParameter('level') === 0.25, 'invalid JSON attributes preserve the previous attribute parameters');
	await rendered(element, () => { element.style.width = '300px'; element.style.height = '150px'; },
		renderedFrame => renderedFrame.resolution.width === Math.round(300 * devicePixelRatio));
	await frame(); await frame();
	check(initialCanvas.width === Math.round(300 * devicePixelRatio), 'CSS resize changes actual render resolution');
	await rendered(element, () => element.setAttribute('resolution-scale', '0.5'),
		renderedFrame => renderedFrame.resolution.width === Math.floor(150 * devicePixelRatio));
	await frame(); await frame();
	check(initialCanvas.width === Math.floor(150 * devicePixelRatio), 'render scale remains responsive');
	const timeBeforeRestart = element.currentTime;
	await rendered(element, () => {
		element.restart();
		check(element.currentTime < Math.min(timeBeforeRestart, 0.05), 'restart resets the artwork clock');
	}, renderedFrame => renderedFrame.resetHistory);
	const independent = await mount('test', { level: 0.8 });
	check(independent.getParameter('level') === 0.8 && element.getParameter('level') === 0.25, 'instances keep independent public values');
	independent.remove();
	element.remove(); await Promise.resolve();
	const disconnectedTime = element.currentTime;
	await delay(60);
	check(element.currentTime === disconnectedTime, 'removing the element freezes its clock across disconnection');
	const reconnected = rendered(element, () => document.body.append(element));
	await element.ready;
	check((await reconnected).time >= disconnectedTime * 1000 - 1 && element.getParameter('level') === 0.25,
		'reconnection transfers a fresh canvas and resumes the saved time and parameters');
	// 【表示サイズゼロやページの非表示中も作品時刻を進める】
	// 画面に戻るまで描画要求を送らず、復帰した時刻と空の履歴で描画を始める。
	await checkRenderingSuspension(element, 'zero-sized elements',
		() => { element.style.width = '0px'; },
		() => { element.style.width = '300px'; });
	await checkRenderingSuspension(element, 'hidden documents', () => {
		Object.defineProperty(document, 'hidden', { configurable: true, value: true });
		document.dispatchEvent(new Event('visibilitychange'));
	}, () => {
		delete document.hidden;
		document.dispatchEvent(new Event('visibilitychange'));
	});
	element.remove();
	for (const name of ['literal', 'modified', 'defaults']) {
		const optimized = await mount(name);
		const optimizedColor = await pixel(optimized);
		check(Math.abs(optimizedColor[0] - 137) <= 2 && optimizedColor[3] === 255, name + ' optimized runtime preserves pixels: ' + optimizedColor);
		if (name === 'defaults') {
			check(optimized.getParameter('values')[0] === 0.25, 'nested literal defaults expose plain values');
			// 【公開配列の更新・取得では外部の参照を内部状態に残さない】
			// 検証の有無によらず、呼び出し元の変更は次の明示的な更新まで描画に影響させない。
			const values = [1, 0.5];
			await rendered(optimized, () => optimized.setParameter('values', values));
			values[0] = 0;
			const retrievedValues = optimized.getParameter('values');
			retrievedValues[0] = 0;
			check(optimized.getParameter('values')[0] === 1, 'public API values remain independent of caller references');
			check((await pixel(optimized))[0] === 255, 'changing a public array length rebuilds its static input layout');
		}
		optimized.remove();
	}
	const curves = await mount('curves');
	color = await pixel(curves);
	check(color.every((channel, index) => Math.abs(channel - [188, 137, 137, 255][index]) <= 2),
		'exported expressions, Curve Animation and eased keyframes preserve pixels: ' + color);
	await rendered(curves, () => curves.setParameter('curve', 'bezier'));
	color = await pixel(curves);
	check(color.every((channel, index) => Math.abs(channel - [137, 137, 137, 255][index]) <= 2),
		'public values select another Function Curve in the exported runtime: ' + color);
	curves.remove();
	const pointer = await mount('pointer');
	const canvas = pointer.shadowRoot.querySelector('canvas');
	const rect = canvas.getBoundingClientRect();
	await rendered(pointer, () => canvas.dispatchEvent(new PointerEvent('pointermove', { isPrimary: true, pointerId: 1, pointerType: 'touch', clientX: rect.left + rect.width * 0.75, clientY: rect.top + rect.height * 0.25 })));
	color = await pixel(pointer);
	check(Math.abs(color[0] - 225) <= 2 && Math.abs(color[1] - 207) <= 2, 'pointer coordinates use the common isotropic units: ' + color);
	await rendered(pointer, () => { pointer.style.width = '100px'; pointer.style.height = '200px'; },
		renderedFrame => renderedFrame.resolution.width === Math.round(100 * devicePixelRatio));
	color = await pixel(pointer);
	check(Math.abs(color[0] - 207) <= 2 && Math.abs(color[1] - 225) <= 2, 'resize uses the new output aspect for the first pointer frame: ' + color);
	pointer.remove();
	const ripple = await mount('ripple');
	await checkPointerdownBand(ripple, 'mouse');
	ripple.remove();
	const clickGradient = await mount('clickgradient');
	await checkPointerdownBand(clickGradient, 'touch');
	clickGradient.remove();
	const cursorRipples = await mount('cursorripples');
	await checkCursorRipples(cursorRipples);
	cursorRipples.remove();
	const custom = await mount('custom');
	const topLeft = await pixel(custom, 0.1, 0.1);
	const bottomRight = await pixel(custom, 0.9, 0.9);
	check(topLeft[0] < bottomRight[0] && topLeft[1] > bottomRight[1], 'bundled custom shaders retain output orientation');
	custom.remove();
	const image = await mount('image');
	const imageTop = await pixel(image, 0.5, 0.1);
	const imageBottom = await pixel(image, 0.5, 0.9);
	const imageOutside = await pixel(image, 0.05, 0.5);
	check(imageTop[0] > 250 && Math.abs(imageTop[3] - 128) <= 2 && imageBottom[1] > 250 && imageOutside[3] === 0, 'bundled images retain alpha orientation and contain fitting: ' + [imageTop, imageBottom, imageOutside]);
	image.remove();
	// 【組み込み画像を埋め込み先へ接続せずに読み込み、全アイコンセットを描画する】
	// SymbolsはAsset一覧にない内蔵PNGを使う。ViteのBASE_URLやアプリのpublic配信に
	// 依存すると、書き出し自体が成功しても埋め込み先で初めて失敗してしまう。
	// connect-srcにdata:を許可しないCSPでも描画でき、同梱画像だけで完結することを確認する。
	for (const iconset of ['symbols', 'symbols_numbers', 'numbers', 'sweets']) {
		const symbols = await mount('symbols', { iconset });
		await checkSymbolTextureRendering(symbols, iconset);
		symbols.remove();
	}
	// 【公開色を画像として描画する経路と、Outに直結する経路を区別する】
	// Fillは公開色とアルファを表示する。値だけが届くOutは描画ループを維持して透明になる。
	const solid = await mount('solid');
	color = await pixel(solid, 0.05, 0.05);
	check(Math.abs(color[0] - 188) <= 2 && Math.abs(color[3] - 128) <= 2, 'Fill renders a public color across the canvas: ' + color);
	await rendered(solid, () => solid.setParameters({ tint: [0, 0.5, 0, 0.5] }));
	color = await pixel(solid);
	check(color[0] === 0 && Math.abs(color[1] - 188) <= 2 && Math.abs(color[3] - 128) <= 2, 'Fill responds to changes in the public color: ' + color);
	solid.remove();
	const noOutput = await mount('nooutput');
	check((await pixel(noOutput))[3] === 0, 'uniform wired directly to Out presents a transparent frame');
	noOutput.remove();
	const transient = document.createElement('gs-nodes-effect-test');
	transient.style.cssText = 'width:100px;height:50px';
	document.body.append(transient); const abandoned = transient.ready.catch(() => 'aborted'); transient.remove();
	check(await abandoned === 'aborted', 'removal during initialization rejects the abandoned ready promise');
	// 【初回から画面外にある作品もreadyで時刻を進める】
	// 初めて画面に入るまで0秒で止まると、画面外の経過時間が作品に反映されない。
	transient.style.translate = '0 200vh';
	document.body.append(transient);
	await transient.ready;
	await delay(80);
	check(transient.currentTime >= 0.06 && lastRequestedFrame(transient) == null, 'ready starts the artwork clock before its first visible frame');
	const firstVisibleFrame = await rendered(transient, () => { transient.style.translate = ''; });
	check(firstVisibleFrame.time >= 60 && firstVisibleFrame.resetHistory, 'initially offscreen artwork starts drawing at the elapsed time');
	transient.remove();
	const frameRateProbe = await mount('test');
	const defaultRate = await measureFrameRate(frameRateProbe, null);
	check(defaultRate.fps >= defaultRate.rafFps * 0.92, 'default automatic pacing follows requestAnimationFrame: ' + JSON.stringify(defaultRate));
	const limitedRate = await measureFrameRate(frameRateProbe, 60);
	const lowRate = await measureFrameRate(frameRateProbe, 15);
	check(Math.abs(lowRate.fps - Math.min(15, lowRate.rafFps)) < 1.5, 'numeric FPS attributes retain their limit: ' + JSON.stringify(lowRate));
	const refreshRate = await measureFrameRate(frameRateProbe, 'auto');
	check(refreshRate.fps >= refreshRate.rafFps * 0.92, 'auto attribute removes a previous numeric limit: ' + JSON.stringify(refreshRate));
	check(limitedRate.fps >= Math.min(60, refreshRate.fps) * 0.92 && limitedRate.fps <= 62,
		'frame limiter sustains the available refresh rate: ' + JSON.stringify({ limitedRate, refreshRate }));
	frameRateProbe.remove();
	for (const name of ['standalone', 'symbols', 'image', 'ripple']) {
		const iframe = document.createElement('iframe'); iframe.style.cssText = 'width:300px;height:150px';
		await new Promise(resolve => { iframe.onload = resolve; iframe.src = '/' + name + '.html'; document.body.append(iframe); });
		const standalone = iframe.contentDocument.querySelector('gs-nodes-effect-' + name);
		await standalone.ready; await rendered(standalone);
		if (name === 'symbols') await checkSymbolTextureRendering(standalone, 'single HTML');
		else if (name === 'image') check((await pixel(standalone, 0.5, 0.1))[0] > 250, 'single HTML renders its embedded image');
		else if (name === 'ripple') await checkPointerdownBand(standalone, 'touch');
		else check(standalone.getParameter('level') === 0.25, 'single HTML survives script-like artwork strings and starts independently');
		iframe.remove();
	}
	check(fatalErrors.length === 0, 'no asynchronous renderer failures');
	await fetch('/result', { method: 'POST', body: JSON.stringify({ passed }) });
} catch (error) {
	await fetch('/result', { method: 'POST', body: JSON.stringify({ error: error.stack, passed, fatalErrors }) });
}
