// 汎用的なUndo/Redo実装。Glitch Studioのドメイン知識を持っていてはならない

import { shallowRef } from 'vue';
import { computed, ref } from 'vue';
import { deepClone } from '@gs/shared/utility/deep-clone.js';
import { triggerRef } from 'vue';

export type CommandDef<S, Payload, Change> = {
	label: string;
	// 確定した状態の変更対象・内容を宣言する。どの通知を同期するか、キャッシュや
	// 実行インスタンスを保持するかは購読側の責務とし、履歴操作でも同じ通知を使う。
	changes: (state: S, payload: Payload) => Change[];
	create: (payload: Payload) => {
		execute(state: S): void;
		undo(state: S): void;
	};
};

type CommandLog<S, Change, T extends Record<string, CommandDef<S, any, Change>>> = {
	type: keyof T;
	date: number;
	execute: (state: S) => void;
	undo: (state: S) => void;
	mergeKey?: string | null;
};

export class UndoRedo<S extends Record<string, any>, Change extends { type: string }[], COMMAND_DEFS extends Record<string, CommandDef<S, Change, any>>> {
	public state: S;
	public undoStack = shallowRef([] as CommandLog<S, Change, COMMAND_DEFS>[]);
	public redoStack = shallowRef([] as CommandLog<S, Change, COMMAND_DEFS>[]);
	public canUndo = computed(() => this.undoStack.value.length > 0);
	public canRedo = computed(() => this.redoStack.value.length > 0);
	private maxUndoStackSize = 100;
	private changeListeners = new Set<(changes: Change[]) => void>();
	private commandDefs: COMMAND_DEFS;

	public onChange(listener: (changes: Change[]) => void): () => void {
		this.changeListeners.add(listener);
		return () => { this.changeListeners.delete(listener); };
	}

	constructor(state: S, commandDefs: COMMAND_DEFS) {
		this.state = state;
		this.commandDefs = commandDefs;
	}

	public commit<T extends keyof COMMAND_DEFS>(type: T, payload: Parameters<COMMAND_DEFS[T]['create']>[0], mergeKey?: string | null) {
		const commandDef = this.commandDefs[type] as CommandDef<S, Parameters<COMMAND_DEFS[typeof type]['create']>[0], Change>;
		const savedPayload = deepClone(payload);
		const actions = commandDef.create(savedPayload);
		const notify = (state: S) => {
			const changes = commandDef.changes(state, savedPayload);
			for (const listener of this.changeListeners) listener(changes);
		};
		// 履歴へ通知込みの操作を保存する。マージされたRedoも最終payloadを通知し、
		// Undoは最初のpayloadを使うので、ドラッグ中も確定後も同じ同期経路を通る。
		const command = {
			execute: (state: S) => { actions.execute(state); notify(state); },
			undo: (state: S) => { actions.undo(state); notify(state); },
		};
		command.execute(this.state);

		const latest = this.undoStack.value.at(-1);
		if (latest != null && mergeKey != null && latest.mergeKey === mergeKey) {
			latest.execute = command.execute;
		} else {
			this.undoStack.value.push({
				type,
				date: Date.now(),
				execute: command.execute,
				undo: command.undo,
				mergeKey,
			});
			if (this.undoStack.value.length > this.maxUndoStackSize) {
				this.undoStack.value.shift();
			}
			triggerRef(this.undoStack);
			console.log('Committed command:', type, deepClone(payload));
		}

		this.redoStack.value = [];
		triggerRef(this.redoStack);
	}

	public undo() {
		const command = this.undoStack.value.pop();
		triggerRef(this.undoStack);
		if (command == null) return;
		command.undo(this.state);
		this.redoStack.value.push(command);
		triggerRef(this.redoStack);
	}

	public redo() {
		const command = this.redoStack.value.pop();
		triggerRef(this.redoStack);
		if (command == null) return;
		command.execute(this.state);
		this.undoStack.value.push(command);
		triggerRef(this.undoStack);
	}
}
