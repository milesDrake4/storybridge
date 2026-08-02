import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import HomePage from "@/app/page";

describe("StoryBridge app shell", () => {
  it("renders the product promise and primary navigation", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Discover what only you can say.",
      }),
    ).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeVisible();
    expect(screen.getByLabelText("Product commitment")).toHaveTextContent(
      "AI suggestions never enter your draft without your choice.",
    );
  });
});
