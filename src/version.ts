import * as electron from 'electron';

const isRenderer = (process && process.type === 'renderer');
export const version = isRenderer ? electron.remote.app.getVersion() : electron.app.getVersion();
