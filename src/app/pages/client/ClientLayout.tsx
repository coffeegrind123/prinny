import { ReactNode } from 'react';
import { Box } from 'folds';
import { useAtomValue } from 'jotai';
import { UpdateBanner } from '../../features/update-check/UpdateBanner';
import { UnverifiedBanner } from '../../features/device-verification-gate/UnverifiedBanner';
import { TopBar } from './TopBar';
import { useShellLayout } from '../../hooks/useShellLayout';
import { callFullscreenAtom } from '../../state/callEmbed';

type ClientLayoutProps = {
  nav: ReactNode;
  children: ReactNode;
};
export function ClientLayout({ nav, children }: ClientLayoutProps) {
  const layout = useShellLayout();
  // A fullscreened call leaves only the call: hidden, not unmounted, so the
  // sidebar and its state survive leaving fullscreen.
  const callFullscreen = useAtomValue(callFullscreenAtom);

  return (
    <Box grow="Yes" direction="Column">
      <div style={{ display: callFullscreen ? 'none' : 'contents' }}>
        <UpdateBanner />
        <UnverifiedBanner />
        {layout.topBar && <TopBar profile={layout.topBarProfile} />}
      </div>
      <Box grow="Yes" direction="Row">
        <Box shrink="No" style={{ display: callFullscreen ? 'none' : undefined }}>
          {nav}
        </Box>
        <Box grow="Yes">{children}</Box>
      </Box>
    </Box>
  );
}
