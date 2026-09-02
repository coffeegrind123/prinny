import {
  ChangeEventHandler,
  FormEventHandler,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  Box,
  Text,
  IconButton,
  Icon,
  Icons,
  Input,
  Avatar,
  Button,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Modal,
  Dialog,
  Header,
  config,
  Spinner,
  TextArea,
  color,
} from 'folds';
import { FocusTrap } from 'focus-trap-react';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../styles.css';
import { SettingTile } from '../../../components/setting-tile';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { UserProfile, useUserProfile } from '../../../hooks/useUserProfile';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../../utils/matrix';
import { UserAvatar } from '../../../components/user-avatar';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { nameInitials } from '../../../utils/common';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { useFilePicker } from '../../../hooks/useFilePicker';
import { useObjectURL } from '../../../hooks/useObjectURL';
import { stopPropagation } from '../../../utils/keyboard';
import { ImageEditor } from '../../../components/image-editor';
import { ModalWide } from '../../../styles/Modal.css';
import { createUploadAtom, UploadSuccess } from '../../../state/upload';
import { CompactUploadCardRenderer } from '../../../components/upload-card';
import { useCapabilities } from '../../../hooks/useCapabilities';
import {
  getProfilePronouns,
  getProfileBanner,
  getProfileBiography,
  getProfileTimezone,
  isValidTimezone,
  formatTimeInTimezone,
  M_TIMEZONE,
  MSC4247_PRONOUNS,
  MSC4427_BANNER,
  MSC4440_BIOGRAPHY,
  ProfilePronoun,
} from '../../../../types/matrix/profile';
import { ProfilePreview } from './ProfilePreview';
import * as previewCss from './ProfilePreview.css';
import { useUserPresence } from '../../../hooks/useUserPresence';

type ProfileProps = {
  profile: UserProfile;
  userId: string;
};
function ProfileAvatar({ profile, userId }: ProfileProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const capabilities = useCapabilities();
  const [alertRemove, setAlertRemove] = useState(false);
  const disableSetAvatar = capabilities['m.set_avatar_url']?.enabled === false;

  const defaultDisplayName = profile.displayName ?? getMxIdLocalPart(userId) ?? userId;
  const avatarUrl = profile.avatarUrl
    ? (mxcUrlToHttp(mx, profile.avatarUrl, useAuthentication, 96, 96, 'crop') ?? undefined)
    : undefined;

  const [imageFile, setImageFile] = useState<File>();
  const imageFileURL = useObjectURL(imageFile);
  const uploadAtom = useMemo(() => {
    if (imageFile) return createUploadAtom(imageFile);
    return undefined;
  }, [imageFile]);

  const pickFile = useFilePicker(setImageFile, false);

  const handleRemoveUpload = useCallback(() => {
    setImageFile(undefined);
  }, []);

  const handleUploaded = useCallback(
    (upload: UploadSuccess) => {
      const { mxc } = upload;
      mx.setAvatarUrl(mxc);
      handleRemoveUpload();
    },
    [mx, handleRemoveUpload],
  );

  const handleRemoveAvatar = () => {
    mx.setAvatarUrl('');
    setAlertRemove(false);
  };

  return (
    <SettingTile
      title={
        <Text as="span" size="L400">
          Avatar
        </Text>
      }
      after={
        <Avatar size="500" radii="300">
          <UserAvatar
            userId={userId}
            src={avatarUrl}
            renderFallback={() => <Text size="H4">{nameInitials(defaultDisplayName)}</Text>}
          />
        </Avatar>
      }
    >
      {uploadAtom ? (
        <Box gap="200" direction="Column">
          <CompactUploadCardRenderer
            uploadAtom={uploadAtom}
            onRemove={handleRemoveUpload}
            onComplete={handleUploaded}
          />
        </Box>
      ) : (
        <Box gap="200">
          <Button
            onClick={() => pickFile('image/*')}
            size="300"
            variant="Secondary"
            fill="Soft"
            outlined
            radii="300"
            disabled={disableSetAvatar}
          >
            <Text size="B300">Upload</Text>
          </Button>
          {avatarUrl && (
            <Button
              size="300"
              variant="Critical"
              fill="None"
              radii="300"
              disabled={disableSetAvatar}
              onClick={() => setAlertRemove(true)}
            >
              <Text size="B300">Remove</Text>
            </Button>
          )}
        </Box>
      )}

      {imageFileURL && (
        <Overlay open={false} backdrop={<OverlayBackdrop />}>
          <OverlayCenter>
            <FocusTrap
              focusTrapOptions={{
                initialFocus: false,
                onDeactivate: handleRemoveUpload,
                clickOutsideDeactivates: true,
                escapeDeactivates: stopPropagation,
              }}
            >
              <Modal className={ModalWide} variant="Surface" size="500">
                <ImageEditor
                  name={imageFile?.name ?? 'Unnamed'}
                  url={imageFileURL}
                  requestClose={handleRemoveUpload}
                />
              </Modal>
            </FocusTrap>
          </OverlayCenter>
        </Overlay>
      )}

      <Overlay open={alertRemove} backdrop={<OverlayBackdrop />}>
        <OverlayCenter>
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              onDeactivate: () => setAlertRemove(false),
              clickOutsideDeactivates: true,
              escapeDeactivates: stopPropagation,
            }}
          >
            <Dialog variant="Surface">
              <Header
                style={{
                  padding: `0 ${config.space.S200} 0 ${config.space.S400}`,
                  borderBottomWidth: config.borderWidth.B300,
                }}
                variant="Surface"
                size="500"
              >
                <Box grow="Yes">
                  <Text size="H4">Remove Avatar</Text>
                </Box>
                <IconButton size="300" onClick={() => setAlertRemove(false)} radii="300">
                  <Icon src={Icons.Cross} />
                </IconButton>
              </Header>
              <Box style={{ padding: config.space.S400 }} direction="Column" gap="400">
                <Box direction="Column" gap="200">
                  <Text priority="400">Are you sure you want to remove profile avatar?</Text>
                </Box>
                <Button variant="Critical" onClick={handleRemoveAvatar}>
                  <Text size="B400">Remove</Text>
                </Button>
              </Box>
            </Dialog>
          </FocusTrap>
        </OverlayCenter>
      </Overlay>
    </SettingTile>
  );
}

