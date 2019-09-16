<template>
<main id="app">
	<div class="a">
		<div class="view">
			<div class="ui-container">
				<canvas :width="width" :height="height" ref="canvas"/>
			</div>
		</div>
		<div class="side">
			<XLayers/>
		</div>
	</div>
	<footer class="footer">
		<span class="file">{{ width }} x {{ height }} px</span>
		<span class="progress">{{ status }}</span>
	</footer>
</main>
</template>

<script lang="ts">
import * as fs from 'fs';
import * as electron from 'electron';
import Vue from 'vue';
const Jimp = require('jimp');
import XLayers from './components/layers.vue';
import { render } from './glitch';
import { ipcRenderer } from 'electron';

export default Vue.extend({
	name: 'app',

	components: {
		XLayers
	},

	data() {
		return {
			img: null,
			width: 0,
			height: 0,
			status: null as string | null,
		};
	},

	computed: {
		canvas(): HTMLCanvasElement {
			return this.$refs.canvas as HTMLCanvasElement;
		}
	},

	mounted() {
		this.$watch('$store.state.layers', () => {
			this.render();
		}, { deep: true });

		ipcRenderer.on('openImage', () => {
			this.openImage();
		});

		ipcRenderer.on('saveImage', () => {
			this.saveImage();
		});

		ipcRenderer.on('addFx', (_, name) => {
			this.$store.commit('addLayer', { fx: name });
		});
	},

	beforeDestroy() {
		ipcRenderer.removeAllListeners('openImage');
		ipcRenderer.removeAllListeners('saveImage');
		ipcRenderer.removeAllListeners('addFx');
	},

	methods: {
		async openImage() {
			const paths = electron.remote.dialog.showOpenDialogSync(electron.remote.BrowserWindow.getFocusedWindow()!, {
				properties: ['openFile'],
				filters: [{
					name: 'Image',
					extensions: ['png', 'jpg']
				}]
			});
			if (paths == null) return;
			this.img = await Jimp.read(paths[0]);
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

		render() {
			render(this.img, this.$store.state.layers, (w, h) => new Promise((res, rej) => {
				this.width = w;
				this.height = h;
				this.$nextTick(() => {
					res(this.canvas.getContext('2d')!);
				});
			}), (max, done, status) => {
				this.status = status;

				return new Promise((res) => {
					this.$nextTick(() => {
						setTimeout(res, 1);
					});
				});
			});
		}
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

	> .a {
		display: flex;
		height: calc(100% - 32px);
		box-shadow: 0 2px 2px -1px rgba(0, 0, 0, 0.3) inset;

		> .view {
			width: 70%;
			height: 100%;
			box-sizing: border-box;
			padding: 4px;

			> div {
				width: 100%;
				height: 100%;
				box-sizing: border-box;
				padding: 8px;

				> * {
					display: block;
					width: 100%;
					height: 100%;
					object-fit: contain;
				}
			}
		}

		> .side {
			width: 30%;
			height: 100%;
			display: flex;
			flex-direction: column;

			> * {
				margin: 4px;
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

		> .file {
			opacity: 0.8;
		}

		> .progress {
			margin-left: 16px;
		}
	}
}

body > .titlebar.inactive + div {
	background: #2c2c2c;
}

.ui-container {
	border: solid 1px rgba(255, 255, 255, 0.1);
	border-radius: 4px;
	box-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
	overflow: hidden;
}
</style>
