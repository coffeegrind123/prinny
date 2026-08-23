import { ReactNode, createContext, useContext } from 'react';

const NavCollapsedContext = createContext(false);

/**
 * Whether the nav column is squeezed down to its avatar rail.
 *
 * A context rather than a prop, because the thing that knows the width is the
 * column (`PageNav`) and the things that have to change shape are the rows
 * inside it — with three unrelated pages (Home, Direct, Space) and a couple of
 * virtualised lists in between, threading a boolean through would mean touching
 * every list component to pass along something none of them care about.
 *
 * Defaults to false, so any nav rendered outside a `PageNav` (a test, a
 * storybook, the mobile full-width nav) behaves exactly as it did before.
 */
export const useNavCollapsed = (): boolean => useContext(NavCollapsedContext);

export function NavCollapsedProvider({
  collapsed,
  children,
}: {
  collapsed: boolean;
  children: ReactNode;
}) {
  return <NavCollapsedContext.Provider value={collapsed}>{children}</NavCollapsedContext.Provider>;
}
