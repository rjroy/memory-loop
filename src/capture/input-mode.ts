/** Device classification, not keyboard-source or viewport guessing. */
export interface CaptureDevice {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  userAgentData?: { mobile?: boolean; platform?: string };
}

export function isMobileCaptureDevice(device: CaptureDevice): boolean {
  if (device.userAgentData?.mobile === true) return true;
  const platform = device.userAgentData?.platform ?? device.platform;
  if (/Android|iPhone|iPad|iPod|Windows Phone|Mobile/i.test(device.userAgent) || /Android|iOS/i.test(platform)) return true;
  // iPadOS may advertise desktop Safari/MacIntel, including with a hardware keyboard.
  // Touch-enabled Windows/Linux laptops remain desktop; touch alone is not mobile.
  return device.maxTouchPoints > 1 && (/Mac/i.test(platform) || /Tablet|Silk|Kindle/i.test(device.userAgent));
}
