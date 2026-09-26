/** Loads the meter AudioWorklet processor (meter-processor.js) as a same-origin module. */
export async function loadMeterWorklet(ctx: AudioContext): Promise<void> {
  await ctx.audioWorklet.addModule(new URL('./meter-processor.js', import.meta.url).href);
}
