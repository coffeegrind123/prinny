import { ReactNode } from 'react';
import { Box } from 'folds';
import { UpdateBanner } from '../../features/update-check/UpdateBanner';
import { UnverifiedBanner } from '../../features/device-verification-gate/UnverifiedBanner';
import { TopBar } from './TopBar';
import { useShellLayout } from '../../hooks/useShellLayout';

type ClientLayoutProps = {
  nav: ReactNode;
  children: ReactNode;
};
export function ClientLayout({ nav, children }: ClientLayoutProps) {
  const layout = useShellLayout();

  return (
    <Box grow="Yes" direction="Column">
      <UpdateBanner />
      <UnverifiedBanner />
      {layout.topBar && <TopBar profile={layout.topBarProfile} />}
      <Box grow="Yes" direction="Row">
        <Box shrink="No">{nav}</Box>
        <Box grow="Yes">{children}</Box>
      </Box>
    </Box>
  );
}
