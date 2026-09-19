import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { ref, computed } from 'vue';

function slider(file, props) {
	const source = readFileSync(new URL(`../src/components/common/${file}`, import.meta.url), 'utf8');
	const script = source.split('<script lang="ts" setup>')[1].split('</script>')[0].replace(/^import .*;\r?\n/gm, '');
	const compiled = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
	const events = [];
	const cleanup = [];
	const listeners = new Map();
	const styles = new Set();
	const element = { offsetWidth: 100, clientWidth: 100, style: {}, getBoundingClientRect: () => ({ left: 0, width: 100 }) };
	const document = {
		addEventListener: (name, fn) => listeners.set(name, fn),
		removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); },
		createElement: () => ({ appendChild() {} }), createTextNode: () => ({}),
		head: { appendChild: style => styles.add(style), removeChild: style => styles.delete(style) },
	};
	const window = { ...document, document, ResizeObserver: class { observe() {} disconnect() {} } };
	const env = {
		ref, shallowRef: () => ref(element), computed, watch() {},
		useTemplateRef: name => ref(name === 'thumbEl' ? { offsetWidth: 20 } : element),
		onMounted: fn => fn(), onUnmounted: fn => cleanup.push(fn), onBeforeUnmount: fn => cleanup.push(fn),
		defineProps: () => props, withDefaults: (value, defaults) => ({ ...defaults, ...value }),
		defineEmits: () => (...args) => events.push(args), defineAsyncComponent() {},
		ui: { popup: () => ({ dispose() {} }) }, window, document, ResizeObserver: window.ResizeObserver,
	};
	const api = new Function(...Object.keys(env), compiled + '\nreturn { onMousedown };')(...Object.values(env));
	return { ...api, events, listeners, styles, unmount: () => cleanup.forEach(fn => fn()) };
}

test('range brackets updates, including unchanged and return-to-start drags', () => {
	for (const positions of [[], [50, 90], [50, 10]]) {
		const s = slider('GsRange.vue', { modelValue: 0, min: 0, max: 10, continuousUpdate: true });
		s.onMousedown({ preventDefault() {} });
		for (const clientX of positions) s.listeners.get('mousemove')({ clientX, preventDefault() {} });
		s.listeners.get('mouseup')();
		assert.equal(s.events[0][0], 'beginChanging');
		assert.equal(s.events.at(-1)[0], 'changeFinished');
		assert.equal(s.events.filter(([name]) => name === 'changeFinished').length, 1);
		if (positions.length) assert.equal(s.events.filter(([name]) => name === 'update:modelValue').at(-1)[1], positions.at(-1) === 10 ? 0 : 10);
		assert.equal(s.styles.size, 0);
	}
});

test('range ends the session and removes drag listeners on interruption', () => {
	for (const end of ['touchcancel', 'blur', 'unmount']) {
		const s = slider('GsRange.vue', { modelValue: 0, min: 0, max: 10, continuousUpdate: true });
		s.onMousedown({ preventDefault() {} });
		if (end === 'unmount') s.unmount();
		else s.listeners.get(end)?.();
		assert.equal(s.events.at(-1)[0], 'changeFinished');
		assert.equal(s.listeners.size, 0);
		assert.equal(s.styles.size, 0);
	}
});

//test('two-thumb slider brackets each drag and ignores unrelated mouseup', () => {
//	const s = slider('GsRange2.vue', { modelValue: [0, 10], min: 0, max: 10 });
//	for (const thumb of ['a', 'b']) {
//		s.onMousedown(thumb);
//		s.listeners.get('mousemove')({ pageX: 50 });
//		s.listeners.get('mouseup')();
//		s.listeners.get('mouseup')();
//	}
//	assert.deepEqual(s.events.map(([name]) => name), [
//		'beginChanging', 'update:modelValue', 'changeFinished',
//		'beginChanging', 'update:modelValue', 'changeFinished',
//	]);
//});