type ProfileBannerProps = {
  bannerMxc?: string;
  onBannerChange: (bannerMxc: string | undefined) => void;
};

function ProfileBanner({ bannerMxc, onBannerChange }: ProfileBannerProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const bannerUrl = bannerMxc
    ? (mxcUrlToHttp(mx, bannerMxc, useAuthentication) ?? undefined)
    : undefined;
  const [imageFile, setImageFile] = useState<File>();
  const imageFileUrl = useObjectURL(imageFile);
  const [croppedFile, setCroppedFile] = useState<File>();
  const croppedFileUrl = useObjectURL(croppedFile);
  const uploadAtom = useMemo(
    () => (croppedFile ? createUploadAtom(croppedFile) : undefined),
    [croppedFile],
  );
  const pickFile = useFilePicker(setImageFile, false);

  const handleUploaded = useCallback(
    async (upload: UploadSuccess) => {
      await mx.setExtendedProfileProperty(MSC4427_BANNER, upload.mxc);
      onBannerChange(upload.mxc);
      setImageFile(undefined);
      setCroppedFile(undefined);
    },
    [mx, onBannerChange],
  );

  const handleRemove = async () => {
    await mx.deleteExtendedProfileProperty(MSC4427_BANNER);
    onBannerChange(undefined);
  };

  return (
    <SettingTile
      title={
        <Text as="span" size="L400">
          Banner
        </Text>
      }
    >
      <Box direction="Column" gap="200" grow="Yes">
        <Box
          style={{
            aspectRatio: '3 / 1',
            overflow: 'hidden',
            borderRadius: config.radii.R300,
          }}
        >
          {croppedFileUrl || imageFileUrl || bannerUrl ? (
            <img
              src={croppedFileUrl ?? imageFileUrl ?? bannerUrl}
              alt="Banner preview"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <Box justifyContent="Center" alignItems="Center" style={{ height: '100%' }}>
              <Text size="T200" priority="300">
                No banner set
              </Text>
            </Box>
          )}
        </Box>
        {uploadAtom ? (
          <CompactUploadCardRenderer
            uploadAtom={uploadAtom}
            onRemove={() => {
              setImageFile(undefined);
              setCroppedFile(undefined);
            }}
            onComplete={handleUploaded}
          />
        ) : (
          <Box gap="200">
            <Button
              size="300"
              variant="Secondary"
              fill="Soft"
              radii="300"
              onClick={() => pickFile('image/*')}
            >
              <Text size="B300">{bannerUrl ? 'Change' : 'Upload'}</Text>
            </Button>
            {bannerUrl && (
              <Button size="300" variant="Critical" fill="None" radii="300" onClick={handleRemove}>
                <Text size="B300">Remove</Text>
              </Button>
            )}
          </Box>
        )}
      </Box>
      {imageFileUrl && (
        <Overlay open backdrop={<OverlayBackdrop />}>
          <OverlayCenter>
            <FocusTrap
              focusTrapOptions={{
                initialFocus: false,
                onDeactivate: () => setImageFile(undefined),
                clickOutsideDeactivates: true,
                escapeDeactivates: stopPropagation,
              }}
            >
              <Modal className={ModalWide} variant="Surface" size="500">
                <ImageEditor
                  name={imageFile?.name ?? 'banner'}
                  url={imageFileUrl}
                  aspectRatio={3}
                  outputWidth={1200}
                  requestClose={() => setImageFile(undefined)}
                  onApply={(file) => {
                    setCroppedFile(file);
                    setImageFile(undefined);
                  }}
                />
              </Modal>
            </FocusTrap>
          </OverlayCenter>
        </Overlay>
      )}
    </SettingTile>
  );
}

