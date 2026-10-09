import { useState } from 'react';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { AspectRatio } from '@astryxdesign/core/AspectRatio';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { FileInput } from '@astryxdesign/core/FileInput';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import type { SettingsPhoto } from '@/api/ownerSchemas';
import { Photo } from '@/components/Photo';
import { useOwner } from '../OwnerContext';
import { FormBlock } from './ProfileSection';
import { useSettings, useSettingsMutation } from './useSettings';

const ACCEPT = 'image/jpeg,image/png,image/webp,image/avif';
const MAX = 20 * 1024 * 1024; // phones shoot big photos; they are downscaled before upload

const single = (files: File | File[] | null) => (Array.isArray(files) ? (files[0] ?? null) : files);

/** Logo and hero photo: upload to the studio's owner folder, then point the studio at it. */
export function MediaSection() {
  const { api, session } = useOwner();
  const t = useSettings().data!.tenant;
  const upload = useSettingsMutation(
    async ({ kind, file }: { kind: 'logo' | 'hero'; file: File }) => api.setMedia(kind, await api.uploadMedia(session.tenant_id, file)),
    (r) => (r.kind === 'logo' ? 'Логотип обновлён' : 'Обложка обновлена'),
  );

  return (
    <VStack gap={8}>
      <FormBlock title="Обложка" description="Большое фото на главной. Лучше вертикальное, машина в нижней половине кадра.">
        <AspectRatio ratio={4 / 5}>
          <Photo path={t.hero_path} alt={t.hero_alt ?? 'Обложка'} className="media-fill" />
        </AspectRatio>
        <FileInput
          label="Новая обложка"
          accept={ACCEPT}
          maxSize={MAX}
          value={null}
          onChange={() => undefined}
          changeAction={async (files) => {
            const file = single(files);
            if (file) await upload.mutateAsync({ kind: 'hero', file }).catch(() => undefined);
          }}
          isLoading={upload.isPending && upload.variables?.kind === 'hero'}
          placeholder="Выбрать фото"
        />
      </FormBlock>
      <FormBlock title="Логотип" description="Квадратная картинка. Иконка приложения обновится при следующей публикации конфигурации.">
        <HStack gap={4} vAlign="center">
          <Photo path={t.logo_path} alt="Логотип" className="logo-preview" />
          <FileInput
            label="Новый логотип"
            accept={ACCEPT}
            maxSize={MAX}
            value={null}
            onChange={() => undefined}
            changeAction={async (files) => {
              const file = single(files);
              if (file) await upload.mutateAsync({ kind: 'logo', file }).catch(() => undefined);
            }}
            isLoading={upload.isPending && upload.variables?.kind === 'logo'}
            placeholder="Выбрать файл"
          />
        </HStack>
      </FormBlock>
    </VStack>
  );
}

/**
 * Portfolio with three explicit actions — add a card, replace one photo, edit one
 * caption. Uploading one photo never touches the others.
 */
export function PhotosSection() {
  const { api, session } = useOwner();
  const photos = useSettings().data!.photos;
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState('');
  const add = useSettingsMutation(
    async ({ file: f, caption: c }: { file: File; caption: string }) => api.addPhoto(await api.uploadMedia(session.tenant_id, f), c.trim() || null),
    'Фото добавлено',
  );

  return (
    <VStack gap={8}>
      <Card padding={5} elevation="low">
        <VStack gap={4}>
          <Text weight="semibold">Добавить работу</Text>
          <FileInput label="Фото" accept={ACCEPT} maxSize={MAX} value={file} onChange={(f) => setFile(single(f))} placeholder="Выбрать фото" />
          <TextInput label="Подпись" isOptional value={caption} onChange={setCaption} placeholder="Например: полировка, до и после" />
          <HStack>
            <Button
              label="Добавить"
              variant="primary"
              isDisabled={!file}
              isLoading={add.isPending}
              onClick={() =>
                file &&
                add.mutate(
                  { file, caption },
                  {
                    onSuccess: () => {
                      setFile(null);
                      setCaption('');
                    },
                  },
                )
              }
            />
          </HStack>
        </VStack>
      </Card>
      {photos.length === 0 ? <Text color="secondary">Фото работ пока нет.</Text> : null}
      <Grid columns={{ minWidth: 240, repeat: 'fill' }} gap={5}>
        {photos.map((p) => (
          <PhotoCard key={p.id} photo={p} />
        ))}
      </Grid>
    </VStack>
  );
}

function PhotoCard({ photo }: { photo: SettingsPhoto }) {
  const { api, session } = useOwner();
  const [caption, setCaption] = useState(photo.caption ?? '');
  const [confirm, setConfirm] = useState(false);
  const replace = useSettingsMutation(async (file: File) => api.replacePhoto(photo.id, await api.uploadMedia(session.tenant_id, file)), 'Фото заменено');
  const rename = useSettingsMutation((c: string) => api.setPhotoCaption(photo.id, c.trim() || null), 'Подпись сохранена');
  const remove = useSettingsMutation(() => api.removePhoto(photo.id), 'Фото убрано со страницы');

  return (
    <VStack gap={3}>
      <AspectRatio ratio={4 / 5}>
        <Photo path={photo.path} alt={photo.caption ?? 'Фото работы'} className="media-fill" />
      </AspectRatio>
      <FileInput
        label="Заменить это фото"
        isLabelHidden
        accept={ACCEPT}
        maxSize={MAX}
        value={null}
        onChange={() => undefined}
        changeAction={async (files) => {
          const file = single(files);
          if (file) await replace.mutateAsync(file).catch(() => undefined);
        }}
        isLoading={replace.isPending}
        placeholder="Заменить фото"
      />
      <TextInput label="Подпись" value={caption} onChange={setCaption} onEnter={() => rename.mutate(caption)} />
      <HStack gap={2} wrap="wrap">
        <Button
          label="Сохранить подпись"
          size="sm"
          variant="secondary"
          isDisabled={caption === (photo.caption ?? '')}
          isLoading={rename.isPending}
          onClick={() => rename.mutate(caption)}
        />
        <Button label="Убрать" size="sm" variant="ghost" onClick={() => setConfirm(true)} />
      </HStack>
      <AlertDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title="Убрать фото со страницы?"
        description="Остальные фото останутся на месте."
        actionLabel="Убрать"
        cancelLabel="Оставить"
        isActionLoading={remove.isPending}
        onAction={() => remove.mutate(undefined, { onSuccess: () => setConfirm(false) })}
      />
    </VStack>
  );
}
