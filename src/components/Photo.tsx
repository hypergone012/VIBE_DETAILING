import { useState } from 'react';
import { Camera } from '@phosphor-icons/react';
import { mediaUrl } from '@/api/client';

/** Studio photo from Storage with a graceful placeholder when missing or broken. */
export function Photo({
  path,
  alt,
  className = 'media-tile',
  eager = false,
}: {
  path: string | null | undefined;
  alt: string;
  className?: string;
  eager?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const src = mediaUrl(path);
  if (!src || failed) {
    return (
      <span className="media-fallback" role="img" aria-label={alt}>
        <Camera size={32} aria-hidden />
      </span>
    );
  }
  return (
    <img
      className={className}
      src={src}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      // Always CORS: the glass lens snapshots page images, and the SW caches only CORS responses.
      crossOrigin="anonymous"
      onError={() => setFailed(true)}
    />
  );
}