function ProfileDisplayName({ profile, userId }: ProfileProps) {
  const mx = useMatrixClient();
  const capabilities = useCapabilities();
  const disableSetDisplayname = capabilities['m.set_displayname']?.enabled === false;

  const defaultDisplayName = profile.displayName ?? getMxIdLocalPart(userId) ?? userId;
  const [displayName, setDisplayName] = useState<string>(defaultDisplayName);

  const [changeState, changeDisplayName] = useAsyncCallback(
    useCallback((name: string) => mx.setDisplayName(name), [mx]),
  );
  const changingDisplayName = changeState.status === AsyncStatus.Loading;

  useEffect(() => {
    setDisplayName(defaultDisplayName);
  }, [defaultDisplayName]);

  const handleChange: ChangeEventHandler<HTMLInputElement> = (evt) => {
    const name = evt.currentTarget.value;
    setDisplayName(name);
  };

  const handleReset = () => {
    setDisplayName(defaultDisplayName);
  };

  const handleSubmit: FormEventHandler<HTMLFormElement> = (evt) => {
    evt.preventDefault();
    if (changingDisplayName) return;

    const target = evt.target as HTMLFormElement | undefined;
    const displayNameInput = target?.displayNameInput as HTMLInputElement | undefined;
    const name = displayNameInput?.value;
    if (!name) return;

    changeDisplayName(name);
  };

  const hasChanges = displayName !== defaultDisplayName;
  return (
    <SettingTile
      title={
        <Text as="span" size="L400">
          Display Name
        </Text>
      }
    >
      <Box direction="Column" grow="Yes" gap="100">
        <Box
          as="form"
          onSubmit={handleSubmit}
          gap="200"
          aria-disabled={changingDisplayName || disableSetDisplayname}
        >
          <Box grow="Yes" direction="Column">
            <Input
              required
              name="displayNameInput"
              value={displayName}
              onChange={handleChange}
              variant="Secondary"
              radii="300"
              style={{ paddingRight: config.space.S200 }}
              readOnly={changingDisplayName || disableSetDisplayname}
              after={
                hasChanges &&
                !changingDisplayName && (
                  <IconButton
                    type="reset"
                    onClick={handleReset}
                    size="300"
                    radii="300"
                    variant="Secondary"
                  >
                    <Icon src={Icons.Cross} size="100" />
                  </IconButton>
                )
              }
            />
          </Box>
          <Button
            size="400"
            variant={hasChanges ? 'Success' : 'Secondary'}
            fill={hasChanges ? 'Solid' : 'Soft'}
            outlined
            radii="300"
            disabled={!hasChanges || changingDisplayName}
            type="submit"
          >
            {changingDisplayName && <Spinner variant="Success" fill="Solid" size="300" />}
            <Text size="B400">Save</Text>
          </Button>
        </Box>
      </Box>
    </SettingTile>
  );
}

