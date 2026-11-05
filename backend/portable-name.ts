/** Validate a single new Windows-compatible name, independent of feature visibility rules. */
export function isPortableName(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value !== '.' && value !== '..' &&
    !/[\x00-\x1f<>:"/\\|?*]/.test(value) && !/[. ]$/.test(value) &&
    !/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]) *(?:\.|$)/i.test(value) &&
    !/^con(?:in|out)\$$/i.test(value);
}
