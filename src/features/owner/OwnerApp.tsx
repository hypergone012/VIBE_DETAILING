import { Center } from '@astryxdesign/core/Center';
import { Spinner } from '@astryxdesign/core/Spinner';

/** Placeholder replaced in stage 5 (owner cabinet). */
export default function OwnerApp() {
  return (
    <Center minHeight="100dvh">
      <Spinner label="Кабинет" />
    </Center>
  );
}
