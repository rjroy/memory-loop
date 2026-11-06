/** Decide whether the launcher forwards a signal or waits for the console child. */
export function webSignalAction(platform: NodeJS.Platform, signal: 'SIGINT' | 'SIGTERM'): 'forward' | 'wait' {
  return platform === 'win32' && signal === 'SIGINT' ? 'wait' : 'forward';
}
