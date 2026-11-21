import { ReactNode, useEffect } from 'react';
import { configClass, varsClass } from 'folds';
import {
  DarkTheme,
  LightTheme,
  ThemeContextProvider,
  ThemeKind,
  useActiveTheme,
  useSystemThemeKind,
} from '../hooks/useTheme';
import { useSetting } from '../state/hooks/settings';
import { settingsAtom } from '../state/settings';
import { useDesign } from '../design/useDesign';
import { designClassNames } from '../design/scope';
import '../design/liquid';

export function UnAuthRouteThemeManager() {
  const systemThemeKind = useSystemThemeKind();
  const design = useDesign();

  useEffect(() => {
    document.body.className = '';
    document.body.classList.add(configClass, varsClass);
    if (systemThemeKind === ThemeKind.Dark) {
      document.body.classList.add(...DarkTheme.classNames);
    }
    if (systemThemeKind === ThemeKind.Light) {
      document.body.classList.add(...LightTheme.classNames);
    }
    document.body.classList.add(...designClassNames(design, systemThemeKind === ThemeKind.Dark));
  }, [systemThemeKind, design]);

  return null;
}

export function AuthRouteThemeManager({ children }: { children: ReactNode }) {
  const activeTheme = useActiveTheme();
  const [monochromeMode] = useSetting(settingsAtom, 'monochromeMode');
  const [lowAnimationMode] = useSetting(settingsAtom, 'lowAnimationMode');
  const [compactRoomList] = useSetting(settingsAtom, 'compactRoomList');
  const design = useDesign();

  useEffect(() => {
    document.body.className = '';
    document.body.classList.add(configClass, varsClass);

    document.body.classList.add(...activeTheme.classNames);
    document.body.classList.add(...designClassNames(design, activeTheme.kind === ThemeKind.Dark));

    // Class rather than a style, because the rules it enables are descendant
    // selectors over the whole tree (see index.css).
    if (lowAnimationMode) {
      document.body.classList.add('low-animation-mode');
    }

    if (compactRoomList) {
      document.body.classList.add('compact-room-list');
    }

    if (monochromeMode) {
      document.body.style.filter = 'grayscale(1)';
    } else {
      document.body.style.filter = '';
    }
  }, [activeTheme, design, monochromeMode, lowAnimationMode, compactRoomList]);

  return <ThemeContextProvider value={activeTheme}>{children}</ThemeContextProvider>;
}
