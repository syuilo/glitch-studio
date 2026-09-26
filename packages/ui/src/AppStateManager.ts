import { shallowRef } from 'vue';
import { computed, ref } from 'vue';
import { deepClone } from '@glitch/shared/utility/deep-clone.js';
import { triggerRef } from 'vue';
import { COMMAND_DEFS } from './commands.ts';
import type { Timeline } from '@glitch/shared/timeline/types.js';
import type { Asset, Player } from '@glitch/shared/types.js';
import type { VisualModule } from '@glitch/shared/visual-module/types.js';
import type { CommandDef } from './commands.ts';
import type { AppState } from './types.ts';

type CommandLog = {
	type: keyof typeof COMMAND_DEFS;
	date: number;
	execute: (state: AppState) => void;
	undo: (state: AppState) => void;
	mergeKey?: string | null;
};

export class AppStateManager {
	public state: AppState;
	public undoStack = shallowRef([] as CommandLog[]);
	public redoStack = shallowRef([] as CommandLog[]);
	public canUndo = computed(() => this.undoStack.value.length > 0);
	public canRedo = computed(() => this.redoStack.value.length > 0);
	private maxUndoStackSize = 100;

	constructor() {
		this.state = {
			resolution: ref<{ width: number; height: number }>({ width: 1024, height: 1024 }),
			assets: ref<Asset[]>([]), // TODO: バイナリをリアクティブでwrapするのをやめる
			players: ref<Player[]>([]),
			visualModules: ref<VisualModule[]>([]),
			timeline: ref<Timeline>([]),
		};
	}

	public commit<T extends keyof typeof COMMAND_DEFS>(type: T, payload: Parameters<typeof COMMAND_DEFS[T]['create']>[0], mergeKey?: string | null) {
		const commandDef = COMMAND_DEFS[type] as CommandDef<any>;
		const command = commandDef.create(deepClone(payload));
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

	public getVisualModuleById(id: VisualModule['id']) {
		return this.state.visualModules.value.find(vm => vm.id === id) ?? null;
	}
}
