import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';

/**
 * Dev-only foundation smoke page (`astryx docs migration` → "Foundation Smoke Test").
 * tests/e2e/foundation.spec.ts asserts that layer order keeps Astryx padding and
 * that the shadcn drawer paints with Astryx tokens.
 */
export function FoundationCheck() {
  const [email, setEmail] = useState('');
  const [open, setOpen] = useState(false);

  return (
    <main data-foundation-check className="app-page">
      <VStack gap={4} paddingBlock={6}>
        <Heading level={1}>Foundation check</Heading>
        <Button label="Primary action" variant="primary" onClick={() => setOpen(true)} />
        <TextInput label="Email" placeholder="you@example.com" value={email} onChange={setEmail} />
        <Card>
          <Text>One card with default padding</Text>
        </Card>
      </VStack>
      <Drawer open={open} onOpenChange={setOpen} showSwipeHandle>
        <DrawerContent data-testid="foundation-drawer">
          <DrawerHeader>
            <DrawerTitle>Drawer</DrawerTitle>
            <DrawerDescription>Base UI branch, Astryx tokens</DrawerDescription>
          </DrawerHeader>
          <VStack padding={4}>
            <Button label="Close" onClick={() => setOpen(false)} />
          </VStack>
        </DrawerContent>
      </Drawer>
    </main>
  );
}
