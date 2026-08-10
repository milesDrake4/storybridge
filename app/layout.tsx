import type { Metadata } from "next";
import type { ReactNode } from "react";

import { SkipLink } from "@/components/ui/skip-link";

import "./globals.css";

export const metadata: Metadata = {
  title: "StoryBridge — College essay coaching",
  description:
    "A thoughtful, evidence-first college essay coach that helps students preserve their own voice.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <SkipLink />
        {children}
      </body>
    </html>
  );
}