function ProfilePronouns({ profile }: { profile: UserProfile }) {
  const mx = useMatrixClient();
  const current = getProfilePronouns(profile.extended);
  const currentValue = current.map((pronoun) => pronoun.summary).join(', ');
  const [value, setValue] = useState(currentValue);
  const [saving, setSaving] = useState(false);

  useEffect(() => setValue(currentValue), [currentValue]);

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    const pronouns: ProfilePronoun[] = value
      .split(',')
      .map((summary) => summary.trim())
      .filter(Boolean)
      .map((summary) => ({ summary, language: 'en' }));
    setSaving(true);
    try {
      await mx.setExtendedProfileProperty(
        MSC4247_PRONOUNS,
        pronouns.map(({ summary, language, grammaticalGender }) => ({
          summary,
          language,
          ...(grammaticalGender ? { grammatical_gender: grammaticalGender } : {}),
        })),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingTile
      title={
        <Text as="span" size="L400">
          Pronouns
        </Text>
      }
      description="Separate multiple pronoun sets with commas."
    >
      <Box as="form" onSubmit={handleSubmit} gap="200" grow="Yes">
        <Box grow="Yes" direction="Column">
          <Input
            aria-label="Pronouns"
            value={value}
            onChange={(event) => setValue(event.currentTarget.value)}
            placeholder="they/them, she/her"
            maxLength={128}
            size="400"
            variant="Secondary"
            radii="300"
          />
        </Box>
        <Button
          type="submit"
          size="400"
          variant="Success"
          fill="Solid"
          radii="300"
          disabled={saving || value === currentValue}
        >
          {saving && <Spinner variant="Success" fill="Solid" size="300" />}
          <Text size="B400">Save</Text>
        </Button>
      </Box>
    </SettingTile>
  );
}

/**
 * MSC4175 — `m.tz`, a defined profile key since Matrix 1.16.
 *
 * Writes the STABLE key only. The three fields either side of this one write
 * their unstable identifiers because they are still open proposals; this one is
 * spec, and the server validates `m.tz` against a documented key pattern.
 */
function ProfileTimezone({ profile }: { profile: UserProfile }) {
  const mx = useMatrixClient();
  const currentValue = getProfileTimezone(profile.extended) ?? '';
  const [value, setValue] = useState(currentValue);
  const [saving, setSaving] = useState(false);

  useEffect(() => setValue(currentValue), [currentValue]);

  // `Intl.supportedValuesOf` gives the runtime's own zone list, so the datalist
  // can never offer a zone the runtime would then reject. Guarded because it is
  // newer than the rest of Intl — without the list the input still works, it
  // just loses type-ahead.
  const zones = useMemo<string[]>(() => {
    const intl = Intl as typeof Intl & {
      supportedValuesOf?: (key: 'timeZone') => string[];
    };
    try {
      return intl.supportedValuesOf?.('timeZone') ?? [];
    } catch {
      return [];
    }
  }, []);

  const trimmed = value.trim();
  const valid = trimmed === '' || isValidTimezone(trimmed);
  const preview = valid && trimmed ? formatTimeInTimezone(trimmed) : undefined;

  const handleDetect = () => {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detected) setValue(detected);
  };

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    if (!valid) return;
    setSaving(true);
    try {
      // DELETE rather than a null write, matching the banner and biography
      // tiles. Setting null leaves the key present with a null value, which
      // every reader then has to special-case.
      if (trimmed === '') {
        await mx.deleteExtendedProfileProperty(M_TIMEZONE);
      } else {
        await mx.setExtendedProfileProperty(M_TIMEZONE, trimmed);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingTile
      title={
        <Text as="span" size="L400">
          Time Zone
        </Text>
      }
      description={
        preview
          ? `Others see your local time. It is ${preview} for you now.`
          : 'Lets people see what time it is where you are. Leave empty to hide it.'
      }
    >
      <Box as="form" onSubmit={handleSubmit} gap="200" grow="Yes">
        <Box grow="Yes" direction="Column">
          <Input
            aria-label="Time zone"
            list="prinny-timezone-list"
            value={value}
            onChange={(event) => setValue(event.currentTarget.value)}
            placeholder="Europe/Helsinki"
            maxLength={64}
            size="400"
            variant={valid ? 'Secondary' : 'Critical'}
            radii="300"
          />
          {zones.length > 0 && (
            <datalist id="prinny-timezone-list">
              {zones.map((zone) => (
                <option key={zone} value={zone} />
              ))}
            </datalist>
          )}
          {!valid && (
            <Text size="T200" style={{ color: color.Critical.Main }}>
              Not a time zone this device knows. Pick one from the list.
            </Text>
          )}
        </Box>
        <Button
          type="button"
          onClick={handleDetect}
          size="400"
          variant="Secondary"
          fill="Soft"
          radii="300"
        >
          <Text size="B400">Detect</Text>
        </Button>
        <Button
          type="submit"
          size="400"
          variant="Success"
          fill="Solid"
          radii="300"
          disabled={saving || !valid || trimmed === currentValue}
        >
          {saving && <Spinner variant="Success" fill="Solid" size="300" />}
          <Text size="B400">Save</Text>
        </Button>
      </Box>
    </SettingTile>
  );
}

function ProfileStatus({ userId }: { userId: string }) {
  const mx = useMatrixClient();
  const presence = useUserPresence(userId);
  const currentValue = presence?.status ?? '';
  const [value, setValue] = useState(currentValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => setValue(currentValue), [currentValue]);

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      await mx.setPresence({
        presence: presence?.presence ?? 'online',
        status_msg: value.trim(),
      });
    } catch {
      setError('Could not save your status. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingTile
      title={
        <Text as="span" size="L400">
          Status
        </Text>
      }
      description="A short message shown with your presence."
    >
      <Box as="form" onSubmit={handleSubmit} direction="Column" gap="100" grow="Yes">
        <Box gap="200" grow="Yes">
          <Box grow="Yes" direction="Column">
            <Input
              aria-label="Status message"
              value={value}
              onChange={(event) => setValue(event.currentTarget.value)}
              placeholder="What are you up to?"
              maxLength={256}
              size="400"
              variant="Secondary"
              radii="300"
            />
          </Box>
          <Button
            type="submit"
            size="400"
            variant="Success"
            fill="Solid"
            radii="300"
            disabled={saving || value === currentValue}
          >
            {saving && <Spinner variant="Success" fill="Solid" size="300" />}
            <Text size="B400">Save</Text>
          </Button>
        </Box>
        {error && (
          <Text role="alert" size="T200">
            {error}
          </Text>
        )}
      </Box>
    </SettingTile>
  );
}

function ProfileBiography({ profile }: { profile: UserProfile }) {
  const mx = useMatrixClient();
  const currentValue = getProfileBiography(profile.extended) ?? '';
  const [value, setValue] = useState(currentValue);
  const [saving, setSaving] = useState(false);

  useEffect(() => setValue(currentValue), [currentValue]);

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      if (value.trim()) {
        await mx.setExtendedProfileProperty(MSC4440_BIOGRAPHY, {
          'm.text': [{ body: value.trim() }],
        });
      } else {
        await mx.deleteExtendedProfileProperty(MSC4440_BIOGRAPHY);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingTile
      title={
        <Text as="span" size="L400">
          Biography
        </Text>
      }
      description="Public information shown on your profile."
    >
      <Box as="form" onSubmit={handleSubmit} direction="Column" gap="200" grow="Yes">
        <TextArea
          aria-label="Biography"
          value={value}
          onChange={(event) => setValue(event.currentTarget.value)}
          placeholder="Tell people about yourself"
          maxLength={1024}
          rows={4}
          resize="Vertical"
          variant="Secondary"
          radii="300"
        />
        <Box justifyContent="End" alignItems="Center" gap="200">
          <Text size="T200" priority="300">
            {value.length} / 1024
          </Text>
          <Button
            type="submit"
            size="300"
            variant="Success"
            fill="Solid"
            radii="300"
            disabled={saving || value === currentValue}
          >
            {saving && <Spinner variant="Success" fill="Solid" size="300" />}
            <Text size="B300">Save</Text>
          </Button>
        </Box>
      </Box>
    </SettingTile>
  );
}

export function Profile() {
  const mx = useMatrixClient();
  const userId = mx.getSafeUserId();
  const profile = useUserProfile(userId);
  const serverBannerMxc = getProfileBanner(profile.extended);
  const [bannerOverride, setBannerOverride] = useState<{ value?: string }>();
  const bannerMxc = bannerOverride ? bannerOverride.value : serverBannerMxc;

  useEffect(() => {
    if (bannerOverride && serverBannerMxc === bannerOverride.value) {
      setBannerOverride(undefined);
    }
  }, [bannerOverride, serverBannerMxc]);

  const handleBannerChange = useCallback((value: string | undefined) => {
    setBannerOverride({ value });
  }, []);
  const requestEdit = () => {
    document
      .getElementById('profile-editor')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <Box className={previewCss.ProfilePage} direction="Column" gap="300">
      <Text size="H3">Profile</Text>
      <div className={previewCss.ProfileLayout}>
        <ProfilePreview
          profile={profile}
          bannerMxc={bannerMxc}
          userId={userId}
          requestEdit={requestEdit}
        />
        <Box id="profile-editor" className={previewCss.EditorColumn} direction="Column" gap="200">
          <Text size="L400">Edit Profile</Text>
          <SequenceCard
            className={SequenceCardStyle}
            variant="SurfaceVariant"
            direction="Column"
            gap="400"
          >
            <ProfileAvatar userId={userId} profile={profile} />
            <ProfileBanner bannerMxc={bannerMxc} onBannerChange={handleBannerChange} />
            <ProfileDisplayName userId={userId} profile={profile} />
            <ProfileStatus userId={userId} />
            <ProfilePronouns profile={profile} />
            <ProfileTimezone profile={profile} />
            <ProfileBiography profile={profile} />
          </SequenceCard>
        </Box>
      </div>
    </Box>
  );
}
