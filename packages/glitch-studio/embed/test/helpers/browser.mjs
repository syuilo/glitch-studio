const passed = [];
const fatalErrors = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
function check(condition, name) { if (!condition) throw new Error(name); passed.push(name); }
function rendered(element, action = () => {}) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => { cleanup(); reject(new Error('Render timed out: ' + element.localName + ' ' + JSON.stringify({ bounds: element.getBoundingClientRect(), viewport: [innerWidth, innerHeight], connected: element.isConnected, visibility: document.visibilityState }))); }, 10000);
		const done = event => { cleanup(); resolve(event.detail); };
		const error = event => { if (event.detail.fatal) { cleanup(); reject(new Error(event.detail.message)); } };
		const cleanup = () => { clearTimeout(timer); element.removeEventListener('render', done); element.removeEventListener('error', error); };
		element.addEventListener('render', done);
		element.addEventListener('error', error);
		action();
	});
}
async function mount(name, parameters = null) {
	await import('/' + name + '.js');
	const element = document.createElement('gs-visual-module-' + name);
	element.style.cssText = 'display:block;width:200px;height:100px';
	element.pause();
	if (parameters != null) element.setAttribute('parameters', JSON.stringify(parameters));
	element.addEventListener('error', event => { if (event.detail.fatal) fatalErrors.push(event.detail.message); });
	const first = rendered(element, () => document.body.append(element));
	const [, detail] = await Promise.all([element.ready, first]);
	return { element, detail };
}
async function pixel(element, x = 0.5, y = 0.5) {
	await frame(); await frame();
	const canvas = element.shadowRoot.querySelector('canvas');
	const context = new OffscreenCanvas(canvas.width, canvas.height).getContext('2d');
	context.drawImage(canvas, 0, 0);
	return [...context.getImageData(Math.min(canvas.width - 1, Math.floor(canvas.width * x)), Math.min(canvas.height - 1, Math.floor(canvas.height * y)), 1, 1).data];
}

