<template>
<main id="app">
	<div class="histogram" v-if="histogram">
		<canvas width="300" height="200" ref="histogram"/>
	</div>
	<div class="a">
		<div class="view">
			<div class="_gs-container" dropzone="copy" @dragover.prevent="e => { e.dataTransfer.dropEffect = 'copy'; }" @drop.prevent="onDrop">
				<div @click="img ? () => {} : openImage()">
					<canvas :width="width" :height="height" ref="canvas"/>
				</div>
			</div>
		</div>
		<div class="side">
			<div class="tab">
				<div :class="{ active: tab === 'fx' }" @click="tab = 'fx'"><fa :icon="faLayerGroup"/>FX<span>({{ $store.state.layers.length }})</span></div>
				<div :class="{ active: tab === 'macro' }" @click="tab = 'macro'"><fa :icon="faSlidersH"/>Macro<span>({{ $store.state.macros.length }})</span></div>
				<div :class="{ active: tab === 'meta' }" @click="tab = 'meta'"><fa :icon="faInfoCircle"/>Meta</div>
			</div>
			<XLayers v-show="tab === 'fx'" :processing-fx-id="processingFxId" :rendering="isRendering"/>
			<XMacros v-show="tab === 'macro'"/>
			<div v-show="tab === 'meta'" class="meta _gs-container">
				<input type="text" v-model="presetName"/>
				<button @click="savePreset()">Save preset</button>
			</div>
		</div>
	</div>
	<footer class="footer">
		<div class="histogram">
			<template v-if="histogram">
				<div class="r"><div :style="{ height: ((histogram.rAmount / (255 * width * height)) * 100) + '%' }"></div></div>
				<div class="g"><div :style="{ height: ((histogram.gAmount / (255 * width * height)) * 100) + '%' }"></div></div>
				<div class="b"><div :style="{ height: ((histogram.bAmount / (255 * width * height)) * 100) + '%' }"></div></div>
			</template>
			<template v-else>
				<div class="r"><div></div></div>
				<div class="g"><div></div></div>
				<div class="b"><div></div></div>
			</template>
		</div>
		<div class="file">{{ width }} x {{ height }} px</div>
		<div class="progress">
			<div><div :style="{ width: progress + '%' }"></div></div>
		</div>
		<div class="status">{{ status }}</div>
	</footer>
	<XSavePreset v-if="showSavePresetDialog" @ok="showSavePresetDialog = false"/>
	<XExportPreset v-if="showExportPresetDialog" @ok="showExportPresetDialog = false"/>
	<XAbout v-if="showAbout" @ok="showAbout = false"/>
</main>
</template>

<script lang="ts">
import * as fs from 'fs';
import * as electron from 'electron';
import uuid from 'uuid/v4';
import { faLayerGroup, faSlidersH, faInfoCircle } from '@fortawesome/free-solid-svg-icons';
import Vue from 'vue';
const Jimp = require('jimp');
import XLayers from './components/layers.vue';
import XMacros from './components/macros.vue';
import XAbout from './components/about.vue';
import XSavePreset from './components/save-preset.vue';
import XExportPreset from './components/export-preset.vue';
import { render, Histogram } from './glitch';
import { ipcRenderer } from 'electron';
import { SettingsStore } from './settings';
import { version } from './version';
import { decode } from '@msgpack/msgpack';

