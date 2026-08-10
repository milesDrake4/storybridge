import {
  productAnalyticsEventSchema,
  type ProductAnalyticsEvent,
} from "@/contracts/domain/analytics";

export type AnalyticsSink = {
  emit(event: ProductAnalyticsEvent): void;
};

export function createAnalyticsTracker(sink: AnalyticsSink) {
  return {
    track(event: unknown): void {
      sink.emit(productAnalyticsEventSchema.parse(event));
    },
  };
}
