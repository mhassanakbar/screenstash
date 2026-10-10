import { contextBridge, ipcRenderer } from 'electron';
import { exposeClerkBridge } from '@clerk/electron/preload';
import {
  bridgeChannels,
  configurationSchema,
  identitySchema,
  captureProbeSchema,
  type DesktopBridge,
} from '../contracts/bridge';

exposeClerkBridge();
const bridge: DesktopBridge = {
  appName: 'ScreenStash',
  configuration: async () =>
    configurationSchema.parse(
      await ipcRenderer.invoke(bridgeChannels.configuration),
    ),
  authenticate: async () =>
    identitySchema.parse(await ipcRenderer.invoke(bridgeChannels.authenticate)),
  invalidateAuthentication: () => ipcRenderer.invoke(bridgeChannels.invalidate),
  probeCapture: async () =>
    captureProbeSchema.parse(
      await ipcRenderer.invoke(bridgeChannels.probeCapture),
    ),
  openVault: () => ipcRenderer.invoke(bridgeChannels.openVault),
  onTokenRequest(provider) {
    const listener = async (
      _event: Electron.IpcRendererEvent,
      value: unknown,
    ) => {
      const requestId =
        value && typeof value === 'object' && 'requestId' in value
          ? value.requestId
          : undefined;
      if (typeof requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(requestId))
        return;
      let token: string | null = null;
      try {
        token = await provider();
      } catch {
        /* Offline/expired sessions return no credential. */
      }
      await ipcRenderer
        .invoke(bridgeChannels.tokenReply, { requestId, token })
        .catch(() => {});
    };
    ipcRenderer.on(bridgeChannels.tokenRequest, listener);
    return () => {
      ipcRenderer.removeListener(bridgeChannels.tokenRequest, listener);
    };
  },
};
contextBridge.exposeInMainWorld('screenstash', Object.freeze(bridge));
