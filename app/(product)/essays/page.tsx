import { EssayDashboard } from "@/components/essay/essay-dashboard";
import { parseSeasonPassPriceCents } from "@/lib/config/server";

export default function EssaysPage() {
  return (
    <EssayDashboard
      seasonPassPriceCents={parseSeasonPassPriceCents(
        process.env.SEASON_PASS_PRICE_CENTS,
      )}
    />
  );
}
