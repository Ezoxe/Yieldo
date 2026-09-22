/**
 * Loading a screen on demand, and surviving a deploy while a tab is open.
 *
 * Every screen is a separate hashed chunk. When the operator runs
 * `install.sh update`, the chunks on the server are replaced; a tab that
 * kept the old `index.html` then asks for a file that no longer exists on
 * its next navigation, and the router shows « Unexpected Application Error ».
 * The right answer is the one the reader would give: reload, once. The flag
 * in `sessionStorage` makes sure a chunk that is genuinely broken surfaces as
 * an error rather than as a reload loop.
 */

export const RELOADED_FLAG = "yieldo.screen-reloaded";

export async function loadOrReload<M>(
  load: () => Promise<M>,
  reload: () => void = () => window.location.reload(),
): Promise<M> {
  try {
    const module = await load();
    sessionStorage.removeItem(RELOADED_FLAG);
    return module;
  } catch (error) {
    if (sessionStorage.getItem(RELOADED_FLAG) === null) {
      sessionStorage.setItem(RELOADED_FLAG, "1");
      reload();
    }
    throw error;
  }
}
