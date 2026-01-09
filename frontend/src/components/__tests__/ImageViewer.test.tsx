/**
 * ImageViewer Component Tests
 */

import { describe, expect, it, afterEach } from "bun:test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ImageViewer } from "../ImageViewer";

afterEach(() => {
  cleanup();
});

describe("ImageViewer", () => {
  const defaultProps = {
    path: "attachments/photo.jpg",
    assetBaseUrl: "/vault/test-vault/assets",
  };

  it("renders with the correct image URL", () => {
    render(<ImageViewer {...defaultProps} />);

    const img = screen.getByRole("img");
    expect(img).toBeDefined();
    expect(img.getAttribute("src")).toBe("/vault/test-vault/assets/attachments/photo.jpg");
  });

  it("displays the filename in the header", () => {
    render(<ImageViewer {...defaultProps} />);

    expect(screen.getByText("photo.jpg")).toBeDefined();
  });

  it("extracts filename from nested path", () => {
    render(<ImageViewer path="deep/nested/path/vacation.png" assetBaseUrl="/vault/v1/assets" />);

    expect(screen.getByText("vacation.png")).toBeDefined();
  });

  it("uses path as filename when no separator exists", () => {
    render(<ImageViewer path="simple.jpg" assetBaseUrl="/vault/v1/assets" />);

    expect(screen.getByText("simple.jpg")).toBeDefined();
  });

  it("shows loading state initially", () => {
    render(<ImageViewer {...defaultProps} />);

    // Image should have loading class before load event
    const img = screen.getByRole("img");
    expect(img.className).toContain("image-viewer__image--loading");
  });

  it("removes loading class after image loads", () => {
    render(<ImageViewer {...defaultProps} />);

    const img = screen.getByRole("img");
    fireEvent.load(img);

    expect(img.className).not.toContain("image-viewer__image--loading");
  });

  it("shows error state when image fails to load", () => {
    render(<ImageViewer {...defaultProps} />);

    const img = screen.getByRole("img");
    fireEvent.error(img);

    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByText("Failed to load image")).toBeDefined();
    expect(screen.getByText(defaultProps.path)).toBeDefined();
  });

  it("has correct alt text", () => {
    render(<ImageViewer {...defaultProps} />);

    const img = screen.getByRole("img");
    expect(img.getAttribute("alt")).toBe("photo.jpg");
  });

  it("constructs URL correctly with different base URLs", () => {
    const { unmount } = render(
      <ImageViewer path="img.png" assetBaseUrl="/vault/vault-1/assets" />
    );

    let img = screen.getByRole("img");
    expect(img.getAttribute("src")).toBe("/vault/vault-1/assets/img.png");

    unmount();

    render(<ImageViewer path="img.png" assetBaseUrl="/vault/vault-2/assets" />);
    img = screen.getByRole("img");
    expect(img.getAttribute("src")).toBe("/vault/vault-2/assets/img.png");
  });

  it("resets loading state when path changes", () => {
    const { rerender } = render(
      <ImageViewer path="first.jpg" assetBaseUrl="/vault/test/assets" />
    );

    const img = screen.getByRole("img");

    // Load the first image
    fireEvent.load(img);
    expect(img.className).not.toContain("image-viewer__image--loading");

    // Change to a different image - should reset to loading
    rerender(<ImageViewer path="second.jpg" assetBaseUrl="/vault/test/assets" />);

    // After path change, loading state should be reset
    const newImg = screen.getByRole("img");
    expect(newImg.className).toContain("image-viewer__image--loading");
    expect(newImg.getAttribute("src")).toBe("/vault/test/assets/second.jpg");
  });

  it("resets error state when path changes", () => {
    const { rerender } = render(
      <ImageViewer path="broken.jpg" assetBaseUrl="/vault/test/assets" />
    );

    const img = screen.getByRole("img");

    // Simulate error on first image
    fireEvent.error(img);
    expect(screen.getByRole("alert")).toBeDefined();

    // Change to a different image - should reset error state
    rerender(<ImageViewer path="working.jpg" assetBaseUrl="/vault/test/assets" />);

    // Error state should be cleared, loading state shown
    expect(screen.queryByRole("alert")).toBeNull();
    const newImg = screen.getByRole("img");
    expect(newImg.className).toContain("image-viewer__image--loading");
  });
});
