import { ComponentProps, CSSProperties, MutableRefObject, ReactNode } from 'react';
import { Box, Header, Line, Scroll, Text, as } from 'folds';
import classNames from 'classnames';
import { ContainerColor } from '../../styles/ContainerColor.css';
import * as css from './style.css';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { ResizeHandle } from '../resize-handle';
import { useResizablePane } from '../../hooks/useResizablePane';
import { NavCollapsedProvider } from '../nav/NavCollapsed';

type PageRootProps = {
  nav: ReactNode;
  children: ReactNode;
  /**
   * Makes the divider between `nav` and `children` draggable.
   *
   * Opt-in rather than automatic because `PageRoot` also lays out the settings
   * dialogs, whose nav is a short fixed list inside a modal — there is nothing
   * there worth resizing, and a persisted width shared with the room list would
   * make dragging one silently move the other.
   */
  resizableNav?: boolean;
  /**
   * Let the nav be dragged down to its avatar rail. Opt-in per page — see
   * `effectiveSpec` in useResizablePane for why this is not a property of the
   * pane itself.
   */
  collapsibleNav?: boolean;
};

export function PageRoot({ nav, children, resizableNav, collapsibleNav }: PageRootProps) {
  const screenSize = useScreenSizeContext();

  // `position: relative` provides the containing block for the
  // `position: absolute` swipe layers (MobileSwipeBack, and the
  // mobile-only backdrop in MobileFriendlyPageNav). Without this, the
  // absolute layers escape to the viewport.
  return (
    <Box
      grow="Yes"
      className={ContainerColor({ variant: 'Background' })}
      style={{ position: 'relative' }}
    >
      {nav}
      {/* Mobile has no divider at all: the nav is the whole screen there, so
          there are never two columns to split. */}
      {screenSize !== ScreenSize.Mobile &&
        (resizableNav ? (
          <ResizeHandle
            paneId="navPane"
            side="Before"
            label="room list"
            allowCollapse={collapsibleNav}
          />
        ) : (
          <Line variant="Background" size="300" direction="Vertical" />
        ))}
      {children}
    </Box>
  );
}

type ClientDrawerLayoutProps = {
  children: ReactNode;
  /** Takes its width from the `navPane` handle instead of the size recipe. */
  resizable?: boolean;
  /** This page's list is worth reading as an avatar rail. See `PageRootProps`. */
  collapsible?: boolean;
};
export function PageNav({
  size,
  resizable,
  collapsible,
  children,
}: ClientDrawerLayoutProps & css.PageNavVariants) {
  const screenSize = useScreenSizeContext();
  const isMobile = screenSize === ScreenSize.Mobile;
  const pane = useResizablePane('navPane', collapsible);

  // Mobile wins over everything: the index route renders no right pane, so the
  // nav spans the whole viewport and a stored desktop width is irrelevant.
  let style: CSSProperties | undefined;
  if (isMobile) style = { width: '100%' };
  else if (resizable) style = pane.style;

  // Only a resizable desktop nav can be dragged shut, so a fixed-size or mobile
  // nav is never in the collapsed shape regardless of what the pane remembers.
  const collapsed = !isMobile && !!resizable && !!collapsible && pane.collapsed;

  return (
    <Box
      grow={isMobile ? 'Yes' : undefined}
      className={css.PageNav({ size })}
      shrink={isMobile ? 'Yes' : 'No'}
      // The recipe sets a fixed width (256/222rem) intended for desktop
      // sidebars. Both overrides here beat the recipe's specificity.
      style={style}
      // Read by the nav's own stylesheet to hide the labels the collapsed rail
      // has no room for — the parts that are pure markup rather than a
      // different component, i.e. category headers and the page title.
      data-nav-collapsed={collapsed || undefined}
    >
      <NavCollapsedProvider collapsed={collapsed}>
        <Box grow="Yes" direction="Column">
          {children}
        </Box>
      </NavCollapsedProvider>
    </Box>
  );
}

export const PageNavHeader = as<'header', css.PageNavHeaderVariants>(
  ({ className, outlined, ...props }, ref) => (
    <Header
      className={classNames(css.PageNavHeader({ outlined }), className)}
      variant="Background"
      size="600"
      {...props}
      ref={ref}
    />
  ),
);

export function PageNavContent({
  scrollRef,
  children,
}: {
  children: ReactNode;
  scrollRef?: MutableRefObject<HTMLDivElement | null>;
}) {
  return (
    <Box grow="Yes" direction="Column">
      <Scroll
        ref={scrollRef}
        variant="Background"
        direction="Vertical"
        size="300"
        hideTrack
        visibility="Hover"
      >
        <div className={css.PageNavContent}>{children}</div>
      </Scroll>
    </Box>
  );
}

export const Page = as<'div'>(({ className, ...props }, ref) => (
  <Box
    grow="Yes"
    direction="Column"
    className={classNames(ContainerColor({ variant: 'Surface' }), className)}
    {...props}
    ref={ref}
  />
));

export const PageHeader = as<'div', css.PageHeaderVariants>(
  ({ className, outlined, balance, ...props }, ref) => (
    <Header
      as="header"
      size="600"
      className={classNames(css.PageHeader({ balance, outlined }), className)}
      {...props}
      ref={ref}
    />
  ),
);

export const PageContent = as<'div'>(({ className, ...props }, ref) => (
  <div className={classNames(css.PageContent, className)} {...props} ref={ref} />
));

export function PageHeroEmpty({ children }: { children: ReactNode }) {
  return (
    <Box
      className={classNames(ContainerColor({ variant: 'SurfaceVariant' }), css.PageHeroEmpty)}
      direction="Column"
      alignItems="Center"
      justifyContent="Center"
      gap="200"
    >
      {children}
    </Box>
  );
}

export const PageHeroSection = as<'div', ComponentProps<typeof Box>>(
  ({ className, ...props }, ref) => (
    <Box
      direction="Column"
      className={classNames(css.PageHeroSection, className)}
      {...props}
      ref={ref}
    />
  ),
);

export function PageHero({
  icon,
  title,
  subTitle,
  children,
}: {
  icon: ReactNode;
  title: ReactNode;
  subTitle: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Box direction="Column" gap="400">
      <Box direction="Column" alignItems="Center" gap="200">
        {icon}
      </Box>
      <Box as="h2" direction="Column" gap="200" alignItems="Center">
        <Text align="Center" size="H2">
          {title}
        </Text>
        <Text align="Center" priority="400">
          {subTitle}
        </Text>
      </Box>
      {children}
    </Box>
  );
}

export const PageContentCenter = as<'div'>(({ className, ...props }, ref) => (
  <div className={classNames(css.PageContentCenter, className)} {...props} ref={ref} />
));
