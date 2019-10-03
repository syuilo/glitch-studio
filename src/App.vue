<template>
<main id="app">
	<div class="histogram" v-if="histogram && showHistogram">
		<XHistogram :histogram="histogram"/>
	</div>
	<div class="a">
		<div class="view">
			<div class="_gs-container" dropzone="copy" @dragover.prevent="e => { e.dataTransfer.dropEffect = 'copy'; }" @drop.prevent="onDrop">
				<div @click="img ? () => {} : openImage()">
					<canvas :width="subStore.imageWidth" :height="subStore.imageHeight" ref="canvas"/>
				</div>
			</div>
		</div>
		<div class="side">
			<div class="tab">
				<div :class="{ active: tab === 'layers' }" @click="tab = 'layers'"><fa :icon="faLayerGroup"/>{{ $t('Fx') }}<span>({{ $store.state.layers.length }})</span></div>
				<div :class="{ active: tab === 'macros' }" @click="tab = 'macros'"><fa :icon="faSlidersH"/>{{ $t('Macro') }}<span>({{ $store.state.macros.length }})</span></div>
				<div :class="{ active: tab === 'assets' }" @click="tab = 'assets'"><fa :icon="faFolderOpen"/>{{ $t('Asset') }}<span>({{ $store.state.assets.length }})</span></div>
			</div>
			<XLayers v-show="tab === 'layers'"/>
			<XMacros v-show="tab === 'macros'"/>
			<XAssets v-show="tab === 'assets'"/>
		</div>
	</div>
	<footer class="footer">
		<div class="histogram">
			<template v-if="histogram">
				<div class="r"><div :style="{ height: ((histogram.rAmount / (255 * subStore.imageWidth * subStore.imageHeight)) * 100) + '%' }"></div></div>
				<div class="g"><div :style="{ height: ((histogram.gAmount / (255 * subStore.imageWidth * subStore.imageHeight)) * 100) + '%' }"></div></div>
				<div class="b"><div :style="{ height: ((histogram.bAmount / (255 * subStore.imageWidth * subStore.imageHeight)) * 100) + '%' }"></div></div>
			</template>
			<template v-else>
				<div class="r"><div></div></div>
				<div class="g"><div></div></div>
				<div class="b"><div></div></div>
			</template>
		</div>
		<div class="file">{{ subStore.imageWidth }} x {{ subStore.imageHeight }} px</div>
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
import * as semver from 'semver';
import hasha from 'hasha';
import uuid from 'uuid/v4';
import { faLayerGroup, faSlidersH } from '@fortawesome/free-solid-svg-icons';
import { faFolderOpen } from '@fortawesome/free-regular-svg-icons';
import Vue from 'vue';
import XLayers from './components/layers.vue';
import XMacros from './components/macros.vue';
import XAssets from './components/assets.vue';
import XAbout from './components/about.vue';
import XSavePreset from './components/save-preset.vue';
import XExportPreset from './components/export-preset.vue';
import XHistogram from './components/histogram.vue';
import { render, Histogram } from './glitch';
import { ipcRenderer } from 'electron';
import { SettingsStore, Preset } from './settings';
import { version } from './version';
import { decode } from '@msgpack/msgpack';
import { subStore } from './sub-store';
import { loadImage } from './load-image';
import { Image } from './core';

