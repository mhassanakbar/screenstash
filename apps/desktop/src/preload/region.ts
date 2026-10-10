import { contextBridge, ipcRenderer } from 'electron';
import {
  captureChannels,
  regionContextSchema,
  regionSelectionSchema,
  type RegionBridge,
} from '../contracts/capture';
const bridge: RegionBridge = {
  context: async () =>
    regionContextSchema.parse(
      await ipcRenderer.invoke(captureChannels.regionContext),
    ),
  select: (value) =>
    ipcRenderer.invoke(
      captureChannels.regionSelect,
      regionSelectionSchema.parse(value),
    ),
};
contextBridge.exposeInMainWorld('screenstashRegion', Object.freeze(bridge));
