/**
 * The screens' code, fetched ahead of the first click on them.
 *
 * Every screen is its own chunk (app/routes.tsx), which keeps the sign-in
 * form light — but a first visit then showed the page skeleton while the code
 * arrived, and the screen transition photographed that skeleton instead of
 * the screen: the new screen popped in after the transition was over, and a
 * budget's name had no title to travel to. Once the shell is up and the
 * browser is idle, every screen's code is fetched, one after the other; a
 * navigation then renders the real screen at once.
 *
 * A preload that fails is not an error the reader has to see: the navigation
 * fetches the same chunk again, through `loadOrReload`, and THAT failure is
 * surfaced. Nothing is reloaded from here.
 */
const preloaders: Array<() => Promise<void>> = [];

export function registerScreenPreload(preload: () => Promise<void>): void {
  preloaders.push(preload);
}

export async function preloadScreens(): Promise<void> {
  for (const preload of preloaders) {
    await preload();
  }
}