export default Vue.extend({
	name: 'app',

	components: {
		XLayers,
		XMacros,
		XAssets,
		XAbout,
		XSavePreset,
		XExportPreset,
		XHistogram,
	},

	data() {
		return {
			subStore,
			img: null as Image | null,
			imgHash: null as string | null,
			histogram: null as Histogram | null,
			status: null as string | null,
			progress: 0,
			tab: 'layers',
			presetName: '',
			showHistogram: subStore.settingsStore.settings.showHistogram,
			showAbout: false,
			showSavePresetDialog: false,
			showExportPresetDialog: false,
			faLayerGroup, faSlidersH, faFolderOpen
		};
	},

	computed: {
		canvas(): HTMLCanvasElement {
			return this.$refs.canvas as HTMLCanvasElement;
		}
	},

	mounted() {
		(this.$root as any).titleBar.updateTitle('<b>Glitch Studio</b>');

		this.$watch('$store.state.layers', () => {
			this.render();
		}, { deep: true });

		this.$watch('$store.state.macros', () => {
			this.render();
		}, { deep: true });

		this.$root.$on('openImage', () => {
			this.openImage();
		});

		this.$root.$on('saveImage', () => {
			this.saveImage();
		});

		this.$root.$on('undo', () => {
			if ((this as any).canUndo) (this as any).undo();
		});

		this.$root.$on('redo', () => {
			if ((this as any).canRedo) (this as any).redo();
		});

		this.$root.$on('about', () => {
			this.showAbout = true;
		});

		this.$root.$on('savePreset', () => {
			this.showSavePresetDialog = true;
		});

		this.$root.$on('exportPreset', () => {
			this.showExportPresetDialog = true;
		});

		this.$root.$on('importPreset', () => {
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
				const preset = decode(data) as Preset;
				if (semver.gt(preset.gsVersion, version)) {
					alert(this.$t('PresetVersionWarn', { current: version, newer: preset.gsVersion }));
					return;
				}
				subStore.settingsStore.settings.presets.push(preset);
				subStore.settingsStore.save();
				this.$root.$emit('updateMenu');
			}
		});

		this.$root.$on('applyPreset', (id: string) => {
			const preset = subStore.settingsStore.settings.presets.find(p => p.id === id);
			this.$store.commit('applyPreset', preset);
		});

		this.$root.$on('removePreset', (id: string) => {
			subStore.settingsStore.settings.presets = subStore.settingsStore.settings.presets.filter(p => p.id !== id);
			subStore.settingsStore.save();
			this.$root.$emit('updateMenu');
		});

		this.$root.$on('changeShowAllParams', (v: boolean) => {
			subStore.showAllParams = v;
		});

		this.$root.$on('changeShowHistogram', (v: boolean) => {
			this.showHistogram = v;
		});

		this.$root.$on('init', () => {
			this.$store.commit('init');
		});
	},

	beforeDestroy() {
		this.$root.$off('openImage');
		this.$root.$off('saveImage');
		this.$root.$off('addFx');
	},

	methods: {
		openImage() {
			const paths = electron.remote.dialog.showOpenDialogSync(electron.remote.BrowserWindow.getFocusedWindow()!, {
				properties: ['openFile'],
				filters: [{
					name: 'Image',
					extensions: ['png', 'jpg', 'jpe', 'jpeg', '.jfif', '.jfi', '.jif', 'bmp', 'tiff', 'tif']
				}]
			});
			if (paths == null) return;
			this.openImageFromPath(paths[0]);
		},

		async openImageFromPath(path: string) {
			const buffer = fs.readFileSync(path);
			this.img = loadImage(buffer);
			this.imgHash = hasha(buffer);
			document.title = `Glitch Studio (${path})`;
			(this.$root as any).titleBar.updateTitle(`<b>Glitch Studio</b> <span style="opacity: 0.7;">(${path})</span>`);
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
			subStore.rendering = true;

			await render(this.img!, this.imgHash!, this.$store.state.layers, this.$store.state.macros, this.$store.state.assets, (w, h) => new Promise((res, rej) => {
				subStore.imageWidth = w;
				subStore.imageHeight = h;
				this.$nextTick(() => {
					res(this.canvas.getContext('2d')!);
				});
			}), (histogram: Histogram) => {
				this.histogram = histogram;
			}, (max, done, status, args) => {
				this.status = status;
				this.progress = done / max * 100;
				if (args && args.processingFxId) subStore.processingFxId = args.processingFxId;
			});

			subStore.processingFxId = null;
			subStore.rendering = false;
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
	line-height: 15px;

	&:focus {
		border-color: $theme-color;
	}
}

input[type=range] {
	appearance: none;
	height: 4px;
	width: 100%;
	background: #111;
	border-bottom: solid 1px rgba(255, 255, 255, 0.1);
	border-radius: 4px;
	margin: 10px 0 10px 0;

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

button,
input[type=color] {
	appearance: none;
}

button,
select,
input[type=color] {
	display: block;
	box-sizing: border-box;
	border: solid 1px rgba(0, 0, 0, 0.7);
	border-radius: 4px;
	background: linear-gradient(0deg, rgba(0, 0, 0, 0), rgba(255, 255, 255, 0.05));
	box-shadow: 0 1px 1px rgba(0, 0, 0, 0.1), 0 1px 0 rgba(255, 255, 255, 0.1) inset;
	color: #fff;
	padding: 4px 6px;
	outline: none;
	width: 100%;
	cursor: pointer;
	line-height: 15px;

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

select {
	padding: 3px 6px;
}

input[type=color] {
	padding: 0 2px;
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
		bottom: 64px + 8px;
		left: 32px + 8px;
		padding: 16px;
		pointer-events: none;
		background: rgba(0, 0, 0, 0.5);
		backdrop-filter: blur(8px);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
		border-radius: 4px;
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

					> canvas {
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
					line-height: 16px;

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