async function measureFrameRate(element, fpsLimit) {
	if (fpsLimit == null) element.removeAttribute('fps-limit');
	else element.setAttribute('fps-limit', String(fpsLimit));
	element.play();
	for (let index = 0; index < 10; index++) await frame();
	let completedFrames = 0;
	const completed = () => { completedFrames++; };
	const start = await frame();
	element.addEventListener('render', completed);
	let end = start;
	for (let index = 0; index < 120; index++) end = await frame();
	element.removeEventListener('render', completed);
	element.pause();
	const seconds = (end - start) / 1000;
	return { fpsLimit, completedFrames, fps: Math.round(completedFrames / seconds * 10) / 10, rafFps: Math.round(120 / seconds * 10) / 10 };
}
try {
	const { element, detail } = await mount('test', { level: 0.5 });
	check(!crossOriginIsolated, 'runs without cross-origin isolation');
	check(detail.resolution.width === Math.round(200 * devicePixelRatio) && detail.resolution.height === Math.round(100 * devicePixelRatio), 'renders at device pixel resolution');
	let color = await pixel(element, 0.05, 0.05);
	check(Math.abs(color[0] - 188) <= 2 && color[3] === 255, 'public attribute reaches linear color output across the full canvas: ' + color);
	await rendered(element, () => element.setParameters({ level: 1 }));
	color = await pixel(element);
	check(color[0] === 255, 'API updates while paused');
	await rendered(element, () => element.setAttribute('parameters', '{"level":0.25}'));
	check(element.getParameter('level') === 1, 'API overrides retain priority over changed attributes');
	await rendered(element, () => element.resetParameter('level'));
	check(element.getParameter('level') === 0.25, 'reset restores the current attribute value');
	let rejected = false;
	try { element.setParameters({ level: 0.75, missing: 1 }); } catch { rejected = true; }
	check(rejected && element.getParameter('level') === 0.25, 'invalid API batches leave all values unchanged');
	let attributeError = false;
	element.addEventListener('error', event => { if (!event.detail.fatal) attributeError = true; });
	element.setAttribute('parameters', '{"level":false}');
	check(attributeError && element.getParameter('level') === 0.25, 'invalid attributes preserve the last valid parameters');
	const resized = await rendered(element, () => { element.style.width = '300px'; element.style.height = '150px'; });
	check(resized.resolution.width === Math.round(300 * devicePixelRatio), 'CSS resize changes actual render resolution');
	const scaled = await rendered(element, () => element.setAttribute('resolution-scale', '0.5'));
	check(scaled.resolution.width === Math.floor(150 * devicePixelRatio), 'render scale remains responsive');
	await rendered(element, () => element.play());
	await delay(80); element.pause();
	const stopped = element.currentTime;
	await delay(80);
	check(element.currentTime === stopped && stopped > 0, 'pause freezes the artwork clock');
	await rendered(element, () => element.restart());
	check(element.currentTime === 0, 'restart resets time even when paused');
	const { element: independent } = await mount('test', { level: 0.8 });
	check(independent.getParameter('level') === 0.8 && element.getParameter('level') === 0.25, 'instances keep independent public values');
	independent.remove();
	element.remove(); await Promise.resolve();
	const reconnected = rendered(element, () => document.body.append(element));
	await element.ready; await reconnected;
	check(element.getParameter('level') === 0.25, 'reconnection transfers a fresh canvas and retains parameters');
	element.style.display = 'none'; await delay(60);
	element.play(); const hiddenTime = element.currentTime; await delay(80);
	check(element.currentTime === hiddenTime, 'zero-sized elements suspend the clock');
	await rendered(element, () => { element.style.display = 'block'; });
	check(element.currentTime - hiddenTime < 0.08, 'visibility restoration avoids a large elapsed-time jump');
	element.remove();
	const { element: pointer } = await mount('pointer');
	const canvas = pointer.shadowRoot.querySelector('canvas');
	const rect = canvas.getBoundingClientRect();
	await rendered(pointer, () => canvas.dispatchEvent(new PointerEvent('pointermove', { isPrimary: true, pointerId: 1, pointerType: 'touch', clientX: rect.left + rect.width * 0.75, clientY: rect.top + rect.height * 0.25 })));
	color = await pixel(pointer);
	check(Math.abs(color[0] - 225) <= 2 && Math.abs(color[1] - 207) <= 2, 'pointer coordinates use the common isotropic units: ' + color);
	await rendered(pointer, () => { pointer.style.width = '100px'; pointer.style.height = '200px'; });
	color = await pixel(pointer);
	check(Math.abs(color[0] - 207) <= 2 && Math.abs(color[1] - 225) <= 2, 'paused resize uses the new output aspect for the first pointer frame: ' + color);
	pointer.remove();
	const { element: custom } = await mount('custom');
	const topLeft = await pixel(custom, 0.1, 0.1);
	const bottomRight = await pixel(custom, 0.9, 0.9);
	check(topLeft[0] < bottomRight[0] && topLeft[1] > bottomRight[1], 'bundled custom shaders retain output orientation');
	custom.remove();
	const { element: image } = await mount('image');
	const imageTop = await pixel(image, 0.5, 0.1);
	const imageBottom = await pixel(image, 0.5, 0.9);
	const imageOutside = await pixel(image, 0.05, 0.5);
	check(imageTop[0] > 250 && Math.abs(imageTop[3] - 128) <= 2 && imageBottom[1] > 250 && imageOutside[3] === 0, 'bundled images retain alpha orientation and contain fitting: ' + [imageTop, imageBottom, imageOutside]);
	image.remove();
	const { element: uniform } = await mount('uniform');
	color = await pixel(uniform, 0.05, 0.05);
	check(Math.abs(color[0] - 188) <= 2 && Math.abs(color[3] - 128) <= 2, 'public color wired directly to Out fills the canvas without texture letterboxing: ' + color);
	uniform.remove();
	const { element: player } = await mount('player');
	check((await pixel(player))[3] === 0, 'unconnected Players produce transparent video without permission prompts');
	player.remove();
	const transient = document.createElement('gs-visual-module-test');
	transient.style.cssText = 'width:100px;height:50px';
	document.body.append(transient); const abandoned = transient.ready.catch(() => 'aborted'); transient.remove();
	check(await abandoned === 'aborted', 'removal during initialization rejects the abandoned ready promise');
	const restored = rendered(transient, () => document.body.append(transient)); await transient.ready; await restored; transient.remove();
	const { element: frameRateProbe } = await mount('test');
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
	const iframe = document.createElement('iframe'); iframe.style.cssText = 'width:300px;height:150px';
	await new Promise(resolve => { iframe.onload = resolve; iframe.src = '/standalone.html'; document.body.append(iframe); });
	const standalone = iframe.contentDocument.querySelector('gs-visual-module-standalone');
	await standalone.ready; await rendered(standalone);
	check(standalone.getParameter('level') === 0.25, 'single HTML survives script-like artwork strings and starts independently');
	iframe.remove();
	check(fatalErrors.length === 0, 'no asynchronous renderer failures');
	await fetch('/result', { method: 'POST', body: JSON.stringify({ passed }) });
} catch (error) {
	await fetch('/result', { method: 'POST', body: JSON.stringify({ error: error.stack, passed, fatalErrors }) });
}