export default Vue.extend({
	name: 'app',

	components: {
		XLayers,
		XMacros,
		XAbout,
		XSavePreset,
		XExportPreset,
	},

	data() {
		return {
			img: null,
			width: 0,
			height: 0,
			isRendering: false,
			histogram: null as Histogram | null,
			status: null as string | null,
			processingFxId: null,
			progress: 0,
			tab: 'fx',
			presetName: '',
			showAbout: false,
			showSavePresetDialog: false,
			showExportPresetDialog: false,
			faLayerGroup, faSlidersH, faInfoCircle
		};
	},

	computed: {
		canvas(): HTMLCanvasElement {
			return this.$refs.canvas as HTMLCanvasElement;
		}
	},

	watch: {
		histogram() {
			if (this.histogram == null) {

			} else {
				
			}
		}
	},

	mounted() {
		this.$watch('$store.state.layers', () => {
			this.render();
		}, { deep: true });

		this.$watch('$store.state.macros', () => {
			this.render();
		}, { deep: true });

		ipcRenderer.on('openImage', () => {
			this.openImage();
		});

		ipcRenderer.on('saveImage', () => {
			this.saveImage();
		});

		ipcRenderer.on('addFx', (_, name) => {
			this.$store.commit('addLayer', {
				fx: name,
				id: uuid()
			});
		});

		ipcRenderer.on('undo', () => {
			if ((this as any).canUndo) (this as any).undo();
		});

		ipcRenderer.on('redo', () => {
			if ((this as any).canRedo) (this as any).redo();
		});

		ipcRenderer.on('about', () => {
			this.showAbout = true;
		});

		ipcRenderer.on('savePreset', () => {
			this.showSavePresetDialog = true;
		});

		ipcRenderer.on('exportPreset', () => {
			this.showExportPresetDialog = true;
		});

		ipcRenderer.on('importPreset', () => {
			const paths = electron.remote.dialog.showOpenDialogSync(electron.remote.BrowserWindow.getFocusedWindow()!, {
				properties: ['openFile', 'multiSelections'],
				filters: [{
					name: 'Glitch Studio Preset',
					extensions: ['gsp']
				}]
			});
			if (paths == null) return;
			for (const path of paths) {
				const data = fs.readFileSync(path);
				const preset = decode(data);
				((this as any).$root.settingsStore as SettingsStore).settings.presets.push(preset as any);
				((this as any).$root.settingsStore as SettingsStore).save();
				ipcRenderer.send('updatePresets', ((this as any).$root.settingsStore as SettingsStore).settings.presets.map(p => ({
					id: p.id, name: p.name
				})));
			}
		});

		ipcRenderer.on('applyPreset', (_, id) => {
			const preset = ((this as any).$root.settingsStore as SettingsStore).settings.presets.find(p => p.id === id);
			this.$store.commit('applyPreset', preset);
		});

		ipcRenderer.on('removePreset', (_, id) => {
			((this as any).$root.settingsStore as SettingsStore).settings.presets = ((this as any).$root.settingsStore as SettingsStore).settings.presets.filter(p => p.id !== id);
			((this as any).$root.settingsStore as SettingsStore).save();
			ipcRenderer.send('updatePresets', ((this as any).$root.settingsStore as SettingsStore).settings.presets.map(p => ({
				id: p.id, name: p.name
			})));
		});
	},

	beforeDestroy() {
		ipcRenderer.removeAllListeners('openImage');
		ipcRenderer.removeAllListeners('saveImage');
		ipcRenderer.removeAllListeners('addFx');
	},

	methods: {
		openImage() {
			const paths = electron.remote.dialog.showOpenDialogSync(electron.remote.BrowserWindow.getFocusedWindow()!, {
				properties: ['openFile'],
				filters: [{
					name: 'Image',
					extensions: ['png', 'jpg', 'jpe', 'jpeg', 'bmp', 'tiff']
				}]
			});
			if (paths == null) return;
			this.openImageFromPath(paths[0]);
		},

		async openImageFromPath(path: string) {
			this.img = await Jimp.read(path);
			document.title = `Glitch Studio (${path})`;
			(this.$root as any).titleBar.updateTitle();
			this.render();
		},

		saveImage() {
			const path = electron.remote.dialog.showSaveDialogSync(electron.remote.BrowserWindow.getFocusedWindow()!, {
				filters: [{
					name: 'Image',
					extensions: ['png']
				}]
			});
			if (path == null) return;
			this.canvas.toBlob(blob => {
				const reader = new FileReader();
				reader.onload = () => {
					fs.writeFile(path, new Buffer(reader.result as ArrayBuffer), error => {
						if (error != null) {
							alert("save error.");
							return;
						}
					})
				};
				reader.readAsArrayBuffer(blob!);
			});
		},

		async render() {
			this.isRendering = true;

			await render(this.img, this.$store.state.layers, this.$store.state.macros, (w, h) => new Promise((res, rej) => {
				this.width = w;
				this.height = h;
				this.$nextTick(() => {
					res(this.canvas.getContext('2d')!);
				});
			}), (histogram: Histogram) => {
				this.histogram = histogram;
			}, (max, done, status, args) => {
				this.status = status;
				this.progress = done / max * 100;
				if (args && args.processingFxId) this.processingFxId = args.processingFxId;
			});

			this.processingFxId = null;
			this.isRendering = false;
		},

		onDrop(ev: DragEvent) {
			this.openImageFromPath(ev.dataTransfer!.files[0].path);
		},
	}
});
</script>

