import { ReaderClient } from "@/components/reader/reader-client";

interface ReaderPageProps {
  params: Promise<{ documentId: string }>;
}

export default async function ReaderPage({ params }: ReaderPageProps) {
  const { documentId } = await params;
  return <ReaderClient documentId={documentId} />;
}
