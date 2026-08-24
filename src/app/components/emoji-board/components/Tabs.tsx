import { CSSProperties } from 'react';
import { Badge, Box, Text } from 'folds';
import { EmojiBoardTab } from '../types';

const styles: CSSProperties = {
  cursor: 'pointer',
};

const TAB_LABEL: Record<EmojiBoardTab, string> = {
  [EmojiBoardTab.Sticker]: 'Sticker',
  [EmojiBoardTab.Emoji]: 'Emoji',
  [EmojiBoardTab.Gif]: 'GIF',
  [EmojiBoardTab.Mashup]: 'Mashup',
};

export function EmojiBoardTabs({
  tab,
  tabs,
  onTabChange,
}: {
  tab: EmojiBoardTab;
  /**
   * Which tabs this board offers, in the order they appear. The board decides
   * — a reaction picker has no use for stickers or GIFs, and both the GIF and
   * Mashup tabs are settings-gated — so the strip renders what it is given
   * rather than working it out again.
   */
  tabs: EmojiBoardTab[];
  onTabChange: (tab: EmojiBoardTab) => void;
}) {
  return (
    <Box gap="100">
      {tabs.map((boardTab) => (
        <Badge
          key={boardTab}
          style={styles}
          as="button"
          variant="Secondary"
          fill={tab === boardTab ? 'Solid' : 'None'}
          size="500"
          onClick={() => onTabChange(boardTab)}
        >
          <Text as="span" size="L400">
            {TAB_LABEL[boardTab]}
          </Text>
        </Badge>
      ))}
    </Box>
  );
}
