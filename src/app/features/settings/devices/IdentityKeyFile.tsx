import { FormEventHandler, useCallback, useState } from 'react';
import { Box, Button, color, Icon, Icons, Spinner, Text, toRem } from 'folds';
import FileSaver from '../../../utils/save-file';
import { SettingTile } from '../../../components/setting-tile';
import { PasswordInput } from '../../../components/password-input';
import { ConfirmPasswordMatch } from '../../../components/ConfirmPasswordMatch';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { useFilePicker } from '../../../hooks/useFilePicker';
import { errorMessage } from '../../../utils/errorMessage';
import { identityKeysFilename } from '../../../utils/recoveryKeyFile';
import { exportIdentityKeyFile, importIdentityKeyFile } from '../../../utils/identityKeyFile';

function ExpandButton({ expand, onToggle }: { expand: boolean; onToggle: () => void }) {
  return (
    <Button
      type="button"
      onClick={onToggle}
      size="300"
      variant="Secondary"
      fill="Soft"
      outlined
      radii="300"
      before={<Icon size="100" src={expand ? Icons.ChevronTop : Icons.ChevronBottom} filled />}
    >
      <Text as="span" size="B300" truncate>
        {expand ? 'Collapse' : 'Expand'}
      </Text>
    </Button>
  );
}

function ExportIdentityKeys() {
  const mx = useMatrixClient();
  const [state, exportKeys] = useAsyncCallback<void, Error, [string]>(
    useCallback(
      async (password) => {
        const crypto = mx.getCrypto();
        if (!crypto) throw new Error('Encryption is not available on this device.');
        const file = await exportIdentityKeyFile(mx, crypto, password);
        const blob = new Blob([file], { type: 'text/plain;charset=us-ascii' });
        FileSaver.saveAs(blob, identityKeysFilename(mx.getSafeUserId()));
      },
      [mx],
    ),
  );
  const busy = state.status === AsyncStatus.Loading;

  const handleSubmit: FormEventHandler<HTMLFormElement> = (evt) => {
    evt.preventDefault();
    if (busy) return;
    const form = evt.target as HTMLFormElement & {
      passwordInput: HTMLInputElement;
      confirmPasswordInput: HTMLInputElement;
    };
    if (form.passwordInput.value !== form.confirmPasswordInput.value) return;
    exportKeys(form.passwordInput.value)
      .then(() => {
        form.passwordInput.value = '';
        form.confirmPasswordInput.value = '';
      })
      // The failure is shown below.
      .catch(() => undefined);
  };

  return (
    <SettingTile>
      <Box as="form" onSubmit={handleSubmit} direction="Column" gap="200">
        <Text size="T200" style={{ color: color.Warning.Main }}>
          Anyone with this file and its password can sign in devices as you and read every message
          you can. Use a long password and keep the file somewhere only you can reach.
        </Text>
        <Box gap="200" alignItems="End">
          <ConfirmPasswordMatch initialValue>
            {(match, doMatch, passRef, confPassRef) => (
              <>
                <Box grow="Yes" direction="Column" gap="100">
                  <Text size="L400">New Password</Text>
                  <PasswordInput
                    ref={passRef}
                    name="passwordInput"
                    size="400"
                    variant="Secondary"
                    radii="300"
                    required
                    onChange={doMatch}
                    readOnly={busy}
                    autoFocus
                  />
                </Box>
                <Box grow="Yes" direction="Column" gap="100">
                  <Text size="L400">Confirm Password</Text>
                  <PasswordInput
                    ref={confPassRef}
                    style={{ color: match ? undefined : color.Critical.Main }}
                    name="confirmPasswordInput"
                    size="400"
                    variant="Secondary"
                    radii="300"
                    required
                    onChange={doMatch}
                    readOnly={busy}
                  />
                </Box>
              </>
            )}
          </ConfirmPasswordMatch>
          <Button
            type="submit"
            size="400"
            variant="Secondary"
            fill="Soft"
            outlined
            radii="300"
            disabled={busy}
            before={busy ? <Spinner size="200" variant="Secondary" fill="Soft" /> : undefined}
          >
            <Text as="span" size="B400">
              Export
            </Text>
          </Button>
        </Box>
        {state.status === AsyncStatus.Error && (
          <Text size="T200" style={{ color: color.Critical.Main }}>
            <b>{errorMessage(state.error)}</b>
          </Text>
        )}
      </Box>
    </SettingTile>
  );
}

