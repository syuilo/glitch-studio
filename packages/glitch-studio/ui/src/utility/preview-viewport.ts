import { getStructFieldDefinitions, isParameterType } from '@gs/shared/parameter/parameter-definition.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { getPreviewParameterBaseValue, preparePreviewParameterValueEdit } from './preview-parameter-editing.ts';
import type { ParameterDefinition, ParameterDefinition_Struct } from '@gs/shared/parameter/parameter-definition.ts';
import type { Viewport2DFields, Viewport2DControl } from '@gs/shared/data-type/data-type-ui.ts';
import type { EditableParameterBinding } from '../types/parameter-edit.ts';
import type { StructParameterFieldBindings } from './struct-parameter-edit.ts';

export type Viewport2DParameterDefinition = ParameterDefinition_Struct<Pick<Viewport2DFields, 'center' | 'zoom'>> & { ui: { control: Viewport2DControl } };
export type PreviewViewportValue = { center: [number, number]; zoom: number; rotation: number };
export type PreviewViewportEdit = {
	readonly active: boolean;
	update(fields: StructParameterFieldBindings): void;
	finish(): void;
	cancel(): void;
};
export type PreviewViewportDrag = {
	readonly active: boolean;
	initialValue: PreviewViewportValue;
	update(value: PreviewViewportValue): void;
	finish(): void;
	cancel(): void;
};
export type PreviewViewportHandle = {
	kind: 'viewport2d';
	key: string;
	label(): string;
	available(): boolean;
	spanAtZoomOne(): number;
	minimumZoom(): number;
	maximumZoom(): number;
	begin(): PreviewViewportDrag | null;
};

export function isViewport2DParameter(definition: ParameterDefinition): definition is Viewport2DParameterDefinition {
	return isParameterType(definition, 'struct') && definition.ui.control.controlType === 'viewport2d';
}

export function getPreviewViewportZoom(definition: ParameterDefinition, binding: EditableParameterBinding, time: number, endTime: number): number | null {
	if (!isViewport2DParameter(definition) || binding.inputSource !== 'literal' || binding.value.zoom == null) return null;
	const value = getPreviewParameterBaseValue(getStructFieldDefinitions(definition).zoom, binding.value.zoom, time, endTime);
	if (typeof value !== 'number' || !Number.isFinite(value)) return null;
	const zoom = Math.min(definition.ui.control.maximumZoom ?? Number.MAX_VALUE, Math.max(definition.ui.control.minimumZoom ?? 0, value));
	return zoom > 0 && Number.isFinite(definition.ui.control.spanAtZoomOne / zoom) ? zoom : null;
}

/** 任意の式をUIで評価せず、既存の位置ハンドルと同じ基準値・キーだけを読む。 */
export function getPreviewViewportValue(definition: ParameterDefinition, binding: EditableParameterBinding, time: number, endTime: number): PreviewViewportValue | null {
	if (!isViewport2DParameter(definition) || binding.inputSource !== 'literal') return null;
	const fields = getStructFieldDefinitions(definition);
	const center = binding.value.center == null ? null : getPreviewParameterBaseValue(fields.center, binding.value.center, time, endTime);
	// 宣言されていない回転だけを0とする。宣言済みの式・参照や不正なBindingを
	// 省略と見なすと、見えている回転と異なる向きで中心を編集してしまう。
	const rotation = fields.rotation == null ? 0 : binding.value.rotation == null ? null : getPreviewParameterBaseValue(fields.rotation, binding.value.rotation, time, endTime);
	const zoom = getPreviewViewportZoom(definition, binding, time, endTime);
	if (!Array.isArray(center) || center.length !== 2 || !center.every(value => typeof value === 'number' && Number.isFinite(value))
		|| zoom == null || typeof rotation !== 'number' || !Number.isFinite(rotation)) return null;
	return { center: [center[0], center[1]], zoom, rotation };
}

export function viewportPlaneOffset(point: [number, number], value: PreviewViewportValue, spanAtZoomOne: number): [number, number] {
	const angle = value.rotation * Math.PI * 2;
	const scale = spanAtZoomOne / value.zoom;
	return [(Math.cos(angle) * point[0] - Math.sin(angle) * point[1]) * scale,
		(Math.sin(angle) * point[0] + Math.cos(angle) * point[1]) * scale];
}

export function panPreviewViewport(value: PreviewViewportValue, movement: [number, number], spanAtZoomOne: number): PreviewViewportValue {
	const offset = viewportPlaneOffset(movement, value, spanAtZoomOne);
	return { ...value, center: [value.center[0] - offset[0], value.center[1] - offset[1]] };
}

/** 変更前後のカーソル直下の参照座標を等しく保つ。回転・縦横比・表示倍率もパンと同じ規約を使う。 */
export function zoomPreviewViewport(value: PreviewViewportValue, point: [number, number], zoom: number, spanAtZoomOne: number): PreviewViewportValue {
	const before = viewportPlaneOffset(point, value, spanAtZoomOne);
	const after = viewportPlaneOffset(point, { ...value, zoom }, spanAtZoomOne);
	return { ...value, zoom, center: [value.center[0] + before[0] - after[0], value.center[1] + before[1] - after[1]] };
}

export function preparePreviewViewportDrag(definition: ParameterDefinition, binding: EditableParameterBinding, time: number, endTime: number,
	session: PreviewViewportEdit): PreviewViewportDrag | null {
	const initialValue = getPreviewViewportValue(definition, binding, time, endTime);
	if (initialValue == null || binding.inputSource !== 'literal') { session.cancel(); return null; }
	const fields = getStructFieldDefinitions(definition);
	const edits = Object.fromEntries(['center', 'zoom'].map(key => [key, preparePreviewParameterValueEdit(fields[key], binding.value[key], time, endTime)]));
	if (edits.center == null || edits.zoom == null) { session.cancel(); return null; }
	let changed = false;
	let updated = false;
	return {
		get active() { return session.active; }, initialValue,
		update(value) {
			const centerChanged = value.center.some((component, axis) => component !== initialValue.center[axis]);
			const zoomChanged = value.zoom !== initialValue.zoom;
			changed = centerChanged || zoomChanged;
			if (!changed && !updated) return;
			updated = true;
			const next: StructParameterFieldBindings = {};
			for (const [key, fieldChanged] of [['center', centerChanged], ['zoom', zoomChanged]] as const) {
				// 開始値に戻った項目は、新規キーも取り除いた元のBindingへ戻す。
				// 一方だけ変更したパンでも、倍率側に不要なキーを作らない。
				const edit = edits[key]!(value[key]);
				next[key] = !fieldChanged ? deepClone(binding.value[key]) : edit.kind === 'literal' ? { inputSource: 'literal', value: edit.value } : edit.value;
			}
			session.update(next);
		},
		finish() { if (changed) session.finish(); else session.cancel(); },
		cancel: session.cancel,
	};
}
