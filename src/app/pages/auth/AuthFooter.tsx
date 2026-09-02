import { Box, Text } from 'folds';
import * as css from './styles.css';
import { version } from '../../../../package.json';

export function AuthFooter() {
  return (
    <Box className={css.AuthFooter} justifyContent="Center" gap="400" wrap="Wrap">
      <Text as="a" size="T300" href="https://prinny.app" target="_blank" rel="noreferrer">
        About
      </Text>
      <Text
        as="a"
        size="T300"
        href="https://github.com/coffeegrind123/prinny-client/releases"
        target="_blank"
        rel="noreferrer"
      >
        v{version}
      </Text>
      <Text as="a" size="T300" href="https://matrix.org" target="_blank" rel="noreferrer">
        Powered by Matrix
      </Text>
    </Box>
  );
}