/**
 * Export a self-held copy of the identity (cross-signing) keys. With recovery turned off this is
 * the only way back to the identity if every signed-in device is lost.
 */
export function ExportIdentityKeysTile() {
  const [expand, setExpand] = useState(false);
  return (
    <>
      <SettingTile
        title="Export Identity Keys"
        description="Save a password protected copy of your cross-signing keys, to verify a new device after losing every other one, even with recovery turned off."
        after={<ExpandButton expand={expand} onToggle={() => setExpand(!expand)} />}
      />
      {expand && <ExportIdentityKeys />}
    </>
  );
}

function ImportIdentityKeys({ file, onDone }: { file: File; onDone: () => void }) {
  const mx = useMatrixClient();
  const [state, importKeys] = useAsyncCallback<void, Error, [string]>(
    useCallback(
      async (password) => {
        const crypto = mx.getCrypto();
        if (!crypto) throw new Error('Encryption is not available on this device.');
        await importIdentityKeyFile(mx, crypto, await file.arrayBuffer(), password);
      },
      [mx, file],
    ),
  );
  const busy = state.status === AsyncStatus.Loading;

  const handleSubmit: FormEventHandler<HTMLFormElement> = (evt) => {
    evt.preventDefault();
    if (busy) return;
    const { passwordInput } = evt.target as HTMLFormElement & { passwordInput: HTMLInputElement };
    if (!passwordInput.value) return;
    importKeys(passwordInput.value)
      .then(onDone)
      // The failure is shown below.
      .catch(() => undefined);
  };

  return (
    <SettingTile>
      <Box as="form" onSubmit={handleSubmit} direction="Column" gap="100">
        <Box gap="200" alignItems="End">
          <Box grow="Yes" direction="Column" gap="100">
            <Text size="L400">Password</Text>
            <PasswordInput
              name="passwordInput"
              size="400"
              variant="Secondary"
              radii="300"
              required
              autoFocus
              readOnly={busy}
            />
          </Box>
          <Button
            type="submit"
            size="400"
            variant="Secondary"
            fill="Soft"
            outlined
            radii="300"
            disabled={busy}
            before={busy ? <Spinner size="200" variant="Secondary" fill="Soft" /> : undefined}
          >
            <Text as="span" size="B400">
              Import
            </Text>
          </Button>
        </Box>
        {state.status === AsyncStatus.Error && (
          <Text size="T200" style={{ color: color.Critical.Main }}>
            <b>{errorMessage(state.error)}</b>
          </Text>
        )}
      </Box>
    </SettingTile>
  );
}

/** Import an identity key file; this device is then signed and verified with it. */
export function ImportIdentityKeysTile() {
  const [file, setFile] = useState<File>();
  const [imported, setImported] = useState(false);
  const pickFile = useFilePicker(
    useCallback((picked: File) => {
      setImported(false);
      setFile(picked);
    }, []),
  );
  const handleDone = useCallback(() => {
    setFile(undefined);
    setImported(true);
  }, []);

  return (
    <>
      <SettingTile
        title="Import Identity Keys"
        description={
          imported
            ? 'Identity keys imported. This device is now verified.'
            : 'Load an identity key file to verify this device. Only keys that match your account’s current identity are accepted.'
        }
        after={
          <Box>
            {file ? (
              <Button
                style={{ maxWidth: toRem(200) }}
                type="button"
                onClick={() => setFile(undefined)}
                size="300"
                variant="Warning"
                fill="Solid"
                radii="300"
                before={<Icon size="100" src={Icons.File} filled />}
                after={<Icon size="100" src={Icons.Cross} />}
              >
                <Text as="span" size="B300" truncate>
                  {file.name}
                </Text>
              </Button>
            ) : (
              <Button
                type="button"
                onClick={() => pickFile('text/plain')}
                size="300"
                variant="Secondary"
                fill="Soft"
                outlined
                radii="300"
                before={<Icon size="100" src={Icons.ArrowRight} />}
              >
                <Text as="span" size="B300">
                  Import
                </Text>
              </Button>
            )}
          </Box>
        }
      />
      {file && <ImportIdentityKeys file={file} onDone={handleDone} />}
    </>
  );
}
