export class WebUSBBridge {
  private device: any = null;
  private endpointOut: number = 0;
  public isActive = false;

  async requestDevice(): Promise<boolean> {
    if (!(navigator as any).usb) {
      console.warn("WebUSB is not supported in this browser.");
      return false;
    }

    try {
      // Prompt user to select USB Audio device
      // Removing strict { classCode: 1 } filter because standard UAC devices are protected.
      // We allow any device explicitly picked by user to support Audiophile Vendor-Specific DACs.
      this.device = await (navigator as any).usb.requestDevice({ filters: [] });
      await this.device.open();
      
      if (this.device.configuration === null) {
        await this.device.selectConfiguration(1);
      }
      
      // Find the Audio Streaming or Vendor Specific interface
      let asInterfaceNumber = -1;
      for (const config of this.device.configurations) {
        for (const iface of config.interfaces) {
          for (const alt of iface.alternates) {
            // Check for Audio Streaming (1, 2) or Vendor Specific (255) interface
            if ((alt.interfaceClass === 1 && alt.interfaceSubclass === 2) || alt.interfaceClass === 255) { 
              asInterfaceNumber = iface.interfaceNumber;
              // Find the OUT endpoint (isochronous or bulk)
              for (const ep of alt.endpoints) {
                if (ep.direction === 'out') {
                  this.endpointOut = ep.endpointNumber;
                  break;
                }
              }
              if (this.endpointOut > 0) break;
            }
          }
          if (this.endpointOut > 0) break;
        }
        if (this.endpointOut > 0) break;
      }

      if (asInterfaceNumber === -1 || this.endpointOut === 0) {
        throw new Error("Could not find Audio Streaming interface with OUT endpoint.");
      }

      await this.device.claimInterface(asInterfaceNumber);
      this.isActive = true;
      return true;
    } catch (e: any) {
      // COMPAT-01: Do not re-throw — caller may not expect an exception.
      // Return false so the UI can gracefully show a "not available" state.
      console.warn("WebUSB connection failed (graceful degradation):", (e as Error).message ?? e);
      this.isActive = false;
      return false;
    }
  }

  async sendAudioBuffer(int16Buffer: ArrayBuffer) {
    if (!this.isActive || !this.device || this.endpointOut === 0) return;
    try {
      // Isochronous or Bulk transfer out
      await this.device.transferOut(this.endpointOut, int16Buffer);
    } catch (e) {
      console.warn("Buffer transfer error", e);
    }
  }

  async disconnect() {
    this.isActive = false;
    if (this.device) {
      try {
         await this.device.close();
      } catch (e) {}
    }
  }
}

export const webUSB = new WebUSBBridge();