<style lang="scss">
$theme-color: #bb6100;

* {
	user-select: none;

	&::-webkit-scrollbar {
		width: 6px;
		height: 6px;
	}

	&::-webkit-scrollbar-track {
		background: transparent;
	}

	&::-webkit-scrollbar-thumb {
		background: #333;
		border-radius: 4px;
	}
}

html {
	height: 100%;
	background: #222;
	color: #fff;
	font-family: 'Avenir', Helvetica, Arial, sans-serif;
	-webkit-font-smoothing: antialiased;
	-moz-osx-font-smoothing: grayscale;
}

body {
	height: 100%;
}

._gs-link {
	color: $theme-color;
	cursor: pointer;
	text-decoration: none;

	&:hover {
		text-decoration: underline;
	}
}

input[type=text],
input[type=number] {
	display: block;
	box-sizing: border-box;
	appearance: none;
	border: solid 1px rgba(255, 255, 255, 0.1);
	border-radius: 4px;
	background: rgba(0, 0, 0, 0.3);
	box-shadow: 0 2px 1px rgba(0, 0, 0, 0.5) inset;
	color: #fff;
	padding: 4px 6px;
	outline: none;
	width: 100%;

	&:focus {
		border-color: $theme-color;
	}
}

input[type=range] {
	appearance: none;
	height: 5px;
	width: 100%;
	background: #111;
	border-bottom: solid 1px rgba(255, 255, 255, 0.1);
	border-radius: 4px;
	margin: 0 0 7px 0;

	&::-webkit-slider-thumb {
		appearance: none;
		border: solid 1px rgba(0, 0, 0, 0.7);
		background: linear-gradient(0deg, #1b1b1b, #2a2a2a);
		box-shadow: 0 1px 1px rgba(0, 0, 0, 0.1), 0 1px 0 rgba(255, 255, 255, 0.1) inset;
		height: 20px;
		width: 20px;
		border-radius: 20px;
		cursor: ew-resize;
		margin-top: 0px;

		&:hover {
			background: linear-gradient(0deg, #252525, #303030);
		}
	}

	&:focus {
		outline: none;

		&::-webkit-slider-thumb {
			border-color: $theme-color;
		}
	}
}

input.expression {
	background: rgba(55, 64, 28, 0.3);
}

select, button {
	display: block;
	box-sizing: border-box;
	appearance: none;
	border: solid 1px rgba(0, 0, 0, 0.7);
	border-radius: 4px;
	background: linear-gradient(0deg, rgba(0, 0, 0, 0), rgba(255, 255, 255, 0.05));
	box-shadow: 0 1px 1px rgba(0, 0, 0, 0.1), 0 1px 0 rgba(255, 255, 255, 0.1) inset;
	color: #fff;
	padding: 4px 6px;
	outline: none;
	width: 100%;
	cursor: pointer;

	&:focus {
		border-color: $theme-color;
	}

	&:hover {
		background: linear-gradient(0deg, rgba(255, 255, 255, 0.02), rgba(255, 255, 255, 0.07));
	}

	&:active {
		background: linear-gradient(180deg, rgba(0, 0, 0, 0), rgba(255, 255, 255, 0.05));
		box-shadow: 0 1px 1px rgba(0, 0, 0, 0.1) inset;
	}

	&.primary {
		background: linear-gradient(0deg, darken($theme-color, 5%), lighten($theme-color, 10%));
		background-clip: padding-box;
		box-shadow: 0 1px 1px rgba(0, 0, 0, 0.1), 0 1px 0 rgba(255, 255, 255, 0.3) inset;

		&:hover {
			background: linear-gradient(0deg, darken($theme-color, 0%), lighten($theme-color, 15%));
		}

		&:active {
			background: linear-gradient(180deg, darken($theme-color, 10%), lighten($theme-color, 5%));
		}
	}
}

option {
	background: #222;
}

optgroup {
	background: #333;
}

#app {
	$padding: 6px;

	box-sizing: border-box;
	height: calc(100% - #{$padding});
	width: calc(100% - (#{$padding} * 2));
	margin: 0 $padding $padding $padding;
	background: #181818;
	border: solid 1px rgba(255, 255, 255, 0.1);
	border-radius: 6px;
	overflow: hidden;

	> .histogram {
		position: fixed;
	}

	> .a {
		display: flex;
		height: calc(100% - 32px);
		box-shadow: 0 2px 2px -1px rgba(0, 0, 0, 0.7) inset;

		> .view {
			width: 70%;
			height: 100%;
			box-sizing: border-box;
			padding: 8px 0 8px 8px;

			> div {
				width: 100%;
				height: 100%;
				box-sizing: border-box;
				padding: 16px;

				> div {
					width: 100%;
					height: 100%;
					$color1: #3a3a3a;
					$color2: #303030;
					background-color: $color1;
					background-image: linear-gradient(45deg, $color2 25%, transparent 25%, transparent 75%, $color2 75%, $color2), linear-gradient(-45deg, $color2 25%, transparent 25%, transparent 75%, $color2 75%, $color2);
					background-size: 24px 24px;
					animation: bg 0.7s linear infinite;

					> * {
						display: block;
						width: 100%;
						height: 100%;
						object-fit: contain;
					}
				}
			}
		}

		> .side {
			width: 30%;
			height: 100%;
			box-sizing: border-box;
			display: flex;
			flex-direction: column;
			padding: 8px;

			> .tab {
				> div {
					display: inline-block;
					border: solid 1px rgba(255, 255, 255, 0.1);
					border-bottom: solid 1px transparent;
					border-radius: 4px 4px 0 0;
					padding: 8px 12px;
					margin-bottom: -1px;
					z-index: 1;
					position: relative;
					font-size: 12px;
					cursor: pointer;
					color: rgba(255, 255, 255, 0.7);

					&:hover {
						color: #fff;
					}

					&.active {
						background: #202020;
						border-bottom: solid 1px #202020;
						cursor: default;
						font-weight: bold;
						color: #fff;
					}

					> *:first-child {
						margin-right: 6px;
					}

					> span {
						margin-left: 6px;
						opacity: 0.7;
						font-size: 80%;
					}
				}
			}

			> .tab + * {
				border-top-left-radius: 0;
			}

			> .tab + * + * {
				border-top-left-radius: 0;
			}

			> .meta {
				display: flex;
				flex-direction: column;
				box-sizing: border-box;
				height: 100%;
				padding: 8px;
			}
		}
	}

	> .footer {
		height: 32px;
		box-sizing: border-box;
		background: linear-gradient(0deg, rgba(0, 0, 0, 0.1), rgba(255, 255, 255, 0.025));
		border-top: solid 1px rgba(255, 255, 255, 0.1);
		line-height: 32px;
		font-size: 12px;
		padding: 0 12px;

		> * {
			float: left;
		}

		> .histogram {
			margin-right: 16px;
			padding: 4px 0 0 0;

			> div {
				display: inline-block;
				width: 4px;
				height: 16px;
				border-top: solid 1px transparent;
				border-bottom: solid 1px #383838;
				background: #111;
				box-shadow: 0px 1px 1px rgba(0, 0, 0, 0.3) inset;
				position: relative;
				border-radius: 2px;
				overflow: hidden;

				&:not(:last-child) {
					margin-right: 8px;
				}

				> div {
					position: absolute;
					bottom: 0;
					width: 4px;
				}

				&.r > div {
					background: #f00;
				}

				&.g > div {
					background: #0f0;
				}

				&.b > div {
					background: #00f;
				}
			}
		}

		> .file {
			opacity: 0.8;
		}

		> .progress {
			margin-left: 16px;
			padding: 13px 0 0 0;

			> div {
				width: 150px;
				height: 4px;
				border-top: solid 1px transparent;
				border-bottom: solid 1px #383838;
				background: #111;
				box-shadow: 0px 1px 1px rgba(0, 0, 0, 0.3) inset;
				position: relative;
				border-radius: 2px;
				overflow: hidden;

				> div {
					position: absolute;
					height: 8px;
					background: $theme-color;
				}
			}
		}

		> .status {
			margin-left: 16px;
		}
	}
}

body > .titlebar.inactive + div {
	background: #2c2c2c;
}

._gs-container {
	background: #202020;
	border: solid 1px rgba(255, 255, 255, 0.1);
	border-radius: 4px;
	box-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
	overflow: hidden;
}

._gs-no-contents {
	margin: 16px;
	text-align: center;
	font-size: 12px;
	opacity: 0.7;
}

@keyframes bg {
	0% {
		background-position: 0 0;
	}

	100% {
		background-position: -24px -24px;
	}
}
</style>
