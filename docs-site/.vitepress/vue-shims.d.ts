// tscでテーマのTypeScriptを検査する際に、Vueコンポーネントのimportを解決する。
declare module '*.vue' {
	import type { DefineComponent } from 'vue';
	const component: DefineComponent;
	export default component;
}
