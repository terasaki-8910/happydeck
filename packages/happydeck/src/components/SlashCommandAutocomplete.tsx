interface SlashCommandAutocompleteProps {
  matches: string[];
  highlightedIndex: number;
  onSelect: (command: string) => void;
}

/** Dropdown shown above the composer while typing a slash command — purely presentational, SessionTile owns the match list and keyboard navigation since both live on the same input's key events. */
export function SlashCommandAutocomplete({ matches, highlightedIndex, onSelect }: SlashCommandAutocompleteProps) {
  if (matches.length === 0) return null;
  return (
    <div className="slash-autocomplete" onMouseDown={(event) => event.preventDefault()}>
      {matches.map((command, index) => (
        <button
          key={command}
          type="button"
          className={`slash-autocomplete-row ${index === highlightedIndex ? 'slash-autocomplete-row-active' : ''}`}
          onClick={() => onSelect(command)}
        >
          /{command}
        </button>
      ))}
    </div>
  );
}
