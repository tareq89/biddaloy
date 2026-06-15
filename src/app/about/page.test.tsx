import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import About from "@/app/about/page";

test("renders the about page", () => {
  render(<About />);
  expect(screen.getByText(/to get started, edit the page.tsx file/i)).toBeInTheDocument();
});
