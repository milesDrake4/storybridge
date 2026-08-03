import { EssayWorkspace } from "@/components/essay/essay-workspace";

type Props = { params: Promise<{ essayId: string }> };

export default async function EssayPage({ params }: Props) {
  return <EssayWorkspace essayId={(await params).essayId} />;
}
