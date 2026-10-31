import { Icon, Icons, Text, Tooltip, TooltipProvider, color, toRem } from 'folds';
import { MessageShield } from '../../utils/messageShield';

/** A small shield beside a message whose sender could not be fully checked. */
export function MessageShieldIcon({ shield }: { shield: MessageShield }) {
  return (
    <TooltipProvider
      position="Top"
      tooltip={
        <Tooltip style={{ maxWidth: toRem(320) }}>
          <Text size="T300">{shield.text}</Text>
        </Tooltip>
      }
    >
      {(targetRef) => (
        <button
          ref={targetRef}
          type="button"
          aria-label={shield.text}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: 0,
            border: 'none',
            background: 'none',
            cursor: 'help',
          }}
        >
          <Icon
            size="100"
            src={Icons.Shield}
            filled
            // Grey is the milder warning, so it is the surface text colour dimmed: the
            // Secondary colour is close to black in light themes and would read as plain text.
            style={
              shield.colour === 'red'
                ? { color: color.Critical.Main }
                : { color: color.Surface.OnContainer, opacity: 0.55 }
            }
          />
        </button>
      )}
    </TooltipProvider>
  );
}
