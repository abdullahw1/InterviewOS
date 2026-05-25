import { VoiceDrill } from '@/components/VoiceDrill';

type PageProps = { params: Promise<{ id: string }> };

export default async function VoiceDrillPage({ params }: PageProps) {
  const { id } = await params;
  return <VoiceDrill drillId={id} />;
}
