import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { ref, shallowRef } from 'vue';

function preview(request) {
	const source = readFileSync(new URL('../src/components/GsDetachableView.vue', import.meta.url), 'utf8');
	const script = source.split('<script lang="ts" setup>')[1].split('</script>')[0].replace(/^import .*;\r?\n/gm, '');
	const compiled = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
	const cleanup = [];
	const errors = [];
	const canvas = { parentNode: null };
	const listeners = new Map();
	const home = { append: el => { el.parentNode = home; } };
	const container = { appendChild: el => { el.parentNode = container; }, removeChild: el => { if (el.parentNode !== container) throw new Error('Not a child'); el.parentNode = null; } };
	const element = { parentNode: home, getBoundingClientRect: () => ({ width: 640, height: 360 }) };
	const pip = {
		closed: false, focus() {},
		addEventListener: (name, fn) => listeners.set(name, fn),
		removeEventListener: name => listeners.delete(name),
		close() { this.closed = true; listeners.get('pagehide')?.(); },
		document: { addEventListener() {}, removeEventListener() {}, documentElement: { requestFullscreen: async () => { pip.document.fullscreenElement = pip.document.documentElement; } }, exitFullscreen: async () => { pip.document.fullscreenElement = null; }, head: { append() {} }, body: { append: el => { el.parentNode = pip.document.body; } } },
	};
	const document = { querySelectorAll: () => [] };
	let requests = 0;
	const window = { requestAnimationFrame() {}, open: () => pip, addEventListener() {}, removeEventListener() {}, document, documentPictureInPicture: { requestWindow: () => { requests++; return request ? request(pip) : Promise.resolve(pip); } } };
	const env = {
		ref, shallowRef, defineProps: () => ({ title: 'Preview' }), defineEmits: () => () => {}, resolutionFactor: ref(1), watch() {}, useTemplateRef: name => shallowRef(name === 'view' ? element : name === 'canvasContainer' ? container : home),
		onBeforeUnmount: fn => cleanup.push(fn), onMounted: fn => fn(),
		window, document, engine: { canvas }, preferences: { model: () => ref(false) },
		ui: { alert: options => errors.push(options), contextMenu() {} },
	};
	const api = new Function(...Object.keys(env), compiled + '\nreturn { openView, closeView, viewWindow, toggleFullscreen, fullscreen };')(...Object.values(env));
	const previewSource = readFileSync(new URL('../src/components/GsPreview.vue', import.meta.url), 'utf8');
	const previewScript = previewSource.split('<script lang="ts" setup>')[1].split('</script>')[0].replace(/^import .*;\r?\n/gm, '');
	const previewCode = ts.transpileModule(previewScript, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
	new Function(...Object.keys(env), previewCode)(...Object.values(env));

	return { ...api, element, home, pip, window, errors, canvas, container, requests: () => requests, unmount: () => cleanup.forEach(fn => fn()) };
}

test('PiP moves the existing preview and restores it on native close and repeated opening', async () => {
	const p = preview();
	assert.equal(p.canvas.parentNode, p.container);
	await p.openView('pip');
	assert.equal(p.canvas.parentNode, p.container);
	assert.equal(p.element.parentNode, p.pip.document.body);
	await p.openView('pip');
	assert.equal(p.requests(), 1);
	p.pip.close();
	assert.equal(p.element.parentNode, p.home);
	assert.equal(p.viewWindow.value, null);
	p.pip.closed = false;
	await p.openView('pip');
	p.closeView();
	assert.equal(p.element.parentNode, p.home);
	assert.equal(p.pip.closed, true);
	assert.equal(p.canvas.parentNode, p.container);
});

test('unmount releases the engine canvas without destroying it', async () => {
	const p = preview();
	await p.openView('window');
	p.unmount();
	assert.equal(p.canvas.parentNode, null);
	p.container.appendChild(p.canvas);
	assert.equal(p.canvas.parentNode, p.container);
});

test('unmount does not detach the shared canvas from a newer preview', () => {
	const p = preview();
	const other = {};
	p.canvas.parentNode = other;
	p.unmount();
	assert.equal(p.canvas.parentNode, other);
});

test('PiP failure leaves the preview at home and permits retry', async () => {
	const p = preview(() => Promise.reject(new Error('blocked')));
	await p.openView('pip');
	await p.openView('pip');
	assert.equal(p.requests(), 2);
	assert.equal(p.errors.length, 2);
	assert.equal(p.element.parentNode, p.home);
});

test('ordinary window supports fullscreen and returns the same preview on close', async () => {
	const p = preview();
	await p.openView('window');
	assert.equal(p.element.parentNode, p.pip.document.body);
	await p.toggleFullscreen();
	assert.equal(p.pip.document.fullscreenElement, p.pip.document.documentElement);
	await p.toggleFullscreen();
	assert.equal(p.pip.document.fullscreenElement, null);
	p.pip.close();
	assert.equal(p.element.parentNode, p.home);
});

test('blocked popup leaves the preview in place and allows a retry', async () => {
	const p = preview();
	p.window.open = () => null;
	await p.openView('window');
	assert.equal(p.errors.length, 1);
	assert.equal(p.element.parentNode, p.home);
	p.window.open = () => p.pip;
	await p.openView('window');
	assert.equal(p.element.parentNode, p.pip.document.body);
	p.unmount();
	assert.equal(p.pip.closed, true);
});

test('unmount during opening closes the late window; duplicate requests are ignored', async () => {
	let resolve;
	const p = preview(() => new Promise(r => { resolve = r; }));
	const pending = p.openView('pip');
	await p.openView('pip');
	assert.equal(p.requests(), 1);
	p.unmount();
	resolve(p.pip);
	await pending;
	assert.equal(p.pip.closed, true);
	assert.equal(p.element.parentNode, p.home);
});

test('unmount returns the preview before Vue removes its DOM', async () => {
	const p = preview();
	await p.openView('pip');
	p.unmount();
	assert.equal(p.element.parentNode, p.home);
	assert.equal(p.pip.closed, true);
});

test('partial PiP setup failure restores the preview and closes the window', async () => {
	const p = preview();
	p.pip.document.body.append = () => { throw new Error('setup failed'); };
	await p.openView('pip');
	assert.equal(p.element.parentNode, p.home);
	assert.equal(p.pip.closed, true);
	assert.equal(p.viewWindow.value, null);
	assert.equal(p.errors.length, 1);
});
