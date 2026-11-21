import { KeyboardEvent, useRef } from 'react';
import { Box, Chip, Text } from 'folds';
import { useSetting } from '../state/hooks/settings';
import { settingsAtom } from '../state/settings';
import { useDesign } from './useDesign';
import { Design } from './scope';

const OPTIONS: { design: Design; label: string }[] = [
  { design: Design.Prinny, label: 'Prinny' },
  { design: Design.Liquid, label: 'Liquid' },
];

/** Segmented choice between the designs; a radio group for assistive tech. */
export function DesignSelector() {
  const design = useDesign();
  const [, setDesign] = useSetting(settingsAtom, 'uiDesign');
  const groupRef = useRef<HTMLDivElement>(null);

  // Arrow keys move the choice, as in any radio group.
  const handleKeyDown = (evt: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[evt.key];
    if (step === undefined) {
      return;
    }
    evt.preventDefault();

    const index = OPTIONS.findIndex((o) => o.design === design);
    const next = OPTIONS[(index + step + OPTIONS.length) % OPTIONS.length];
    setDesign(next.design);
    groupRef.current?.querySelector<HTMLButtonElement>(`[data-design="${next.design}"]`)?.focus();
  };

  return (
    <Box ref={groupRef} gap="100" role="radiogroup" aria-label="Design" onKeyDown={handleKeyDown}>
      {OPTIONS.map((option) => {
        const selected = option.design === design;
        return (
          <Chip
            key={option.design}
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            data-design={option.design}
            variant={selected ? 'Primary' : 'Secondary'}
            fill={selected ? 'Soft' : 'None'}
            outlined={selected}
            radii="Pill"
            onClick={() => setDesign(option.design)}
          >
            <Text size="B300">{option.label}</Text>
          </Chip>
        );
      })}
    </Box>
  );
}
