import { ImageResponse } from 'next/og';
import { IconArt } from '@/components/IconArt';

export const dynamic = 'force-static';

// Maskable icons need the artwork inside the central safe zone.
export function GET() {
  return new ImageResponse(<IconArt size={512} safe />, { width: 512, height: 512 });
}
