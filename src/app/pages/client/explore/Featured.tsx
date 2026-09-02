import { useState } from 'react';
import { Box, Button, Icon, IconButton, Icons, Scroll, Text } from 'folds';
import { useAtomValue } from 'jotai';
import { useClientConfig } from '../../../hooks/useClientConfig';
import { RoomCard, RoomCardGrid } from '../../../components/room-card';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { RoomSummaryLoader } from '../../../components/RoomSummaryLoader';
import {
  Page,
  PageContent,
  PageContentCenter,
  PageHeader,
  PageHero,
  PageHeroSection,
} from '../../../components/page';
import { RoomTopicViewer } from '../../../components/room-topic-viewer';
import * as css from './style.css';
import { useRoomNavigate } from '../../../hooks/useRoomNavigate';
import { ScreenSize, useScreenSizeContext } from '../../../hooks/useScreenSize';
import { BackRouteHandler } from '../../../components/BackRouteHandler';
import { useNavigate } from 'react-router-dom';
import { ServerBrowser } from '../../../components/ServerBrowser';
import { getExploreServerPath } from '../../pathUtils';

function ConfigRoomCardRow({ ids, onView }: { ids: string[]; onView: (roomId: string) => void }) {
  const allRooms = useAtomValue(allRoomsAtom);
  return (
    <RoomCardGrid>
      {ids.map((roomIdOrAlias) => (
        <RoomSummaryLoader key={roomIdOrAlias} roomIdOrAlias={roomIdOrAlias}>
          {(roomSummary) => (
            <RoomCard
              roomIdOrAlias={roomIdOrAlias}
              allRooms={allRooms}
              avatarUrl={roomSummary?.avatar_url}
              name={roomSummary?.name}
              topic={roomSummary?.topic}
              memberCount={roomSummary?.num_joined_members}
              onView={onView}
              renderTopicViewer={(name, topic, requestClose) => (
                <RoomTopicViewer name={name} topic={topic} requestClose={requestClose} />
              )}
            />
          )}
        </RoomSummaryLoader>
      ))}
    </RoomCardGrid>
  );
}

export function FeaturedRooms() {
  const { featuredCommunities } = useClientConfig();
  const { rooms: configRooms, spaces: configSpaces } = featuredCommunities ?? {};
  const screenSize = useScreenSizeContext();
  const { navigateSpace, navigateRoom } = useRoomNavigate();

  const navigate = useNavigate();
  const [browserOpen, setBrowserOpen] = useState(false);

  const showSpaces = !!configSpaces && configSpaces.length > 0;
  const showRooms = !!configRooms && configRooms.length > 0;
  const showEmpty = !showSpaces && !showRooms;

  // Picking a server here browses ITS public room directory — the same
  // destination the sidebar's server entries lead to. This is what replaced
  // the matrixrooms.info feed: instead of one third party's opinion of which
  // rooms are interesting, you choose among ~1150 servers and read their own
  // directories.
  const handleServerSelect = (serverName: string) => {
    navigate(getExploreServerPath(serverName));
  };

  return (
    <Page>
      {browserOpen && (
        <ServerBrowser requestClose={() => setBrowserOpen(false)} onSelect={handleServerSelect} />
      )}
      {screenSize === ScreenSize.Mobile && (
        <PageHeader>
          <Box shrink="No">
            <BackRouteHandler>
              {(onBack) => (
                <IconButton onClick={onBack}>
                  <Icon src={Icons.ArrowLeft} />
                </IconButton>
              )}
            </BackRouteHandler>
          </Box>
        </PageHeader>
      )}
      <Box grow="Yes">
        <Scroll hideTrack visibility="Hover">
          <PageContent>
            <PageContentCenter>
              <Box direction="Column" gap="200">
                <PageHeroSection>
                  <PageHero
                    icon={<Icon size="600" src={Icons.Bulb} />}
                    title="Featured Communities"
                    subTitle="Hand-picked spaces and rooms — or browse the public room directory of any Matrix server."
                  />
                </PageHeroSection>
                <Box direction="Column" gap="700">
                  <Box direction="Column" gap="300" alignItems="Center">
                    <Button
                      variant="Primary"
                      radii="400"
                      onClick={() => setBrowserOpen(true)}
                      before={<Icon size="100" src={Icons.Server} />}
                    >
                      <Text size="B400">Browse public servers</Text>
                    </Button>
                    <Text size="T200" priority="300" align="Center">
                      Around 1,150 servers, merged daily from asra.gr, joinmatrix.org and
                      privacydev.net.
                    </Text>
                  </Box>

                  {showSpaces && (
                    <Box direction="Column" gap="400">
                      <Text size="H4">Featured Spaces</Text>
                      <ConfigRoomCardRow ids={configSpaces!} onView={navigateSpace} />
                    </Box>
                  )}
                  {showRooms && (
                    <Box direction="Column" gap="400">
                      <Text size="H4">Featured Rooms</Text>
                      <ConfigRoomCardRow ids={configRooms!} onView={navigateRoom} />
                    </Box>
                  )}

                  {showEmpty && (
                    <Box
                      className={css.RoomsInfoCard}
                      direction="Column"
                      justifyContent="Center"
                      alignItems="Center"
                      gap="200"
                    >
                      <Icon size="400" src={Icons.Info} />
                      <Text size="T300" align="Center">
                        No rooms or spaces are currently featured.
                      </Text>
                    </Box>
                  )}
                </Box>
              </Box>
            </PageContentCenter>
          </PageContent>
        </Scroll>
      </Box>
    </Page>
  );
}
