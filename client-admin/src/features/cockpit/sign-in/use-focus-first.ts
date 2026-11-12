import * as React from 'react';

/** Focus the field with this id when a step mounts (each step is a new card). */
export function useFocusFirst(id: string): void {
  React.useEffect(() => {
    document.getElementById(id)?.focus();
  }, [id]);
}
