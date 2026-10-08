import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld(
  'screenstash',
  Object.freeze({ appName: 'ScreenStash' }),
);
