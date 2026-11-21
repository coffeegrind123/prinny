import { useSetting } from '../state/hooks/settings';
import { settingsAtom } from '../state/settings';
import { Design, isDesign } from './scope';

/**
 * The active design. A stored value this build does not know (a setting
 * written by a newer build, or a hand-edited blob) reads as Prinny.
 */
export const useDesign = (): Design => {
  const [uiDesign] = useSetting(settingsAtom, 'uiDesign');
  return isDesign(uiDesign) ? uiDesign : Design.Prinny;
};
