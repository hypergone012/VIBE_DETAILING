import { Theme } from '@astryxdesign/core/theme';
import { studioTheme } from '@/theme/studioTheme';
import { FoundationCheck } from '@/features/dev/FoundationCheck';

export function App() {
  return (
    <Theme theme={studioTheme(null)} mode="dark">
      {window.location.pathname.startsWith('/__foundation') ? <FoundationCheck /> : null}
    </Theme>
  );
}
