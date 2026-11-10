import { useEffect } from 'react';
import { useSetAtom } from 'jotai';
import { useLocation } from 'react-router-dom';
import { useNavToActivePathAtom } from '../state/hooks/navToActivePath';
import { getNavPathname } from '../utils/navPathname';

export const useNavToActivePathMapper = (navId: string) => {
  const location = useLocation();
  const setNavToActivePath = useSetAtom(useNavToActivePathAtom());

  useEffect(() => {
    const { pathname, search, hash } = location;
    setNavToActivePath({
      type: 'PUT',
      navId,
      path: { pathname: getNavPathname(pathname), search, hash },
    });
  }, [location, setNavToActivePath, navId]);
};
